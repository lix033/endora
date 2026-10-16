import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HttpRequestSpec, KeyValue } from '@shared/http'
import { executeHttp } from './http'

let server: Server
let base: string

const kv = (key: string, value: string, enabled = true): KeyValue => ({ id: key, key, value, enabled })
const spec = (patch: Partial<HttpRequestSpec>): HttpRequestSpec => ({
  method: 'GET',
  url: base,
  params: [],
  headers: [],
  body: { mode: 'none' },
  ...patch
})

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/echo?from=redirect' }).end()
      return
    }
    if (req.url === '/slow') {
      setTimeout(() => res.end('late'), 2_000)
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(
        JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() })
      )
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
})

function echo(result: Awaited<ReturnType<typeof executeHttp>>) {
  if (!result.ok) throw new Error(result.message)
  return JSON.parse(Buffer.from(result.bodyBase64, 'base64').toString()) as {
    method: string
    url: string
    headers: Record<string, string>
    body: string
  }
}

describe('executeHttp', () => {
  it('ajoute uniquement les params et en-têtes activés', async () => {
    const r = await executeHttp(
      spec({
        url: `${base}/echo?a=1`,
        params: [kv('b', '2'), kv('c', '3', false)],
        headers: [kv('X-Test', 'oui'), kv('X-Off', 'non', false)]
      })
    )
    const e = echo(r)
    expect(e.url).toBe('/echo?a=1&b=2')
    expect(e.headers['x-test']).toBe('oui')
    expect(e.headers['x-off']).toBeUndefined()
  })

  it('envoie un body raw JSON avec le content-type par défaut', async () => {
    const e = echo(await executeHttp(spec({ method: 'POST', body: { mode: 'raw', language: 'json', text: '{"x":1}' } })))
    expect(e.body).toBe('{"x":1}')
    expect(e.headers['content-type']).toBe('application/json')
  })

  it("respecte un content-type fourni par l'utilisateur", async () => {
    const e = echo(
      await executeHttp(
        spec({
          method: 'POST',
          headers: [kv('Content-Type', 'application/vnd.custom+json')],
          body: { mode: 'raw', language: 'json', text: '{}' }
        })
      )
    )
    expect(e.headers['content-type']).toBe('application/vnd.custom+json')
  })

  it('encode un body x-www-form-urlencoded', async () => {
    const e = echo(
      await executeHttp(spec({ method: 'POST', body: { mode: 'urlencoded', fields: [kv('a', 'b c'), kv('d', '&')] } }))
    )
    expect(e.body).toBe('a=b+c&d=%26')
    expect(e.headers['content-type']).toBe('application/x-www-form-urlencoded')
  })

  it('envoie un body multipart form-data', async () => {
    const e = echo(await executeHttp(spec({ method: 'POST', body: { mode: 'formdata', fields: [kv('champ', 'valeur')] } })))
    expect(e.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/)
    expect(e.body).toContain('name="champ"')
    expect(e.body).toContain('valeur')
  })

  it('suit les redirections et rapporte l’URL finale', async () => {
    const r = await executeHttp(spec({ url: `${base}/redirect` }))
    expect(r.ok && r.finalUrl).toBe(`${base}/echo?from=redirect`)
    expect(echo(r).url).toBe('/echo?from=redirect')
  })

  it('ajoute http:// quand le schéma manque', async () => {
    const r = await executeHttp(spec({ url: base.replace('http://', '') + '/echo' }))
    expect(r.ok && r.status).toBe(200)
  })

  it('rapporte un délai dépassé', async () => {
    const r = await executeHttp(spec({ url: `${base}/slow`, timeoutMs: 100 }))
    expect(r).toMatchObject({ ok: false, code: 'timeout' })
  })

  it('rapporte une annulation', async () => {
    const controller = new AbortController()
    const pending = executeHttp(spec({ url: `${base}/slow` }), controller.signal)
    controller.abort()
    expect(await pending).toMatchObject({ ok: false, code: 'aborted' })
  })

  it('rapporte une URL invalide sans lever', async () => {
    expect(await executeHttp(spec({ url: 'http://' }))).toMatchObject({ ok: false, code: 'invalid_url' })
  })

  it('rapporte une erreur réseau', async () => {
    const r = await executeHttp(spec({ url: 'http://127.0.0.1:1' }))
    expect(r).toMatchObject({ ok: false, code: 'network' })
  })
})
