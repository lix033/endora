import { createServer, type Server } from 'node:http'
import { createServer as createH2Server, type Http2Server } from 'node:http2'
import type { AddressInfo } from 'node:net'
import lodash from 'lodash'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthConfig } from '@shared/auth'
import type { ExecutionInput, ParentContext } from '@shared/execution'
import { emptyDraft, emptyScripts, newRow, type RequestDraft } from '@shared/model'
import { runScripts } from '@shared/scripting/runtime'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { newVariable } from '@shared/variables'
import { executeRequest, type ScriptRunner } from './executor'

let server: Server
let h2: Http2Server
let base: string
let h2base: string

const runner: ScriptRunner = (exec, sendRequest) => runScripts(exec, { sendRequest, libraries: { lodash } })

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/big') return res.end('x'.repeat(3 * 1024 * 1024))
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString(), version: req.httpVersion }))
    })
  })
  h2 = createH2Server((req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ version: req.httpVersion }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  await new Promise<void>((r) => h2.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  h2base = `http://127.0.0.1:${(h2.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
  h2.close()
})

const parent = (kind: ParentContext['kind'], name: string, patch: Partial<ParentContext> = {}): ParentContext => ({
  kind,
  name,
  auth: null,
  scripts: emptyScripts(),
  ...patch
})

function input(draft: Partial<RequestDraft>, patch: Partial<ExecutionInput> = {}): ExecutionInput {
  return {
    requestId: 'req',
    name: 'Test',
    draft: { ...emptyDraft(), ...draft },
    chain: [],
    variables: { environment: [], globals: [], collection: [] },
    settings: { ...DEFAULT_SETTINGS.general },
    ...patch
  }
}

function echo(out: Awaited<ReturnType<typeof executeRequest>>) {
  if (!out.result?.ok) throw new Error(out.result ? out.result.message : out.prerequestError?.message ?? 'non envoyé')
  return JSON.parse(Buffer.from(out.result.bodyBase64, 'base64').toString()) as {
    method: string
    url: string
    headers: Record<string, string>
    body: string
    version: string
  }
}

describe('executeRequest : variables', () => {
  it('résout URL, en-têtes et body avec la priorité environnement > collection > globales', async () => {
    const env = [newVariable('base', base), newVariable('who', 'env')]
    env[1]!.current = 'env-courant'
    const out = await executeRequest(
      input(
        {
          method: 'POST',
          url: '{{base}}/echo?u={{who}}&g={{onlyGlobal}}',
          headers: [newRow('X-Who', '{{who}}'), newRow('X-Nested', '{{nested}}')],
          body: { ...emptyDraft().body, mode: 'raw', language: 'json', raw: '{"c":"{{onlyCollection}}"}' }
        },
        {
          variables: {
            environment: env,
            globals: [newVariable('who', 'global'), newVariable('onlyGlobal', 'g1'), newVariable('nested', 'n-{{onlyGlobal}}')],
            collection: [newVariable('who', 'collection'), newVariable('onlyCollection', 'c1')]
          }
        }
      ),
      runner
    )
    const e = echo(out)
    expect(e.url).toBe('/echo?u=env-courant&g=g1')
    expect(e.headers['x-who']).toBe('env-courant')
    expect(e.headers['x-nested']).toBe('n-g1')
    expect(e.body).toBe('{"c":"c1"}')
    expect(out.resolvedUrl).toBe(`${base}/echo?u=env-courant&g=g1`)
  })
})

describe('executeRequest : auth héritée', () => {
  const bearer = (token: string): AuthConfig => ({ type: 'bearer', params: { token } })

  it('hérite de la collection, le dossier le plus proche l’emporte, la requête peut la désactiver', async () => {
    const vars = { environment: [newVariable('tok', 'T-env')], globals: [], collection: [] }
    const fromCollection = await executeRequest(input({ url: `${base}/a` }, { chain: [parent('folder', 'F'), parent('collection', 'C', { auth: bearer('{{tok}}') })], variables: vars }), runner)
    expect(echo(fromCollection).headers['authorization']).toBe('Bearer T-env')

    const fromFolder = await executeRequest(
      input({ url: `${base}/a` }, { chain: [parent('folder', 'F', { auth: bearer('dossier') }), parent('collection', 'C', { auth: bearer('collection') })] }),
      runner
    )
    expect(echo(fromFolder).headers['authorization']).toBe('Bearer dossier')

    const none = await executeRequest(
      input({ url: `${base}/a`, auth: { type: 'noauth', params: {} } }, { chain: [parent('collection', 'C', { auth: bearer('x') })] }),
      runner
    )
    expect(echo(none).headers['authorization']).toBeUndefined()
  })
})

describe('executeRequest : scripts', () => {
  it('exécute les scripts dans l’ordre collection → dossier → requête, avant et après', async () => {
    const out = await executeRequest(
      input(
        {
          url: `${base}/s?id={{id}}`,
          scripts: {
            prerequest: `pm.environment.set('order', pm.environment.get('order') + ',req'); pm.request.headers.add({ key: 'X-Pre', value: 'oui' })`,
            test: `pm.test('statut', () => pm.response.to.have.status(200)); pm.test('header pre', () => pm.expect(pm.response.json().headers['x-pre']).to.eql('oui'))`
          }
        },
        {
          chain: [
            parent('folder', 'F', { scripts: { prerequest: `pm.environment.set('order', pm.environment.get('order') + ',folder')`, test: `console.log('test dossier')` } }),
            parent('collection', 'C', {
              scripts: { prerequest: `pm.environment.set('order', 'collection'); pm.variables.set('id', 42)`, test: `pm.collectionVariables.set('last', pm.response.code)` }
            })
          ],
          variables: { environment: [newVariable('order', '')], globals: [], collection: [] }
        }
      ),
      runner
    )
    expect(echo(out).url).toBe('/s?id=42')
    expect(out.mutations.filter((m) => m.scope === 'environment' && m.op === 'set').map((m) => (m as { value: string }).value)).toEqual([
      'collection',
      'collection,folder',
      'collection,folder,req'
    ])
    expect(out.mutations).toContainEqual({ scope: 'collectionVariables', op: 'set', key: 'last', value: '200' })
    expect(out.tests).toEqual([
      { name: 'statut', passed: true },
      { name: 'header pre', passed: true }
    ])
    expect(out.logs).toEqual([{ level: 'log', message: 'test dossier', source: 'Dossier « F »' }])
  })

  it('n’envoie pas la requête si un script pre-request échoue ou appelle skipRequest', async () => {
    const failed = await executeRequest(input({ url: `${base}/x`, scripts: { prerequest: 'throw new Error("stop")', test: '' } }), runner)
    expect(failed.result).toBeNull()
    expect(failed.prerequestError).toEqual({ message: 'Error: stop', source: 'Requête' })

    const skipped = await executeRequest(input({ url: `${base}/x`, scripts: { prerequest: 'pm.execution.skipRequest()', test: '' } }), runner)
    expect(skipped.result).toBeNull()
    expect(skipped.skipped).toBe(true)
  })

  it('pm.sendRequest passe par le réseau du process principal', async () => {
    const out = await executeRequest(
      input(
        {
          url: `${base}/main`,
          scripts: { prerequest: `const r = await pm.sendRequest('{{base}}/token'); pm.environment.set('fromScript', r.json().url)`, test: '' }
        },
        { variables: { environment: [newVariable('base', base)], globals: [], collection: [] } }
      ),
      runner
    )
    expect(out.mutations).toContainEqual({ scope: 'environment', op: 'set', key: 'fromScript', value: '/token' })
    expect(out.sentRequests).toEqual([{ method: 'GET', url: `${base}/token`, status: 200 }])
  })
})

describe('executeRequest : réglages HTTP', () => {
  it('HTTP/2 en clair (h2c) quand la version est forcée, HTTP/1.1 sinon', async () => {
    const forced = await executeRequest(input({ url: `${h2base}/v`, protocolVersion: 'http2' }), runner)
    expect(echo(forced).version).toBe('2.0')
    const global = await executeRequest(input({ url: `${base}/v` }, { settings: { ...DEFAULT_SETTINGS.general, httpVersion: 'http1' } }), runner)
    expect(echo(global).version).toBe('1.1')
  })

  it('respecte la taille maximale de réponse', async () => {
    const out = await executeRequest(input({ url: `${base}/big` }, { settings: { ...DEFAULT_SETTINGS.general, maxResponseSizeMb: 1 } }), runner)
    expect(out.result).toMatchObject({ ok: false, code: 'too_large' })
  })
})
