import { describe, expect, it } from 'vitest'
import lodash from 'lodash'
import CryptoJS from 'crypto-js'
import { runScripts, type RuntimeHooks } from './runtime'
import type { ScriptExecution, ScriptResponse } from './types'

const json = (body: unknown, code = 200, headers: Array<{ key: string; value: string }> = []): ScriptResponse => ({
  code,
  status: code === 200 ? 'OK' : 'Not Found',
  headers: [{ key: 'Content-Type', value: 'application/json' }, ...headers],
  bodyBase64: Buffer.from(JSON.stringify(body)).toString('base64'),
  responseTime: 42,
  responseSize: 10
})

function exec(code: string | string[], patch: Partial<ScriptExecution> = {}): ScriptExecution {
  const codes = Array.isArray(code) ? code : [code]
  return {
    id: 'x',
    event: 'test',
    scripts: codes.map((c, i) => ({ code: c, source: `script ${i + 1}` })),
    request: { method: 'GET', url: 'https://api.example.com/items?a=1', headers: [{ key: 'Accept', value: '*/*' }], body: { mode: 'none' } },
    response: json({ id: 7, items: [{ name: 'a' }], nested: { ok: true } }),
    variables: {
      environment: [{ key: 'host', value: 'env-host' }, { key: 'shared', value: 'env' }],
      environmentName: 'Dev',
      globals: [{ key: 'shared', value: 'global' }, { key: 'g', value: '1' }],
      collectionVariables: [{ key: 'shared', value: 'collection' }],
      local: [],
      data: []
    },
    info: { requestName: 'Lister', requestId: 'r1', iteration: 0, iterationCount: 1 },
    ...patch
  }
}

const hooks: RuntimeHooks = {
  sendRequest: async (req) =>
    req.url.includes('fail')
      ? { ok: false, error: 'ECONNREFUSED' }
      : { ok: true, response: json({ echo: req.url, method: req.method, headers: req.headers }) },
  libraries: { lodash, 'crypto-js': CryptoJS }
}

describe('pm.* : variables', () => {
  it('lit selon la priorité environnement > collection > globales et enregistre les modifications', async () => {
    const out = await runScripts(
      exec(`
        pm.expect(pm.variables.get('shared')).to.equal('env')
        pm.expect(pm.environment.name).to.equal('Dev')
        pm.environment.set('token', 'abc')
        pm.collectionVariables.set('count', 3)
        pm.globals.unset('g')
        pm.variables.set('local', { a: 1 })
        pm.expect(pm.variables.get('local')).to.equal('{"a":1}')
        pm.expect(pm.variables.replaceIn('{{host}}/{{token}}')).to.equal('env-host/abc')
      `),
      hooks
    )
    expect(out.error).toBeUndefined()
    expect(out.mutations).toEqual([
      { scope: 'environment', op: 'set', key: 'token', value: 'abc' },
      { scope: 'collectionVariables', op: 'set', key: 'count', value: '3' },
      { scope: 'globals', op: 'unset', key: 'g' },
      { scope: 'local', op: 'set', key: 'local', value: '{"a":1}' }
    ])
  })

  it('ancienne API postman.* et tests[]', async () => {
    const out = await runScripts(
      exec(`
        postman.setEnvironmentVariable('legacy', 'oui')
        tests['code 200'] = responseCode.code === 200
        tests['faux'] = false
      `),
      hooks
    )
    expect(out.mutations).toEqual([{ scope: 'environment', op: 'set', key: 'legacy', value: 'oui' }])
    expect(out.tests).toEqual([
      { name: 'code 200', passed: true },
      { name: 'faux', passed: false, error: 'échec' }
    ])
  })
})

describe('pm.test et assertions de réponse', () => {
  it('enregistre succès, échecs et tests ignorés', async () => {
    const out = await runScripts(
      exec(`
        pm.test('statut', () => pm.response.to.have.status(200))
        pm.test('ok', () => pm.response.to.be.ok)
        pm.test('succès', () => pm.response.to.be.success)
        pm.test('json', () => pm.response.to.be.json)
        pm.test('en-tête', () => pm.response.to.have.header('content-type', 'application/json'))
        pm.test('jsonBody', () => pm.response.to.have.jsonBody('nested.ok', true))
        pm.test('corps', () => pm.expect(pm.response.json().items).to.have.lengthOf(1))
        pm.test('temps', () => pm.expect(pm.response.responseTime).to.be.below(100))
        pm.test('échoue', () => pm.response.to.have.status(404))
        pm.test('pas une erreur', () => pm.response.to.not.be.error)
        pm.test.skip('ignoré', () => { throw new Error('jamais') })
        pm.test('chai ok classique', () => pm.expect(1).to.be.ok)
      `),
      hooks
    )
    const byName = Object.fromEntries(out.tests.map((t) => [t.name, t]))
    for (const name of ['statut', 'ok', 'succès', 'json', 'en-tête', 'jsonBody', 'corps', 'temps', 'pas une erreur', 'chai ok classique']) {
      expect(byName[name], name).toMatchObject({ passed: true })
    }
    expect(byName['échoue']).toMatchObject({ passed: false })
    expect(byName['échoue']!.error).toMatch(/status code 404 but got 200/)
    expect(byName['ignoré']).toMatchObject({ skipped: true })
  })

  it('attend les tests asynchrones, les minuteries et pm.sendRequest (callback et await)', async () => {
    const out = await runScripts(
      exec(`
        pm.sendRequest('https://echo/a', (err, res) => {
          pm.test('callback', () => pm.expect(res.json().echo).to.equal('https://echo/a'))
        })
        const res = await pm.sendRequest({ url: 'https://echo/{{host}}', method: 'POST', header: { 'X-A': '1' } })
        pm.test('await', () => {
          pm.expect(res.json().method).to.equal('POST')
          pm.expect(res.json().echo).to.equal('https://echo/env-host')
        })
        setTimeout(() => pm.environment.set('later', 'yes'), 20)
        pm.test('done', (done) => setTimeout(() => done(), 10))
        pm.sendRequest('https://fail', (err) => console.log('erreur reçue', err.message))
      `),
      hooks
    )
    expect(out.error).toBeUndefined()
    expect(out.tests.map((t) => [t.name, t.passed]).sort()).toEqual([
      ['await', true],
      ['callback', true],
      ['done', true]
    ])
    expect(out.mutations).toContainEqual({ scope: 'environment', op: 'set', key: 'later', value: 'yes' })
    expect(out.logs).toContainEqual({ level: 'log', message: 'erreur reçue ECONNREFUSED', source: 'script 1' })
    expect(out.sentRequests.map((r) => r.status ?? r.error)).toEqual([200, 200, 'ECONNREFUSED'])
  })
})

describe('pre-request', () => {
  it('modifie la requête, saute l’envoi et expose les bibliothèques', async () => {
    const out = await runScripts(
      exec(
        `
        pm.request.headers.add({ key: 'X-Sig', value: CryptoJS.HmacSHA256('msg', 'k').toString() })
        pm.request.headers.upsert({ key: 'accept', value: 'application/json' })
        pm.request.url.query.add('b=2')
        pm.request.addQueryParams({ key: 'c', value: '3' })
        pm.request.removeQueryParams('a')
        pm.request.method = 'post'
        pm.request.body.update('{"x":1}')
        console.info(_.sum([1, 2]), require('uuid').v4().length)
        pm.execution.skipRequest()
      `,
        { event: 'prerequest', response: undefined }
      ),
      hooks
    )
    expect(out.error).toBeUndefined()
    expect(out.skipRequest).toBe(true)
    expect(out.request.method).toBe('POST')
    expect(out.request.url).toBe('https://api.example.com/items?b=2&c=3')
    expect(out.request.headers).toEqual([
      { key: 'Accept', value: 'application/json' },
      { key: 'X-Sig', value: CryptoJS.HmacSHA256('msg', 'k').toString() }
    ])
    expect(out.request.body).toEqual({ mode: 'raw', raw: '{"x":1}' })
    expect(out.logs).toEqual([{ level: 'info', message: '3 36', source: 'script 1' }])
  })

  it('arrête la chaîne à la première erreur et indique sa source', async () => {
    const out = await runScripts(exec(['pm.environment.set("a", 1)', 'nope()', 'pm.environment.set("b", 2)'], { event: 'prerequest' }), hooks)
    expect(out.ok).toBe(false)
    expect(out.error).toEqual({ message: 'ReferenceError: nope is not defined', source: 'script 2' })
    expect(out.mutations).toHaveLength(1)
  })

  it('refuse skipRequest et les modules inconnus dans un script de test', async () => {
    expect((await runScripts(exec('pm.execution.skipRequest()'), hooks)).error?.message).toMatch(/TypeError/)
    expect((await runScripts(exec('require("fs")'), hooks)).error?.message).toMatch(/n'est pas disponible/)
  })

  it('rapporte une erreur levée dans une minuterie', async () => {
    const out = await runScripts(exec('setTimeout(() => { throw new Error("tard") }, 5)'), hooks)
    expect(out.error?.message).toBe('Error: tard')
  })
})

describe('erreurs venant d’un autre domaine global', () => {
  it('garde le message d’une erreur créée dans un autre realm (iframe du sandbox)', async () => {
    const { runInNewContext } = await import('node:vm')
    const compile = (params: string[], body: string) => runInNewContext('(p, b) => new Function(...p, b)')(params, body) as (...a: unknown[]) => unknown
    const out = await runScripts(exec('nope()', { event: 'prerequest' }), { ...hooks, compile })
    expect(out.error?.message).toBe('ReferenceError: nope is not defined')
  })
})
