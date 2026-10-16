import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { Agent, Client, FormData, H2CClient, request, Response, type Dispatcher } from 'undici'
import { buildUrl, rawContentType, type HttpErrorResult, type HttpRequestSpec, type HttpResult } from '@shared/http'
import type { ProtocolVersion } from '@shared/model'
import { t } from '@shared/i18n'

/** Requête prête à partir : c'est sur elle que l'auth signe (URL, en-têtes et body définitifs). */
export interface PreparedRequest {
  method: string
  url: URL
  /** En-têtes dans l'ordre, casse conservée. */
  headers: Array<[string, string]>
  body?: Buffer
  /** Mode du body d'origine (hash de payload pour certaines auth). */
  bodyMode: HttpRequestSpec['body']['mode']
}

export interface SendOptions {
  httpVersion: ProtocolVersion
  /** 0 = aucun délai. */
  timeoutMs: number
  followRedirects: boolean
  maxRedirects: number
  /** 0 = pas de limite. */
  maxResponseBytes: number
  signal?: AbortSignal
  /** Connexion imposée (handshake NTLM sur une même connexion). */
  dispatcher?: Dispatcher
}

export const DEFAULT_SEND_OPTIONS: SendOptions = {
  httpVersion: 'auto',
  timeoutMs: 30_000,
  followRedirects: true,
  maxRedirects: 10,
  maxResponseBytes: 0
}

export function getHeader(headers: Array<[string, string]>, name: string): string | undefined {
  const lower = name.toLowerCase()
  return headers.find(([k]) => k.toLowerCase() === lower)?.[1]
}

/** Remplace (ou ajoute) un en-tête, sans tenir compte de la casse. */
export function setHeader(headers: Array<[string, string]>, name: string, value: string): Array<[string, string]> {
  const lower = name.toLowerCase()
  return [...headers.filter(([k]) => k.toLowerCase() !== lower), [name, value]]
}

export function removeHeader(headers: Array<[string, string]>, name: string): Array<[string, string]> {
  const lower = name.toLowerCase()
  return headers.filter(([k]) => k.toLowerCase() !== lower)
}

const fail = (code: HttpErrorResult['code'], message: string, timeMs = 0): HttpErrorResult => ({ ok: false, code, message, timeMs })

/** Construit la requête finale (URL, en-têtes, body sérialisé). */
export async function prepareRequest(spec: HttpRequestSpec): Promise<{ ok: true; prepared: PreparedRequest } | HttpErrorResult> {
  let url: URL
  try {
    url = buildUrl(spec.url, spec.params)
  } catch {
    return fail('invalid_url', `URL invalide : ${spec.url}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail('invalid_url', `Protocole non pris en charge : ${url.protocol}`)

  let headers: Array<[string, string]> = []
  for (const h of spec.headers) if (h.enabled && h.key !== '') headers.push([h.key, h.value])
  const hasType = () => getHeader(headers, 'content-type') !== undefined

  let body: Buffer | undefined
  switch (spec.body.mode) {
    case 'none':
      break
    case 'raw':
      body = Buffer.from(spec.body.text, 'utf8')
      if (!hasType()) headers.push(['Content-Type', rawContentType(spec.body.language)])
      break
    case 'urlencoded': {
      const form = new URLSearchParams()
      for (const f of spec.body.fields) if (f.enabled && f.key !== '') form.append(f.key, f.value)
      body = Buffer.from(form.toString())
      if (!hasType()) headers.push(['Content-Type', 'application/x-www-form-urlencoded'])
      break
    }
    case 'formdata': {
      const form = new FormData()
      for (const f of spec.body.fields) {
        if (!f.enabled || f.key === '') continue
        if (f.kind !== 'file') {
          form.append(f.key, f.value)
          continue
        }
        try {
          form.append(f.key, new Blob([await readFile(f.value)]), basename(f.value))
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          return fail('file', t('http.fileUnreadable', { key: f.key, reason }))
        }
      }
      // Sérialise le multipart pour obtenir un corps fixe et son boundary.
      const encoded = new Response(form)
      body = Buffer.from(await encoded.arrayBuffer())
      const type = encoded.headers.get('content-type') ?? 'multipart/form-data'
      // Le boundary est imposé : un content-type multipart saisi sans boundary est remplacé.
      headers = setHeader(headers, 'Content-Type', type)
      break
    }
  }
  const method = spec.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD') body = undefined
  return { ok: true, prepared: { method, url, headers, body, bodyMode: spec.body.mode } }
}

// --- Connexions -----------------------------------------------------------------------------

const agents: Partial<Record<'h1' | 'alpn', Agent>> = {}
const agentFor = (kind: 'h1' | 'alpn'): Agent => (agents[kind] ??= new Agent({ allowH2: kind === 'alpn' }))

/**
 * Dispatcher selon la version demandée : `http1` interdit h2 ; `auto` laisse l'ALPN négocier ;
 * `http2` utilise h2 via ALPN en https et h2c (sans négociation) en http.
 */
function dispatcherFor(url: URL, version: ProtocolVersion): { dispatcher: Dispatcher; dispose?: () => Promise<void> } {
  if (version === 'http1') return { dispatcher: agentFor('h1') }
  if (version === 'http2' && url.protocol === 'http:') {
    const client = new H2CClient(url.origin)
    return { dispatcher: client, dispose: () => client.close() }
  }
  return { dispatcher: agentFor('alpn') }
}

/** Client sur une connexion unique, pour les échanges qui doivent rester sur le même socket (NTLM). */
export function singleConnection(url: URL): Client {
  return new Client(url.origin, { pipelining: 1, allowH2: false })
}

const toFlat = (headers: Array<[string, string]>): string[] => headers.flatMap(([k, v]) => [k, v])

export async function sendPrepared(p: PreparedRequest, opts: SendOptions = DEFAULT_SEND_OPTIONS): Promise<HttpResult> {
  const started = performance.now()
  const elapsed = (): number => Math.round(performance.now() - started)
  const timeoutSignal = opts.timeoutMs > 0 ? AbortSignal.timeout(opts.timeoutMs) : undefined
  const signals = [opts.signal, timeoutSignal].filter((s): s is AbortSignal => s !== undefined)
  const combined = signals.length > 0 ? AbortSignal.any(signals) : undefined

  let currentUrl = p.url
  let method = p.method
  let body = p.body
  let headers = p.headers
  const disposers: Array<() => Promise<void>> = []
  try {
    for (let redirects = 0; ; redirects++) {
      const chosen = opts.dispatcher ? { dispatcher: opts.dispatcher } : dispatcherFor(currentUrl, opts.httpVersion)
      if (chosen.dispose) disposers.push(chosen.dispose)
      const res = await request(currentUrl, {
        method: method as Dispatcher.HttpMethod,
        headers: toFlat(headers),
        body,
        signal: combined,
        dispatcher: chosen.dispatcher
      })
      const location = res.headers['location']
      const isRedirect = res.statusCode >= 300 && res.statusCode < 400 && typeof location === 'string'
      if (isRedirect && opts.followRedirects && redirects < opts.maxRedirects) {
        await res.body.dump()
        const next = new URL(location, currentUrl)
        // Les identifiants ne suivent pas une redirection vers une autre origine.
        if (next.origin !== currentUrl.origin) headers = removeHeader(removeHeader(headers, 'authorization'), 'cookie')
        currentUrl = next
        if (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === 'POST')) {
          method = 'GET'
          body = undefined
          headers = removeHeader(removeHeader(headers, 'content-type'), 'content-length')
        }
        continue
      }

      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of res.body) {
        size += (chunk as Buffer).byteLength
        if (opts.maxResponseBytes > 0 && size > opts.maxResponseBytes) {
          res.body.destroy()
          return fail('too_large', t('http.tooLarge', { mb: Math.round(opts.maxResponseBytes / 1024 / 1024) }), elapsed())
        }
        chunks.push(chunk as Buffer)
      }
      const buf = Buffer.concat(chunks)
      const headerPairs: Array<[string, string]> = []
      for (const [k, v] of Object.entries(res.headers)) {
        if (v === undefined) continue
        for (const value of Array.isArray(v) ? v : [v]) headerPairs.push([k, value])
      }
      const ct = res.headers['content-type']
      return {
        ok: true,
        status: res.statusCode,
        statusText: STATUS_TEXT[res.statusCode] ?? '',
        headers: headerPairs,
        bodyBase64: buf.toString('base64'),
        contentType: typeof ct === 'string' ? ct : null,
        sizeBytes: buf.byteLength,
        timeMs: elapsed(),
        finalUrl: currentUrl.toString(),
        sent: { method, url: currentUrl.toString(), headers }
      }
    }
  } catch (err) {
    if (timeoutSignal?.aborted) return fail('timeout', t('http.timeout', { ms: opts.timeoutMs ?? 0 }), elapsed())
    if (opts.signal?.aborted) return fail('aborted', t('http.aborted'), elapsed())
    const message = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err)
    return fail('network', message, elapsed())
  } finally {
    for (const dispose of disposers) void dispose().catch(() => undefined)
  }
}

/** Exécute une requête HTTP dans le process principal. Ne lève jamais : les échecs attendus sont des résultats. */
export async function executeHttp(spec: HttpRequestSpec, signal?: AbortSignal, opts: Partial<SendOptions> = {}): Promise<HttpResult> {
  const prepared = await prepareRequest(spec)
  if (!prepared.ok) return prepared
  return sendPrepared(prepared.prepared, { ...DEFAULT_SEND_OPTIONS, timeoutMs: spec.timeoutMs ?? DEFAULT_SEND_OPTIONS.timeoutMs, ...opts, signal })
}

export const STATUS_TEXT: Record<number, string> = {
  100: 'Continue', 101: 'Switching Protocols',
  200: 'OK', 201: 'Created', 202: 'Accepted', 203: 'Non-Authoritative Information', 204: 'No Content', 206: 'Partial Content',
  301: 'Moved Permanently', 302: 'Found', 303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
  400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed',
  406: 'Not Acceptable', 408: 'Request Timeout', 409: 'Conflict', 410: 'Gone', 411: 'Length Required', 412: 'Precondition Failed',
  413: 'Payload Too Large', 414: 'URI Too Long', 415: 'Unsupported Media Type', 418: "I'm a teapot", 422: 'Unprocessable Entity',
  425: 'Too Early', 428: 'Precondition Required', 429: 'Too Many Requests', 431: 'Request Header Fields Too Large',
  500: 'Internal Server Error', 501: 'Not Implemented', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout'
}
