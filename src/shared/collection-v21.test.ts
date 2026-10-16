import { describe, expect, it } from 'vitest'
import { exportCollection, importCollection, looksLikeCollection, SCHEMA_V21, urlObject } from './collection-v21'
import type { Collection, FolderItem, RequestItem } from './model'

const V20 = 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json'

const sample = {
  info: { _postman_id: 'c-1', name: 'Démo', schema: SCHEMA_V21, description: 'Une collection', version: '1.2.0' },
  item: [
    {
      name: 'Utilisateurs',
      description: { content: 'riche', type: 'text/markdown' },
      auth: { type: 'bearer', bearer: [{ key: 'token', value: 't', type: 'string' }] },
      item: [
        {
          name: 'Créer',
          event: [{ listen: 'test', script: { exec: ['pm.test("ok")'], type: 'text/javascript' } }],
          response: [{ name: 'exemple', code: 201 }],
          request: {
            method: 'post',
            description: 'crée un utilisateur',
            header: [
              { key: 'Content-Type', value: 'application/json', type: 'text' },
              { key: 'X-Off', value: '1', disabled: true, description: 'désactivé' }
            ],
            body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } },
            url: {
              raw: '{{base}}/users?expand=1',
              host: ['{{base}}'],
              path: ['users'],
              query: [
                { key: 'expand', value: '1' },
                { key: 'debug', value: 'true', disabled: true }
              ],
              variable: [{ key: 'id', value: '3' }]
            }
          }
        }
      ]
    },
    { name: 'Ping', request: 'https://example.com/ping?x=1' },
    {
      name: 'GraphQL',
      request: { method: 'POST', url: 'https://example.com/gql', body: { mode: 'graphql', graphql: { query: '{ a }' } } }
    },
    {
      name: 'Upload',
      request: {
        method: 'POST',
        url: 'https://example.com/up',
        body: {
          mode: 'formdata',
          formdata: [
            { key: 'note', value: 'x', type: 'text' },
            { key: 'fichier', src: '/tmp/a.png', type: 'file' }
          ]
        }
      }
    }
  ],
  variable: [{ key: 'base', value: 'https://api.example.com' }],
  event: [
    { listen: 'prerequest', script: { exec: ['pm.variables.set("t", Date.now())'], type: 'text/javascript' } },
    { listen: 'custom', script: { exec: ['x'] } }
  ]
}

function ok(input: unknown, keepIds = false): Collection {
  const r = importCollection(input, { keepIds })
  if (!r.ok) throw new Error(r.message)
  return r.collection
}

describe('importCollection', () => {
  it('importe dossiers, requêtes, params, en-têtes et body', () => {
    const c = ok(sample)
    expect(c.name).toBe('Démo')
    expect(c.description).toBe('Une collection')
    const folder = c.items[0] as FolderItem
    expect(folder.type).toBe('folder')
    const req = folder.items[0] as RequestItem
    expect(req.name).toBe('Créer')
    expect(req.request.method).toBe('POST')
    expect(req.request.url).toBe('{{base}}/users?expand=1')
    expect(req.request.params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['expand', '1', true],
      ['debug', 'true', false]
    ])
    expect(req.request.headers[1]).toMatchObject({ key: 'X-Off', enabled: false, description: 'désactivé' })
    expect(req.request.body).toMatchObject({ mode: 'raw', raw: '{"a":1}', language: 'json' })
  })

  it("accepte une requête réduite à une chaîne d'URL", () => {
    const ping = ok(sample).items[1] as RequestItem
    expect(ping.request.url).toBe('https://example.com/ping?x=1')
    expect(ping.request.params.map((p) => p.key)).toEqual(['x'])
  })

  it('conserve les fichiers form-data', () => {
    const up = ok(sample).items[3] as RequestItem
    expect(up.request.body.formdata[1]).toMatchObject({ key: 'fichier', value: '/tmp/a.png', kind: 'file' })
  })

  it('génère de nouveaux identifiants sauf demande contraire', () => {
    expect(ok(sample).id).not.toBe('c-1')
    expect(ok(sample, true).id).toBe('c-1')
  })

  it('convertit une auth v2.0 vers la forme v2.1', () => {
    const c = ok({
      info: { name: 'v2', schema: V20 },
      auth: { type: 'basic', basic: { username: 'u', password: 'p' } },
      item: [{ name: 'r', request: { url: 'http://x', method: 'GET', header: 'A: 1\nB: deux' } }]
    })
    expect(c.auth).toEqual({ type: 'basic', params: { username: 'u', password: 'p' } })
    expect(exportCollection(c)['auth']).toEqual({
      type: 'basic',
      basic: [
        { key: 'username', value: 'u', type: 'string' },
        { key: 'password', value: 'p', type: 'string' }
      ]
    })
    const r = c.items[0] as RequestItem
    expect(r.request.headers.map((h) => [h.key, h.value])).toEqual([
      ['A', '1'],
      ['B', 'deux']
    ])
  })

  it('reconstruit l’URL quand raw est absent', () => {
    const c = ok({
      info: { name: 'x', schema: SCHEMA_V21 },
      item: [{ name: 'r', request: { url: { protocol: 'https', host: ['api', 'x', 'com'], port: '8443', path: ['v1', 'a'], query: [{ key: 'q', value: '1' }] } } }]
    })
    expect((c.items[0] as RequestItem).request.url).toBe('https://api.x.com:8443/v1/a?q=1')
  })

  it('accepte une collection enveloppée', () => {
    expect(looksLikeCollection({ collection: sample })).toBe(true)
    expect(ok({ collection: sample }).name).toBe('Démo')
  })

  it('refuse les formats non pris en charge sans lever', () => {
    expect(importCollection({ name: 'v1', requests: [], order: [] })).toMatchObject({ ok: false })
    expect(importCollection({ foo: 1 })).toMatchObject({ ok: false })
    expect(importCollection('texte')).toMatchObject({ ok: false })
    expect(importCollection({ info: { name: 'x', schema: 'https://example.com/v9.0.0/collection.json' }, item: [] })).toMatchObject({
      ok: false
    })
    expect(importCollection({ info: { name: 'x' }, item: [42] })).toMatchObject({ ok: false })
  })
})

describe('auth, scripts et variables', () => {
  it('convertit auth, scripts, variables et version HTTP vers le modèle typé', () => {
    const c = ok({
      info: { name: 'x', schema: SCHEMA_V21 },
      auth: { type: 'apikey', apikey: [{ key: 'key', value: 'X-K' }, { key: 'value', value: '{{k}}' }, { key: 'in', value: 'header' }] },
      variable: [{ key: 'base', value: 'http://a' }, { key: 'pwd', value: 's', type: 'secret', disabled: true }],
      item: [
        {
          name: 'r',
          event: [
            { listen: 'prerequest', script: { exec: ['a', 'b'] } },
            { listen: 'test', script: { exec: 'pm.test("ok")' } }
          ],
          protocolProfileBehavior: { protocolVersion: 'http2', followRedirects: false },
          request: { method: 'GET', url: 'http://x', auth: { type: 'noauth' } }
        },
        { name: 'hérite', request: { method: 'GET', url: 'http://x' } }
      ]
    })
    expect(c.auth).toEqual({ type: 'apikey', params: { key: 'X-K', value: '{{k}}', in: 'header' } })
    expect(c.variables.map((v) => [v.key, v.value, v.type, v.enabled])).toEqual([
      ['base', 'http://a', 'default', true],
      ['pwd', 's', 'secret', false]
    ])
    const r = c.items[0] as RequestItem
    expect(r.request.scripts).toEqual({ prerequest: 'a\nb', test: 'pm.test("ok")' })
    expect(r.request.auth).toEqual({ type: 'noauth', params: {} })
    expect(r.request.protocolVersion).toBe('http2')
    expect(r.extra).toEqual({ protocolProfileBehavior: { followRedirects: false } })
    expect((c.items[1] as RequestItem).request.auth).toBeNull()

    const out = exportCollection(c) as { variable: unknown; item: Array<Record<string, unknown>> }
    expect(out.variable).toEqual([{ key: 'base', value: 'http://a' }, { key: 'pwd', value: 's', type: 'secret', disabled: true }])
    expect(out.item[0]!['protocolProfileBehavior']).toEqual({ followRedirects: false, protocolVersion: 'http2' })
    expect(out.item[0]!['event']).toEqual([
      { listen: 'prerequest', script: { type: 'text/javascript', exec: ['a', 'b'] } },
      { listen: 'test', script: { type: 'text/javascript', exec: ['pm.test("ok")'] } }
    ])
    expect((out.item[0]!['request'] as Record<string, unknown>)['auth']).toEqual({ type: 'noauth' })
    expect((out.item[1]!['request'] as Record<string, unknown>)['auth']).toBeUndefined()
  })

  it('garde les valeurs courantes uniquement pour le stockage local', () => {
    const c = ok({ info: { name: 'x', schema: SCHEMA_V21 }, item: [], variable: [{ key: 'a', value: '1' }] })
    c.variables[0]!.current = '2'
    expect(exportCollection(c)['variable']).toEqual([{ key: 'a', value: '1' }])
    const stored = exportCollection(c, { includeCurrentValues: true })
    expect((stored['variable'] as Array<Record<string, unknown>>)[0]).toMatchObject({ key: 'a', value: '1', current: '2' })
    expect(ok(stored, true).variables[0]).toMatchObject({ value: '1', current: '2' })
  })
})

describe('exportCollection', () => {
  it('fait un aller-retour sans perte des champs non édités', () => {
    const exported = exportCollection(ok(sample, true)) as typeof sample & { item: Array<Record<string, unknown>> }
    expect(exported.info).toMatchObject({ _postman_id: 'c-1', name: 'Démo', schema: SCHEMA_V21, version: '1.2.0' })
    expect(exported.variable).toEqual(sample.variable)
    expect(exported.event).toEqual(sample.event)

    const folder = exported.item[0] as { description: unknown; auth: unknown; item: Array<Record<string, unknown>> }
    expect(folder.description).toEqual({ content: 'riche', type: 'text/markdown' })
    expect(folder.auth).toEqual(sample.item[0]!.auth)

    const create = folder.item[0] as { event: unknown; response: unknown; request: Record<string, unknown> }
    expect(create.event).toEqual(sample.item[0]!.item![0]!.event)
    expect(create.response).toEqual([{ name: 'exemple', code: 201 }])
    expect(create.request['description']).toBe('crée un utilisateur')
    expect(create.request['url']).toMatchObject({
      raw: '{{base}}/users?expand=1',
      host: ['{{base}}'],
      path: ['users'],
      query: [{ key: 'expand', value: '1' }, { key: 'debug', value: 'true', disabled: true }],
      variable: [{ key: 'id', value: '3' }]
    })
    expect(create.request['body']).toEqual({ mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } })

    const gql = exported.item[2] as { request: Record<string, unknown> }
    expect(gql.request['body']).toEqual({ mode: 'graphql', graphql: { query: '{ a }' } })

    const up = exported.item[3] as { request: { body: { formdata: unknown[] } } }
    expect(up.request.body.formdata[1]).toEqual({ key: 'fichier', type: 'file', src: '/tmp/a.png' })

    // Réimporter l'export redonne la même collection.
    const again = ok(exported, true)
    expect(exportCollection(again)).toEqual(exported)
  })
})

describe('urlObject', () => {
  it('décompose protocole, hôte, port, chemin, query et ancre', () => {
    expect(
      urlObject('http://localhost:3000/a/b?x=1#top', [
        { id: '1', key: 'x', value: '1', enabled: true },
        { id: '2', key: 'y', value: '2', enabled: false }
      ])
    ).toEqual({
      raw: 'http://localhost:3000/a/b?x=1#top',
      protocol: 'http',
      host: ['localhost'],
      port: '3000',
      path: ['a', 'b'],
      query: [{ key: 'x', value: '1' }, { key: 'y', value: '2', disabled: true }],
      hash: 'top'
    })
  })
})
