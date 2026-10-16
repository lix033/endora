import { describe, expect, it } from 'vitest'
import { runMockScript, type MockScriptInput } from './mock-runtime'

const compile = (params: string[], body: string) => new Function(...params, body) as (...args: unknown[]) => unknown

const input = (script: string, patch: Partial<MockScriptInput> = {}): MockScriptInput => ({
  id: 'x',
  script,
  request: { method: 'POST', path: '/users/7', url: '/users/7?debug=1', query: { debug: '1' }, headers: { 'content-type': 'application/json' }, params: { id: '7' }, body: '{"name":"Ada"}' },
  session: 'alice',
  route: { name: 'Créer', example: 'OK' },
  state: { count: 1 },
  response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '{}' },
  ...patch
})

describe('runMockScript', () => {
  it('sans modification, renvoie la réponse de l’exemple', async () => {
    const out = await runMockScript(input(''), compile)
    expect(out).toMatchObject({ ok: true, response: { status: 200, body: '{}' }, state: { count: 1 } })
  })

  it('lit la requête et construit une réponse', async () => {
    const out = await runMockScript(
      input(`
        const body = pm.request.json()
        pm.response.status(201).header('X-Session', pm.session).json({ id: pm.request.params.id, name: body.name, debug: pm.request.query.debug, type: pm.request.header('Content-Type') })
      `),
      compile
    )
    expect(out.ok).toBe(true)
    expect(out.response.status).toBe(201)
    expect(out.response.headers).toEqual({ 'Content-Type': 'application/json', 'X-Session': 'alice' })
    expect(JSON.parse(out.response.body)).toEqual({ id: '7', name: 'Ada', debug: '1', type: 'application/json' })
  })

  it('met à jour l’état de la session', async () => {
    const out = await runMockScript(input(`pm.state.set('count', pm.state.get('count') + 1); pm.state.set('last', { at: 1 }); pm.state.unset('nothing')`), compile)
    expect(out.state).toEqual({ count: 2, last: { at: 1 } })
  })

  it('attend un script asynchrone et capture la console', async () => {
    const out = await runMockScript(input(`await new Promise((r) => setTimeout(r, 5)); console.log('ok', { a: 1 }); pm.response.send('fini')`), compile)
    expect(out.response.body).toBe('fini')
    expect(out.logs).toEqual([{ level: 'log', message: 'ok {"a":1}' }])
  })

  it('une erreur laisse l’état intact', async () => {
    const out = await runMockScript(input(`pm.state.set('count', 99); throw new Error('boum')`), compile)
    expect(out).toMatchObject({ ok: false, error: 'boum', state: { count: 1 } })
  })

  it('refuse un code de statut invalide', async () => {
    const out = await runMockScript(input(`pm.response.status(42)`), compile)
    expect(out.ok).toBe(false)
    expect(out.error).toContain('42')
  })
})
