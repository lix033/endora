import { describe, expect, it } from 'vitest'
import { buildRoutes, matchRoute, mockPath, pickExample, sanitizeMockPatch, sessionFromHeader } from './mock'
import { emptyDraft, type Collection, type RequestItem } from './model'

const request = (id: string, method: string, url: string, response?: unknown[]): RequestItem => ({
  type: 'request',
  id,
  name: id,
  request: { ...emptyDraft(), method, url },
  ...(response ? { extra: { response } } : {})
})

const example = (name: string, code: number, body: string, raw = '{{baseUrl}}/users') => ({
  name,
  code,
  status: 'OK',
  header: [{ key: 'Content-Type', value: 'application/json' }],
  body,
  originalRequest: { method: 'GET', url: { raw } }
})

const collection: Collection = {
  id: 'c',
  name: 'API',
  auth: null,
  scripts: { prerequest: '', test: '' },
  variables: [],
  items: [
    request('list', 'GET', '{{baseUrl}}/users', [example('Tous', 200, '[1,2]'), example('Actifs', 200, '[1]', '{{baseUrl}}/users?active=true')]),
    request('one', 'GET', '{{baseUrl}}/users/:id', [example('Trouvé', 200, '{"id":1}'), example('Absent', 404, '{}')]),
    request('me', 'GET', 'https://api.test/users/me', [example('Moi', 200, '{"me":true}')]),
    { type: 'folder', id: 'f', name: 'Admin', auth: null, scripts: { prerequest: '', test: '' }, items: [request('create', 'POST', 'localhost:3000/users')] }
  ]
}

describe('mockPath', () => {
  it('retire schéma, hôte, variable de base, query et fragment', () => {
    expect(mockPath('https://api.test/v1/users?x=1#top')).toBe('/v1/users')
    expect(mockPath('{{baseUrl}}/users/:id')).toBe('/users/:id')
    expect(mockPath('localhost:3000/users/')).toBe('/users')
    expect(mockPath('{{baseUrl}}')).toBe('/')
    expect(mockPath('/health')).toBe('/health')
  })
})

describe('routes', () => {
  const routes = buildRoutes(collection)

  it('une route par requête, dossiers compris, avec ses exemples', () => {
    expect(routes.map((r) => `${r.method} ${r.pattern} ${r.examples.length}`)).toEqual([
      'GET /users 2',
      'GET /users/:id 2',
      'GET /users/me 1',
      'POST /users 0'
    ])
  })

  it('préfère le segment littéral au paramètre', () => {
    expect(matchRoute(routes, 'GET', '/users/me')?.route.name).toBe('me')
    const m = matchRoute(routes, 'get', '/users/42')
    expect(m?.route.name).toBe('one')
    expect(m?.params).toEqual({ id: '42' })
  })

  it('aucune route pour une autre méthode ou une autre longueur', () => {
    expect(matchRoute(routes, 'DELETE', '/users')).toBeNull()
    expect(matchRoute(routes, 'GET', '/users/1/posts')).toBeNull()
  })

  it('choisit l’exemple par nom, par code, puis par paramètres de requête', () => {
    const list = routes[0]!
    const one = routes[1]!
    expect(pickExample(list, {}, new URLSearchParams())?.name).toBe('Tous')
    expect(pickExample(list, {}, new URLSearchParams('active=true'))?.name).toBe('Actifs')
    expect(pickExample(one, { 'x-mock-response-code': '404' }, new URLSearchParams())?.name).toBe('Absent')
    expect(pickExample(one, { 'x-mock-response-name': 'absent' }, new URLSearchParams())?.name).toBe('Absent')
    expect(pickExample(routes[3]!, {}, new URLSearchParams())).toBeNull()
  })
})

describe('sessions', () => {
  it('lit l’en-tête seulement si les sessions sont activées', () => {
    expect(sessionFromHeader('alice', true)).toBe('alice')
    expect(sessionFromHeader('alice', false)).toBe('shared')
    expect(sessionFromHeader(undefined, true)).toBe('shared')
    expect(sessionFromHeader('pas valide !', true)).toBe('shared')
    expect(sessionFromHeader(['bob', 'x'], true)).toBe('bob')
  })
})

describe('sanitizeMockPatch', () => {
  it('ne garde que les champs modifiables bien typés', () => {
    expect(sanitizeMockPatch({ name: 'A', port: 1, publicAccess: 'oui', enableSession: false, apiKey: 'x' })).toEqual({ name: 'A', enableSession: false })
    expect(sanitizeMockPatch(null)).toEqual({})
  })
})
