import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importRequest } from '@shared/collection-v21'
import { generateCurl } from '@shared/curl'
import { draftToSpec } from '@shared/model'
import { parseCurl } from './curl'
import { executeHttp } from './http'

let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.close()
})

async function draftFromCurl(text: string) {
  const r = await parseCurl(text)
  if (!r.ok) throw new Error(r.message)
  return importRequest(r.request)
}

async function send(text: string) {
  const res = await executeHttp(draftToSpec(await draftFromCurl(text)))
  if (!res.ok) throw new Error(res.message)
  return JSON.parse(Buffer.from(res.bodyBase64, 'base64').toString()) as {
    method: string
    url: string
    headers: Record<string, string>
    body: string
  }
}

describe('parseCurl', () => {
  it('convertit méthode, URL, query, en-têtes et body JSON', async () => {
    const d = await draftFromCurl(`curl -X PUT '${base}/items?id=3' -H 'X-Test: oui' -H 'Content-Type: application/json' -d '{"a":1}'`)
    expect(d.method).toBe('PUT')
    expect(d.params.map((p) => [p.key, p.value])).toEqual([['id', '3']])
    expect(d.body).toMatchObject({ mode: 'raw', raw: '{"a":1}', language: 'json' })
    expect(d.extra?.['description']).toBeUndefined()
  })

  it('envoie réellement la requête issue d’un cURL collé', async () => {
    const e = await send(`curl '${base}/echo?q=1' -H 'X-Test: oui' --data-urlencode 'a=b c'`)
    expect(e.method).toBe('POST')
    expect(e.url).toBe('/echo?q=1')
    expect(e.headers['x-test']).toBe('oui')
    expect(e.body).toBe('a=b+c')
  })

  it('le cURL généré puis réimporté envoie la même requête', async () => {
    const original = await draftFromCurl(`curl -X PATCH '${base}/p?x=1' -H 'A: 1' -d 'texte libre'`)
    const roundTrip = await draftFromCurl(generateCurl(original))
    const [a, b] = await Promise.all([executeHttp(draftToSpec(original)), executeHttp(draftToSpec(roundTrip))])
    expect(a.ok && b.ok).toBe(true)
    const decode = (r: typeof a) => (r.ok ? JSON.parse(Buffer.from(r.bodyBase64, 'base64').toString()) : null)
    const ea = decode(a)
    const eb = decode(b)
    expect(eb.method).toBe(ea.method)
    expect(eb.url).toBe(ea.url)
    expect(eb.body).toBe(ea.body)
    expect(eb.headers['a']).toBe('1')
  })

  it('rejette un texte qui n’est pas une commande cURL', async () => {
    expect(await parseCurl('https://x.com')).toMatchObject({ ok: false })
    expect(await parseCurl('curl')).toMatchObject({ ok: false })
    expect(await parseCurl(42)).toMatchObject({ ok: false })
  })
})
