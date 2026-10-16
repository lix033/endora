// Signatures d'auth calculées sur la requête finale (implémentations propres à partir des
// spécifications publiques : RFC 7616 Digest, RFC 5849 OAuth 1.0, Hawk, Akamai EdgeGrid).

import { createHash, createHmac, createSign, randomBytes, randomUUID } from 'node:crypto'
import aws4 from 'aws4'
import { importPKCS8, SignJWT, type JWTHeaderParameters } from 'jose'
import { authBool, authString, type AuthConfig } from '@shared/auth'
import { getHeader, removeHeader, setHeader, type PreparedRequest } from '../http'
import { t } from '@shared/i18n'

export type SignResult = { ok: true; prepared: PreparedRequest } | { ok: false; message: string }

/** Encodage RFC 3986 (OAuth). */
export const rfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

const pathAndQuery = (url: URL): string => `${url.pathname}${url.search}`

/** Préfixe d'en-tête : « Bearer » seulement si le paramètre est absent ; une valeur vide reste vide. */
function headerPrefix(auth: AuthConfig): string {
  const raw = auth.params['headerPrefix']
  return raw === undefined || raw === null ? 'Bearer' : String(raw).trim()
}

function addQuery(p: PreparedRequest, key: string, value: string): PreparedRequest {
  const url = new URL(p.url)
  url.searchParams.append(key, value)
  return { ...p, url }
}

// --- Simples -----------------------------------------------------------------------------------

export function signApiKey(auth: AuthConfig, p: PreparedRequest): SignResult {
  const key = authString(auth, 'key')
  if (key === '') return { ok: true, prepared: p }
  const value = authString(auth, 'value')
  if (authString(auth, 'in') === 'query') return { ok: true, prepared: addQuery(p, key, value) }
  return { ok: true, prepared: { ...p, headers: setHeader(p.headers, key, value) } }
}

export function signBearer(auth: AuthConfig, p: PreparedRequest): SignResult {
  const token = authString(auth, 'token')
  if (token === '') return { ok: true, prepared: p }
  return { ok: true, prepared: { ...p, headers: setHeader(p.headers, 'Authorization', `Bearer ${token}`) } }
}

export function signBasic(auth: AuthConfig, p: PreparedRequest): SignResult {
  const credentials = Buffer.from(`${authString(auth, 'username')}:${authString(auth, 'password')}`, 'utf8').toString('base64')
  return { ok: true, prepared: { ...p, headers: setHeader(p.headers, 'Authorization', `Basic ${credentials}`) } }
}

/** Ajoute un jeton OAuth 2.0 déjà obtenu (en-tête ou paramètre `access_token`). */
export function signOAuth2(auth: AuthConfig, p: PreparedRequest): SignResult {
  const token = authString(auth, 'accessToken')
  if (token === '') return { ok: true, prepared: p }
  if (authString(auth, 'addTokenTo') === 'queryParams') return { ok: true, prepared: addQuery(p, 'access_token', token) }
  const prefix = headerPrefix(auth)
  return { ok: true, prepared: { ...p, headers: setHeader(p.headers, 'Authorization', prefix ? `${prefix} ${token}` : token) } }
}

// --- Digest (RFC 7616) ---------------------------------------------------------------------------

export interface DigestChallenge {
  realm?: string
  nonce?: string
  qop?: string
  opaque?: string
  algorithm?: string
}

/** Lit un en-tête `WWW-Authenticate: Digest …`. */
export function parseDigestChallenge(header: string): DigestChallenge | null {
  const m = /Digest\s+(.*)$/i.exec(header)
  if (!m) return null
  const out: Record<string, string> = {}
  for (const part of m[1]!.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) out[part[1]!.toLowerCase()] = part[2] ?? part[3] ?? ''
  return out
}

const digestHash = (algorithm: string, data: string): string => {
  const base = algorithm.toUpperCase().replace(/-SESS$/, '')
  const node = base === 'SHA-256' ? 'sha256' : base === 'SHA-512-256' ? 'sha512-256' : 'md5'
  return createHash(node).update(data).digest('hex')
}

export function signDigest(auth: AuthConfig, p: PreparedRequest, challenge?: DigestChallenge): SignResult {
  const realm = challenge?.realm ?? authString(auth, 'realm')
  const nonce = challenge?.nonce ?? authString(auth, 'nonce')
  if (!nonce) return { ok: true, prepared: p }
  const username = authString(auth, 'username')
  const password = authString(auth, 'password')
  const algorithm = challenge?.algorithm ?? authString(auth, 'algorithm') ?? 'MD5'
  const offeredQop = challenge?.qop ?? authString(auth, 'qop')
  // Préférence pour `auth` quand le serveur propose plusieurs qop.
  const qops = offeredQop.split(',').map((q) => q.trim()).filter(Boolean)
  const qop = qops.includes('auth') ? 'auth' : (qops[0] ?? '')
  const nc = authString(auth, 'nonceCount') || '00000001'
  const cnonce = authString(auth, 'clientNonce') || randomBytes(8).toString('hex')
  const opaque = challenge?.opaque ?? authString(auth, 'opaque')
  const uri = pathAndQuery(p.url)

  let ha1 = digestHash(algorithm, `${username}:${realm}:${password}`)
  if (/-sess$/i.test(algorithm)) ha1 = digestHash(algorithm, `${ha1}:${nonce}:${cnonce}`)
  const ha2 =
    qop === 'auth-int'
      ? digestHash(algorithm, `${p.method}:${uri}:${digestHash(algorithm, p.body?.toString('utf8') ?? '')}`)
      : digestHash(algorithm, `${p.method}:${uri}`)
  const response = qop ? digestHash(algorithm, `${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : digestHash(algorithm, `${ha1}:${nonce}:${ha2}`)

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `algorithm=${algorithm}`,
    ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`] : []),
    `response="${response}"`,
    ...(opaque ? [`opaque="${opaque}"`] : [])
  ]
  return { ok: true, prepared: { ...p, headers: setHeader(p.headers, 'Authorization', `Digest ${parts.join(', ')}`) } }
}

// --- OAuth 1.0 (RFC 5849) ------------------------------------------------------------------------

export function signOAuth1(auth: AuthConfig, p: PreparedRequest, now = Date.now()): SignResult {
  const consumerKey = authString(auth, 'consumerKey')
  const method = authString(auth, 'signatureMethod') || 'HMAC-SHA1'
  const [family, hashName] = method.split('-') as [string, string | undefined]
  if (!consumerKey) return { ok: true, prepared: p }
  if (family === 'RSA' && !authString(auth, 'privateKey')) return { ok: false, message: t('auth.oauth1NoKey') }

  const isForm = p.bodyMode === 'urlencoded' && p.body !== undefined
  const oauth: Array<[string, string]> = [
    ['oauth_consumer_key', consumerKey],
    ['oauth_token', authString(auth, 'token')],
    ['oauth_signature_method', method],
    ['oauth_timestamp', authString(auth, 'timestamp') || String(Math.floor(now / 1000))],
    ['oauth_nonce', authString(auth, 'nonce') || randomBytes(8).toString('hex')],
    ['oauth_version', authString(auth, 'version') || '1.0'],
    ['oauth_callback', authString(auth, 'callback')],
    ['oauth_verifier', authString(auth, 'verifier')]
  ]
  if (authBool(auth, 'includeBodyHash') && !isForm && hashName) {
    const h = createHash(hashName.toLowerCase()).update(p.body ?? Buffer.alloc(0)).digest('base64')
    oauth.push(['oauth_body_hash', h])
  }
  const signed = authBool(auth, 'addEmptyParamsToSign') ? oauth : oauth.filter(([, v]) => v !== '')

  const params: Array<[string, string]> = [...signed]
  for (const [k, v] of p.url.searchParams) params.push([k, v])
  if (isForm) for (const [k, v] of new URLSearchParams(p.body!.toString('utf8'))) params.push([k, v])
  const normalized = params
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  const baseUrl = `${p.url.protocol}//${p.url.host}${p.url.pathname}`.replace(/:(80|443)(?=\/)/, (m, port) =>
    (port === '80' && p.url.protocol === 'http:') || (port === '443' && p.url.protocol === 'https:') ? '' : m
  )
  const baseString = [p.method.toUpperCase(), rfc3986(baseUrl), rfc3986(normalized)].join('&')
  const key = `${rfc3986(authString(auth, 'consumerSecret'))}&${rfc3986(authString(auth, 'tokenSecret'))}`

  let signature: string
  if (family === 'PLAINTEXT') signature = key
  else if (family === 'RSA') signature = createSign(`RSA-${hashName}`).update(baseString).sign(authString(auth, 'privateKey'), 'base64')
  else signature = createHmac((hashName ?? 'SHA1').toLowerCase(), key).update(baseString).digest('base64')

  const all: Array<[string, string]> = [...signed, ['oauth_signature', signature]]
  if (authBool(auth, 'addParamsToHeader')) {
    const enc = authBool(auth, 'disableHeaderEncoding') ? (s: string) => s : rfc3986
    const realm = authString(auth, 'realm')
    const value = `OAuth ${[...(realm ? [`realm="${realm}"`] : []), ...all.map(([k, v]) => `${k}="${enc(v)}"`)].join(',')}`
    return { ok: true, prepared: { ...p, headers: setHeader(p.headers, 'Authorization', value) } }
  }
  if (isForm) {
    const form = new URLSearchParams(p.body!.toString('utf8'))
    for (const [k, v] of all) form.append(k, v)
    return { ok: true, prepared: { ...p, body: Buffer.from(form.toString()) } }
  }
  let next = p
  for (const [k, v] of all) next = addQuery(next, k, v)
  return { ok: true, prepared: next }
}

// --- Hawk ----------------------------------------------------------------------------------------

export function hawkHeader(input: {
  id: string
  key: string
  algorithm: 'sha256' | 'sha1'
  method: string
  url: URL
  ts: string
  nonce: string
  hash?: string
  ext?: string
  app?: string
  dlg?: string
}): string {
  const port = input.url.port || (input.url.protocol === 'https:' ? '443' : '80')
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
  let normalized =
    `hawk.1.header\n${input.ts}\n${input.nonce}\n${input.method.toUpperCase()}\n${pathAndQuery(input.url)}\n` +
    `${input.url.hostname.toLowerCase()}\n${port}\n${input.hash ?? ''}\n${input.ext ? escape(input.ext) : ''}\n`
  if (input.app) normalized += `${input.app}\n${input.dlg ?? ''}\n`
  const mac = createHmac(input.algorithm, input.key).update(normalized).digest('base64')
  const attrs = [
    `id="${input.id}"`,
    `ts="${input.ts}"`,
    `nonce="${input.nonce}"`,
    ...(input.hash ? [`hash="${input.hash}"`] : []),
    ...(input.ext ? [`ext="${input.ext.replace(/["\\]/g, '\\$&')}"`] : []),
    `mac="${mac}"`,
    ...(input.app ? [`app="${input.app}"`] : []),
    ...(input.app && input.dlg ? [`dlg="${input.dlg}"`] : [])
  ]
  return `Hawk ${attrs.join(', ')}`
}

export function signHawk(auth: AuthConfig, p: PreparedRequest, now = Date.now()): SignResult {
  const id = authString(auth, 'authId')
  const key = authString(auth, 'authKey')
  if (!id || !key) return { ok: true, prepared: p }
  const algorithm = authString(auth, 'algorithm') === 'sha1' ? 'sha1' : 'sha256'
  let hash: string | undefined
  if (authBool(auth, 'includePayloadHash')) {
    const contentType = (getHeader(p.headers, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase()
    hash = createHash(algorithm)
      .update(`hawk.1.payload\n${contentType}\n`)
      .update(p.body ?? Buffer.alloc(0))
      .update('\n')
      .digest('base64')
  }
  const header = hawkHeader({
    id,
    key,
    algorithm,
    method: p.method,
    url: p.url,
    ts: authString(auth, 'timestamp') || String(Math.floor(now / 1000)),
    nonce: authString(auth, 'nonce') || randomBytes(4).toString('base64url').slice(0, 6),
    hash,
    ext: authString(auth, 'extraData') || undefined,
    app: authString(auth, 'app') || undefined,
    dlg: authString(auth, 'delegation') || undefined
  })
  return { ok: true, prepared: { ...p, headers: setHeader(p.headers, 'Authorization', header) } }
}

// --- Akamai EdgeGrid -----------------------------------------------------------------------------

const edgeTimestamp = (d: Date): string =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}T` +
  `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')}+0000`

export function signEdgeGrid(auth: AuthConfig, p: PreparedRequest, now = new Date()): SignResult {
  const accessToken = authString(auth, 'accessToken')
  const clientToken = authString(auth, 'clientToken')
  const clientSecret = authString(auth, 'clientSecret')
  if (!accessToken || !clientToken || !clientSecret) return { ok: true, prepared: p }
  const timestamp = authString(auth, 'timestamp') || edgeTimestamp(now)
  const nonce = authString(auth, 'nonce') || randomUUID()
  const baseUrl = authString(auth, 'baseURL')
  const host = baseUrl ? new URL(baseUrl.includes('://') ? baseUrl : `https://${baseUrl}`).host : p.url.host
  const headersToSign = authString(auth, 'headersToSign')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  const canonical = headersToSign
    .map((h) => {
      const v = getHeader(p.headers, h)
      return v ? `${h}:${v.trim().replace(/\s+/g, ' ')}` : null
    })
    .filter(Boolean)
    .join('\t')
  const maxBody = 131072
  const bodyHash =
    p.method === 'POST' && p.body && p.body.byteLength > 0 ? createHash('sha256').update(p.body.subarray(0, maxBody)).digest('base64') : ''
  const prefix = `EG1-HMAC-SHA256 client_token=${clientToken};access_token=${accessToken};timestamp=${timestamp};nonce=${nonce};`
  const data = [p.method, p.url.protocol.replace(':', ''), host, pathAndQuery(p.url), canonical, bodyHash, prefix].join('\t')
  const signingKey = createHmac('sha256', clientSecret).update(timestamp).digest('base64')
  const signature = createHmac('sha256', signingKey).update(data).digest('base64')
  return { ok: true, prepared: { ...p, headers: setHeader(p.headers, 'Authorization', `${prefix}signature=${signature}`) } }
}

// --- AWS Signature v4 ----------------------------------------------------------------------------

export function signAwsV4(auth: AuthConfig, p: PreparedRequest): SignResult {
  const accessKeyId = authString(auth, 'accessKey')
  const secretAccessKey = authString(auth, 'secretKey')
  if (!accessKeyId || !secretAccessKey) return { ok: true, prepared: p }
  let headers = p.headers
  for (const h of ['Authorization', 'X-Amz-Date', 'X-Amz-Security-Token', 'X-Amz-Content-Sha256']) headers = removeHeader(headers, h)
  const signQuery = authBool(auth, 'addAuthDataToQuery')
  const url = new URL(p.url)
  for (const k of [...url.searchParams.keys()]) if (k.startsWith('X-Amz-')) url.searchParams.delete(k)
  const headerObj: Record<string, string> = {}
  for (const [k, v] of headers) headerObj[k] = v
  const opts: aws4.Request = {
    host: url.host,
    path: pathAndQuery(url),
    method: p.method,
    headers: headerObj,
    body: p.body,
    signQuery,
    ...(authString(auth, 'service') ? { service: authString(auth, 'service') } : {}),
    ...(authString(auth, 'region') ? { region: authString(auth, 'region') } : {})
  }
  const sessionToken = authString(auth, 'sessionToken')
  const signed = aws4.sign(opts, { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) })
  if (signQuery) {
    return { ok: true, prepared: { ...p, headers, url: new URL(`${url.protocol}//${url.host}${signed.path}`) } }
  }
  for (const [k, v] of Object.entries(signed.headers ?? {})) {
    if (/^(authorization|x-amz-)/i.test(k) && v !== undefined) headers = setHeader(headers, k, String(v))
  }
  return { ok: true, prepared: { ...p, headers } }
}

// --- JWT et ASAP ---------------------------------------------------------------------------------

const HMAC_ALGS = ['HS256', 'HS384', 'HS512']

function parseJsonParam(auth: AuthConfig, key: string): Record<string, unknown> {
  const raw = auth.params[key]
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  const text = authString(auth, key).trim()
  if (text === '') return {}
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('auth.notJsonObject', { key }))
  return parsed as Record<string, unknown>
}

export async function signJwt(auth: AuthConfig, p: PreparedRequest): Promise<SignResult> {
  const alg = authString(auth, 'algorithm') || 'HS256'
  try {
    const payload = parseJsonParam(auth, 'payload')
    const header = { ...parseJsonParam(auth, 'header'), alg } as JWTHeaderParameters
    const jwt = new SignJWT(payload).setProtectedHeader(header)
    let token: string
    if (HMAC_ALGS.includes(alg)) {
      const secret = authString(auth, 'secret')
      if (!secret) return { ok: false, message: 'JWT : secret manquant.' }
      token = await jwt.sign(new Uint8Array(Buffer.from(secret, authBool(auth, 'isSecretBase64Encoded') ? 'base64' : 'utf8')))
    } else {
      const pem = authString(auth, 'privateKey')
      if (!pem) return { ok: false, message: t('auth.jwtNoKey') }
      token = await jwt.sign(await importPKCS8(pem, alg))
    }
    if (authString(auth, 'addTokenTo') === 'queryParam') return { ok: true, prepared: addQuery(p, authString(auth, 'queryParamKey') || 'token', token) }
    const prefix = headerPrefix(auth)
    return { ok: true, prepared: { ...p, headers: setHeader(p.headers, 'Authorization', prefix ? `${prefix} ${token}` : token) } }
  } catch (err) {
    return { ok: false, message: `JWT : ${err instanceof Error ? err.message : String(err)}` }
  }
}

export async function signAsap(auth: AuthConfig, p: PreparedRequest, now = Date.now()): Promise<SignResult> {
  try {
    const claims = parseJsonParam(auth, 'claims')
    const iss = (claims['iss'] as string | undefined) ?? authString(auth, 'iss')
    const aud = (claims['aud'] as string | undefined) ?? authString(auth, 'aud')
    const kid = (claims['kid'] as string | undefined) ?? authString(auth, 'kid')
    const privateKey = authString(auth, 'privateKey')
    if (!iss || !aud || !kid || !privateKey) return { ok: false, message: t('auth.asapMissing') }
    const alg = authString(auth, 'alg') || 'RS256'
    const iat = Math.floor(now / 1000)
    const exp = Number.parseInt(authString(auth, 'exp'), 10) || 3600
    const payload = {
      ...claims,
      iss,
      sub: (claims['sub'] as string | undefined) ?? (authString(auth, 'sub') || iss),
      aud,
      jti: (claims['jti'] as string | undefined) ?? randomUUID(),
      iat: (claims['iat'] as number | undefined) ?? iat,
      exp: (claims['exp'] as number | undefined) ?? iat + exp
    }
    const token = await new SignJWT(payload).setProtectedHeader({ alg, kid }).sign(await importPKCS8(privateKey, alg))
    return { ok: true, prepared: { ...p, headers: setHeader(p.headers, 'Authorization', `Bearer ${token}`) } }
  } catch (err) {
    return { ok: false, message: `ASAP : ${err instanceof Error ? err.message : String(err)}` }
  }
}
