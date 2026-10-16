import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import lodash from 'lodash'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emptyDraft, emptyScripts, newId, type Collection, type FolderItem, type RequestItem } from '@shared/model'
import {
  DEFAULT_RUN_OPTIONS,
  parseCsv,
  parseDataFile,
  planFor,
  reconcilePlan,
  runCollection,
  summarize,
  type RunDeps,
  type RunOptions
} from '@shared/runner'
import { runScripts } from '@shared/scripting/runtime'
import type { VariableMutation } from '@shared/scripting/types'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { newVariable } from '@shared/variables'
import { executeRequest } from './executor'

let server: Server
let base: string
const hits: string[] = []

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '')
    res.setHeader('content-type', 'application/json')
    if (req.url?.startsWith('/fail')) return res.writeHead(500).end('{}')
    res.end(JSON.stringify({ url: req.url, auth: req.headers.authorization ?? null }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

const req = (name: string, url: string, scripts: Partial<RequestItem['request']['scripts']> = {}): RequestItem => ({
  type: 'request',
  id: `id-${name}`,
  name,
  request: { ...emptyDraft(), url, scripts: { ...emptyScripts(), ...scripts } }
})

function collection(items: Collection['items'], patch: Partial<Collection> = {}): Collection {
  return { id: 'c', name: 'C', items, auth: null, scripts: emptyScripts(), variables: [], ...patch }
}

function deps(overrides: Partial<RunDeps> = {}): RunDeps & { persisted: VariableMutation[]; sleeps: number[] } {
  const persisted: VariableMutation[] = []
  const sleeps: number[] = []
  return {
    execute: (input) => executeRequest(input, (exec, send) => runScripts(exec, { sendRequest: send, libraries: { lodash } })),
    settings: DEFAULT_SETTINGS.general,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    stopped: () => false,
    newId,
    onResult: () => undefined,
    onMutations: (m) => persisted.push(...m),
    persisted,
    sleeps,
    ...overrides
  }
}

const opts = (patch: Partial<RunOptions> = {}): RunOptions => ({ ...DEFAULT_RUN_OPTIONS, ...patch })
const vars = { environment: [newVariable('base', '')], globals: [], collection: [] }

describe('fichiers de données', () => {
  it('lit un CSV avec guillemets, virgules et retours à la ligne', () => {
    expect(parseCsv('a,b\r\n"x, y","il dit ""oui"""\n"multi\nligne",2\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'il dit "oui"'],
      ['multi\nligne', '2']
    ])
    expect(parseDataFile('d.csv', '﻿id,nom\n1,Ada\n2,Bob\n')).toEqual({
      ok: true,
      format: 'csv',
      rows: [
        { id: '1', nom: 'Ada' },
        { id: '2', nom: 'Bob' }
      ]
    })
  })

  it('lit un tableau JSON et refuse les formats inattendus', () => {
    expect(parseDataFile('d.json', '[{"id":1,"tags":["a"]},{"id":2,"ok":true}]')).toEqual({
      ok: true,
      format: 'json',
      rows: [
        { id: '1', tags: '["a"]' },
        { id: '2', ok: 'true' }
      ]
    })
    expect(parseDataFile('d.json', '{"id":1}')).toMatchObject({ ok: false })
    expect(parseDataFile('d.json', '[oups')).toMatchObject({ ok: false })
    expect(parseDataFile('d.csv', '   ')).toMatchObject({ ok: false })
  })
})

describe('plan', () => {
  it('suit l’ordre de l’arbre, avec les dossiers, et se resynchronise', () => {
    const folder: FolderItem = { type: 'folder', id: 'f', name: 'Dossier', auth: null, scripts: emptyScripts(), items: [req('B', '/b')] }
    const c = collection([req('A', '/a'), folder, req('C', '/c')])
    const plan = planFor(c)
    expect(plan.map((p) => `${p.path.join('/')}:${p.name}`)).toEqual([':A', 'Dossier:B', ':C'])
    expect(planFor(c, 'f').map((p) => p.name)).toEqual(['B'])
    const saved = [{ ...plan[2]!, enabled: false }, plan[0]!, { itemId: 'disparu', name: 'X', method: 'GET', path: [], enabled: true }]
    expect(reconcilePlan(saved, plan).map((p) => `${p.name}:${p.enabled}`)).toEqual(['C:false', 'A:true', 'B:true'])
  })
})

describe('runCollection', () => {
  it('itère avec les lignes du fichier de données, le délai et les variables conservées', async () => {
    hits.length = 0
    const c = collection([
      req('Créer', `{{base}}/users?nom={{nom}}`, {
        test: `pm.test('nom', () => pm.expect(pm.iterationData.get('nom')).to.be.a('string')); pm.environment.set('dernier', pm.iterationData.get('nom')); pm.test('itération', () => pm.expect(pm.info.iteration).to.be.below(3))`
      }),
      req('Lire', `{{base}}/users/{{dernier}}`)
    ])
    const d = deps()
    const out = await runCollection(
      c,
      planFor(c),
      opts({ iterations: 3, delayMs: 50, data: { fileName: 'd.csv', rows: [{ nom: 'ada' }, { nom: 'bob' }] } }),
      { ...vars, environment: [newVariable('base', base), newVariable('dernier', '')] },
      d
    )
    expect(out.status).toBe('done')
    // La 3e itération réutilise la dernière ligne.
    expect(hits).toEqual(['/users?nom=ada', '/users/ada', '/users?nom=bob', '/users/bob', '/users?nom=bob', '/users/bob'])
    expect(d.sleeps).toEqual([50, 50, 50, 50, 50])
    expect(d.persisted.filter((m) => m.op === 'set').map((m) => (m as { value: string }).value)).toEqual(['ada', 'bob', 'bob'])
    expect(out.variables.environment.find((v) => v.key === 'dernier')?.current).toBe('bob')
    const s = summarize(out.results, 3, 0)
    expect(s).toMatchObject({ iterations: 3, requests: 6, testsPassed: 6, testsFailed: 0, errors: 0 })
  })

  it('ne persiste rien si « conserver les valeurs » est désactivé, mais les requêtes suivantes voient les changements', async () => {
    hits.length = 0
    const c = collection([req('A', `{{base}}/a`, { test: `pm.environment.set('x', 'vu')` }), req('B', `{{base}}/b/{{x}}`)])
    const d = deps()
    await runCollection(c, planFor(c), opts({ persistVariables: false }), { ...vars, environment: [newVariable('base', base)] }, d)
    expect(hits).toEqual(['/a', '/b/vu'])
    expect(d.persisted).toEqual([])
  })

  it('setNextRequest saute, boucle par nom et s’arrête avec null', async () => {
    hits.length = 0
    const c = collection([
      req('Login', `{{base}}/login`, { test: `pm.execution.setNextRequest('Fin')` }),
      req('Ignorée', `{{base}}/ignoree`),
      req('Fin', `{{base}}/fin`, {
        test: `const n = Number(pm.collectionVariables.get('n') || 0) + 1; pm.collectionVariables.set('n', n); if (n < 3) postman.setNextRequest('Fin'); else pm.execution.setNextRequest(null)`
      }),
      req('Après', `{{base}}/apres`)
    ])
    const out = await runCollection(c, planFor(c), opts({ iterations: 2 }), { ...vars, environment: [newVariable('base', base)] }, deps())
    expect(hits).toEqual(['/login', '/fin', '/fin', '/fin', '/login', '/fin'])
    expect(out.status).toBe('done')
  })

  it('arrêt sur erreur, arrêt demandé et requêtes désactivées', async () => {
    hits.length = 0
    const c = collection([req('Erreur', `http://127.0.0.1:1/`), req('Suivante', `{{base}}/suivante`)])
    const env = { ...vars, environment: [newVariable('base', base)] }
    expect(await runCollection(c, planFor(c), opts({ stopOnError: true }), env, deps())).toMatchObject({ status: 'error' })
    expect(hits).toEqual([])
    await runCollection(c, planFor(c), opts(), env, deps())
    expect(hits).toEqual(['/suivante'])

    let calls = 0
    const stopped = await runCollection(c, planFor(c), opts({ iterations: 5 }), env, deps({ stopped: () => calls++ > 1 }))
    expect(stopped.status).toBe('stopped')
    expect(stopped.results).toHaveLength(2)

    const plan = planFor(c).map((p) => ({ ...p, enabled: p.name === 'Suivante' }))
    hits.length = 0
    const partial = await runCollection(c, plan, opts(), env, deps())
    expect(partial.results.map((r) => r.name)).toEqual(['Suivante'])
    expect(await runCollection(c, plan.map((p) => ({ ...p, enabled: false })), opts(), env, deps())).toMatchObject({ status: 'error' })
  })

  it('conserve les réponses sur demande et rapporte statuts et erreurs de script', async () => {
    const c = collection([req('Ko', `{{base}}/fail`, { test: `pm.test('statut', () => pm.response.to.have.status(200)); throw new Error('cassé')` })])
    const out = await runCollection(c, planFor(c), opts({ saveResponses: true }), { ...vars, environment: [newVariable('base', base)] }, deps())
    const r = out.results[0]!
    expect(r).toMatchObject({ status: 500, scriptError: { message: 'Error: cassé', phase: 'test' } })
    expect(r.tests[0]).toMatchObject({ passed: false })
    expect(Buffer.from(r.response!.bodyBase64, 'base64').toString()).toBe('{}')
    expect(summarize(out.results, 1, 10)).toMatchObject({ testsFailed: 1, errors: 1 })
  })
})
