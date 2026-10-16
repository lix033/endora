import { Agent, fetch, type RequestInit } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportCollection } from '@shared/collection-v21'
import { emptyDraft, type Collection } from '@shared/model'
import type { MockConfig, MockEvent, MockState } from '@shared/mock'
import { runMockScript } from '@shared/scripting/mock-runtime'
import { MockManager } from './mock'

const compile = (params: string[], body: string) => new Function(...params, body) as (...args: unknown[]) => unknown

function collection(body: string): Collection {
  return {
    id: 'col',
    name: 'Boutique',
    auth: null,
    scripts: { prerequest: '', test: '' },
    variables: [],
    items: [
      {
        type: 'request',
        id: 'products',
        name: 'Produits',
        request: { ...emptyDraft(), url: '{{baseUrl}}/products' },
        extra: { response: [{ name: 'Liste', code: 200, header: [{ key: 'Content-Type', value: 'application/json' }], body, originalRequest: { url: { raw: '{{baseUrl}}/products' } } }] }
      },
      { type: 'request', id: 'orders', name: 'Commandes', request: { ...emptyDraft(), method: 'POST', url: '{{baseUrl}}/orders' } }
    ]
  }
}

let stored: Record<string, unknown>
let saved: MockConfig[]
let events: MockEvent[]
let manager: MockManager
// Pool de connexions propre à chaque test : un même port est réattribué d'un test à l'autre.
let agent: Agent

beforeEach(() => {
  stored = { col: exportCollection(collection('["v1"]')) }
  saved = []
  events = []
  agent = new Agent()
  manager = new MockManager({
    readCollection: async (id) => stored[id] ?? null,
    runScript: (input) => runMockScript(input, compile),
    save: async (configs) => {
      saved = configs
    },
    emit: (e) => events.push(e)
  })
})

afterEach(async () => {
  await manager.dispose()
  await agent.close()
})

async function create(patch: Partial<{ publicAccess: boolean; autoDeploy: boolean; enableSession: boolean }> = {}): Promise<MockState> {
  const r = await manager.create({ name: 'Mock boutique', collectionId: 'col', publicAccess: true, autoDeploy: true, enableSession: true, ...patch })
  if (!r.ok) throw new Error(r.message)
  return r.mock
}

const get = (mock: MockState, path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${mock.config.port}${path}`, { ...init, dispatcher: agent })

describe('MockManager', () => {
  it('crée un mock qui sert les exemples de la collection', async () => {
    const mock = await create()
    expect(mock).toMatchObject({ running: true, routes: 2, examples: 1, collectionName: 'Boutique' })
    expect(mock.url).toBe(`http://localhost:${mock.config.port}`)
    const res = await get(mock, '/products')
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.json()).toEqual(['v1'])
    expect(saved).toHaveLength(1)
    expect(manager.getLogs(mock.config.id)[0]).toMatchObject({ method: 'GET', path: '/products', status: 200, route: 'Produits', example: 'Liste' })
  })

  it('404 explicite : requête sans exemple, chemin inconnu', async () => {
    const mock = await create()
    const noExample = await get(mock, '/orders', { method: 'POST' })
    expect(noExample.status).toBe(404)
    expect(((await noExample.json()) as { error: string }).error).toContain('Commandes')
    const unknown = await get(mock, '/nothing')
    expect(unknown.status).toBe(404)
    expect(await unknown.json()).toMatchObject({ method: 'GET', path: '/nothing' })
  })

  it('mock privé : clé obligatoire', async () => {
    const mock = await create({ publicAccess: false })
    expect((await get(mock, '/products')).status).toBe(401)
    expect((await get(mock, '/products', { headers: { 'x-mock-key': 'faux' } })).status).toBe(401)
    expect((await get(mock, '/products', { headers: { 'x-mock-key': mock.config.apiKey } })).status).toBe(200)
  })

  it('déploiement automatique : sert la collection dès son enregistrement', async () => {
    const mock = await create()
    stored['col'] = exportCollection(collection('["v2"]'))
    await manager.collectionSaved('col')
    expect(await (await get(mock, '/products')).json()).toEqual(['v2'])
  })

  it('déploiement manuel : version figée jusqu’au prochain déploiement', async () => {
    const mock = await create({ autoDeploy: false })
    stored['col'] = exportCollection(collection('["v2"]'))
    await manager.collectionSaved('col')
    expect(await (await get(mock, '/products')).json()).toEqual(['v1'])
    await manager.deploy(mock.config.id)
    expect(await (await get(mock, '/products')).json()).toEqual(['v2'])
  })

  it('script injecté : réponse dynamique et état propre à chaque session', async () => {
    const mock = await create()
    await manager.update(mock.config.id, {
      script: `
        const n = (pm.state.get('n') || 0) + 1
        pm.state.set('n', n)
        if (pm.route?.name === 'Commandes') pm.response.status(201).json({ order: n, session: pm.session })
      `
    })
    const order = (session?: string) =>
      get(mock, '/orders', { method: 'POST', headers: session ? { 'x-mock-session': session } : {} }).then(async (r) => ({ status: r.status, body: await r.json() }))
    expect(await order('alice')).toEqual({ status: 201, body: { order: 1, session: 'alice' } })
    expect(await order('alice')).toEqual({ status: 201, body: { order: 2, session: 'alice' } })
    expect(await order('bob')).toEqual({ status: 201, body: { order: 1, session: 'bob' } })
    expect(await order()).toEqual({ status: 201, body: { order: 1, session: 'shared' } })
  })

  it('sessions désactivées : un seul état partagé', async () => {
    const mock = await create({ enableSession: false })
    await manager.update(mock.config.id, { script: `pm.state.set('n', (pm.state.get('n') || 0) + 1); pm.response.json(pm.state.get('n'))` })
    await get(mock, '/products', { headers: { 'x-mock-session': 'alice' } })
    const res = await get(mock, '/products', { headers: { 'x-mock-session': 'bob' } })
    expect(await res.json()).toBe(2)
  })

  it('erreur de script : 500 avec le message', async () => {
    const mock = await create()
    await manager.update(mock.config.id, { script: `throw new Error('cassé')` })
    const res = await get(mock, '/products')
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ message: 'cassé' })
  })

  it('arrêt, redémarrage et suppression ; ports distincts', async () => {
    const a = await create()
    const b = await create()
    expect(b.config.port).not.toBe(a.config.port)
    await manager.stop(a.config.id)
    await expect(get(a, '/products')).rejects.toThrow()
    await manager.start(a.config.id)
    expect((await get(a, '/products')).status).toBe(200)
    expect(await manager.remove(a.config.id)).toEqual({ ok: true })
    expect(manager.list().map((m) => m.config.id)).toEqual([b.config.id])
    expect(events.some((e) => e.type === 'log')).toBe(true)
  })

  it('collection introuvable à la création', async () => {
    expect(await manager.create({ name: 'X', collectionId: 'absente', publicAccess: true, autoDeploy: true, enableSession: true })).toEqual({ ok: false, message: 'Collection not found.' })
  })
})
