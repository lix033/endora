import { createHash, createHmac, generateKeyPairSync } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AuthConfig, AuthType } from '@shared/auth'
import { DEFAULT_SEND_OPTIONS, getHeader, type PreparedRequest } from '../http'
import { sendWithAuth, signRequest } from './index'
import { md4, ntlmv2Response, ntowfv2, parseType2Message, splitUser } from './ntlm'
import { hawkHeader, signOAuth1 } from './signatures'

const auth = (type: AuthType, params: AuthConfig['params']): AuthConfig => ({ type, params })
const prep = (url: string, patch: Partial<PreparedRequest> = {}): PreparedRequest => ({
  method: 'GET',
  url: new URL(url),
  headers: [],
  bodyMode: 'none',
  ...patch
})

async function signed(a: AuthConfig, p: PreparedRequest): Promise<PreparedRequest> {
  const r = await signRequest(a, p)
  if (!r.ok) throw new Error(r.message)
  return r.prepared
}

describe('signatures simples', () => {
  it('clé d’API en en-tête ou en query', async () => {
    expect(getHeader((await signed(auth('apikey', { key: 'X-Key', value: 's3', in: 'header' }), prep('http://x/a'))).headers, 'x-key')).toBe('s3')
    expect((await signed(auth('apikey', { key: 'k', value: 'v w', in: 'query' }), prep('http://x/a?b=1'))).url.search).toBe('?b=1&k=v+w')
  })

  it('bearer, basic et OAuth 2.0', async () => {
    expect(getHeader((await signed(auth('bearer', { token: 't' }), prep('http://x'))).headers, 'authorization')).toBe('Bearer t')
    expect(getHeader((await signed(auth('basic', { username: 'aladdin', password: 'opensesame' }), prep('http://x'))).headers, 'authorization')).toBe(
      'Basic YWxhZGRpbjpvcGVuc2VzYW1l'
    )
    expect(getHeader((await signed(auth('oauth2', { accessToken: 'tok', headerPrefix: '' }), prep('http://x'))).headers, 'authorization')).toBe('tok')
    expect((await signed(auth('oauth2', { accessToken: 'tok', addTokenTo: 'queryParams' }), prep('http://x/'))).url.search).toBe('?access_token=tok')
  })
})

describe('OAuth 1.0', () => {
  it('reproduit le vecteur de signature HMAC-SHA1 de référence (RFC 5849 / doc publique)', () => {
    const r = signOAuth1(
      auth('oauth1', {
        consumerKey: 'xvz1evFS4wEEPTGEFPHBog',
        consumerSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
        token: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
        tokenSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
        signatureMethod: 'HMAC-SHA1',
        timestamp: '1318622958',
        nonce: 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg',
        addParamsToHeader: true
      }),
      prep('https://api.twitter.com/1.1/statuses/update.json?include_entities=true', {
        method: 'POST',
        bodyMode: 'urlencoded',
        body: Buffer.from('status=Hello%20Ladies%20%2b%20Gentlemen%2c%20a%20signed%20OAuth%20request%21')
      })
    )
    if (!r.ok) throw new Error(r.message)
    expect(getHeader(r.prepared.headers, 'authorization')).toContain('oauth_signature="hCtSmYh%2BiHYCEqBWrE7C7hYmtUk%3D"')
  })
})

describe('Hawk', () => {
  it('reproduit le vecteur du README de la spécification', () => {
    expect(
      hawkHeader({
        id: 'dh37fgj492je',
        key: 'werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn',
        algorithm: 'sha256',
        method: 'GET',
        url: new URL('http://example.com:8000/resource/1?b=1&a=2'),
        ts: '1353832234',
        nonce: 'j4h3g2',
        ext: 'some-app-ext-data'
      })
    ).toBe('Hawk id="dh37fgj492je", ts="1353832234", nonce="j4h3g2", ext="some-app-ext-data", mac="6R4rV5iE+NPoym+WwjeHzjAGXUtLNIxmo1vpMofpLAE="')
  })
})

describe('EdgeGrid', () => {
  it('signe avec le jeton client, le jeton d’accès et le hash du body', async () => {
    const p = await signed(
      auth('edgegrid', { accessToken: 'akab-access', clientToken: 'akab-client', clientSecret: 'secret', nonce: 'n1', timestamp: '20240101T00:00:00+0000' }),
      prep('https://host.akamaiapis.net/path?x=1', { method: 'POST', body: Buffer.from('{"a":1}'), bodyMode: 'raw' })
    )
    const header = getHeader(p.headers, 'authorization')!
    expect(header).toMatch(/^EG1-HMAC-SHA256 client_token=akab-client;access_token=akab-access;timestamp=20240101T00:00:00\+0000;nonce=n1;signature=/)
    const key = createHmac('sha256', 'secret').update('20240101T00:00:00+0000').digest('base64')
    const data = [
      'POST',
      'https',
      'host.akamaiapis.net',
      '/path?x=1',
      '',
      createHash('sha256').update('{"a":1}').digest('base64'),
      header.slice(0, header.indexOf('signature='))
    ].join('\t')
    expect(header.endsWith(`signature=${createHmac('sha256', key).update(data).digest('base64')}`)).toBe(true)
  })
})

describe('AWS Signature v4', () => {
  it('ajoute Authorization et X-Amz-Date, ou signe dans l’URL', async () => {
    const a = auth('awsv4', { accessKey: 'AKID', secretKey: 'SECRET', region: 'eu-west-3', service: 's3', sessionToken: 'tok' })
    const h = (await signed(a, prep('https://bucket.s3.eu-west-3.amazonaws.com/key'))).headers
    expect(getHeader(h, 'authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\/\d{8}\/eu-west-3\/s3\/aws4_request, SignedHeaders=.*, Signature=[0-9a-f]{64}$/)
    expect(getHeader(h, 'x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/)
    expect(getHeader(h, 'x-amz-security-token')).toBe('tok')
    const q = await signed({ ...a, params: { ...a.params, addAuthDataToQuery: true } }, prep('https://bucket.s3.eu-west-3.amazonaws.com/key'))
    expect(q.url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('JWT et ASAP', () => {
  it('signe un JWT HMAC vérifiable', async () => {
    const p = await signed(auth('jwt', { algorithm: 'HS256', secret: 'clé', payload: '{"sub":"42"}', addTokenTo: 'header', headerPrefix: 'Bearer' }), prep('http://x'))
    const token = getHeader(p.headers, 'authorization')!.replace('Bearer ', '')
    const { payload } = await jwtVerify(token, new TextEncoder().encode('clé'))
    expect(payload['sub']).toBe('42')
  })

  it('signe un jeton ASAP RS256 avec kid, iss, aud et expiration', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const p = await signed(auth('asap', { alg: 'RS256', iss: 'svc', aud: 'api', kid: 'svc/key1', privateKey: pem, exp: '60' }), prep('http://x'))
    const token = getHeader(p.headers, 'authorization')!.replace('Bearer ', '')
    expect(decodeProtectedHeader(token)).toEqual({ alg: 'RS256', kid: 'svc/key1' })
    const { payload } = await jwtVerify(token, await importSPKI(publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'RS256'), { audience: 'api', issuer: 'svc' })
    expect(payload['sub']).toBe('svc')
    expect(payload.exp! - payload.iat!).toBe(60)
  })

  it('rapporte une erreur de configuration sans lever', async () => {
    expect(await signRequest(auth('jwt', { algorithm: 'RS256', privateKey: 'pas une clé' }), prep('http://x'))).toMatchObject({ ok: false })
    expect(await signRequest(auth('jwt', { algorithm: 'HS256', secret: 's', payload: '{oups' }), prep('http://x'))).toMatchObject({ ok: false })
  })
})

describe('NTLM : primitives', () => {
  it('MD4 conforme à la RFC 1320', () => {
    expect(md4(Buffer.from('')).toString('hex')).toBe('31d6cfe0d16ae931b73c59d7e0c089c0')
    expect(md4(Buffer.from('abc')).toString('hex')).toBe('a448017aaf21d8525fc10ae87aa6729d')
    expect(md4(Buffer.from('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).toString('hex')).toBe(
      'e33b4ddc9c38f2199c3e7b164fcc0536'
    )
  })

  it('NTOWFv2 conforme au vecteur MS-NLMP 4.2.4', () => {
    expect(ntowfv2('Password', 'User', 'Domain').toString('hex')).toBe('0c868a403bfd7a93a3001ef22ef02e3f')
  })

  it('découpe DOMAINE\\utilisateur et utilisateur@domaine', () => {
    expect(splitUser('CORP\\alice', '')).toEqual({ user: 'alice', domain: 'CORP' })
    expect(splitUser('alice@corp.local', '')).toEqual({ user: 'alice', domain: 'corp.local' })
    expect(splitUser('alice', 'X')).toEqual({ user: 'alice', domain: 'X' })
  })
})

// --- Échanges réels avec défi ----------------------------------------------------------------

let server: Server
let base: string
const seen: string[] = []

function readType3(header: string) {
  const buf = Buffer.from(header.slice(5), 'base64')
  const field = (off: number) => buf.subarray(buf.readUInt32LE(off + 4), buf.readUInt32LE(off + 4) + buf.readUInt16LE(off))
  return { nt: field(20), domain: field(28).toString('utf16le'), user: field(36).toString('utf16le') }
}

const SERVER_CHALLENGE = Buffer.from('0123456789abcdef', 'hex')

function ntlmType2(): string {
  const targetInfo = Buffer.from([2, 0, 8, 0, ...Buffer.from('CORP', 'utf16le'), 0, 0, 0, 0])
  const msg = Buffer.alloc(48 + targetInfo.length)
  Buffer.from('NTLMSSP\0').copy(msg)
  msg.writeUInt32LE(2, 8)
  msg.writeUInt32LE(0x00808205 >>> 0, 20)
  SERVER_CHALLENGE.copy(msg, 24)
  msg.writeUInt16LE(targetInfo.length, 40)
  msg.writeUInt16LE(targetInfo.length, 42)
  msg.writeUInt32LE(48, 44)
  targetInfo.copy(msg, 48)
  return `NTLM ${msg.toString('base64')}`
}

const sockets = new WeakMap<object, string>()

function handleNtlm(req: IncomingMessage, res: import('node:http').ServerResponse) {
  const h = req.headers.authorization
  const socketId = sockets.get(req.socket) ?? String(Math.random())
  sockets.set(req.socket, socketId)
  seen.push(`${socketId}:${h ? h.slice(0, 12) : 'none'}`)
  if (!h) return res.writeHead(401, { 'www-authenticate': 'NTLM' }).end()
  const type = Buffer.from(h.slice(5), 'base64').readUInt32LE(8)
  if (type === 1) return res.writeHead(401, { 'www-authenticate': ntlmType2() }).end()
  const t3 = readType3(h)
  const key = ntowfv2('s3cret', t3.user, t3.domain)
  const blob = t3.nt.subarray(16)
  const expected = createHmac('md5', key).update(Buffer.concat([SERVER_CHALLENGE, blob])).digest()
  const ok = expected.equals(t3.nt.subarray(0, 16)) && t3.user === 'alice' && t3.domain === 'CORP'
  res.writeHead(ok ? 200 : 403).end(ok ? 'ntlm ok' : 'refusé')
}

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/ntlm')) return handleNtlm(req, res)
    if (req.url?.startsWith('/digest')) {
      const h = req.headers.authorization
      if (!h) {
        return res.writeHead(401, { 'www-authenticate': 'Digest realm="test@endora", qop="auth,auth-int", nonce="abc123", opaque="op"' }).end()
      }
      const f = Object.fromEntries([...h.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)].map((m) => [m[1], m[2] ?? m[3]]))
      const md5 = (s: string) => createHash('md5').update(s).digest('hex')
      const expected = md5(`${md5(`bob:test@endora:pw`)}:abc123:${f['nc']}:${f['cnonce']}:auth:${md5(`GET:${f['uri']}`)}`)
      const ok = f['response'] === expected && f['opaque'] === 'op' && f['uri'] === '/digest?x=1'
      return res.writeHead(ok ? 200 : 401).end(ok ? 'digest ok' : 'mauvais digest')
    }
    res.end('ok')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => server.close())

const text = (r: Awaited<ReturnType<typeof sendWithAuth>>) => (r.ok ? `${r.status} ${Buffer.from(r.bodyBase64, 'base64').toString()}` : r.message)

describe('défis serveur', () => {
  it('Digest : répond au défi 401 et passe', async () => {
    const r = await sendWithAuth(auth('digest', { username: 'bob', password: 'pw' }), prep(`${base}/digest?x=1`), DEFAULT_SEND_OPTIONS)
    expect(text(r)).toBe('200 digest ok')
  })

  it('Digest : ne renvoie pas la requête si le rejeu est désactivé', async () => {
    const r = await sendWithAuth(auth('digest', { username: 'bob', password: 'pw', disableRetryRequest: true }), prep(`${base}/digest?x=1`), DEFAULT_SEND_OPTIONS)
    expect(r.ok && r.status).toBe(401)
  })

  it('NTLM : handshake complet sur une seule connexion', async () => {
    seen.length = 0
    const r = await sendWithAuth(auth('ntlm', { username: 'CORP\\alice', password: 's3cret' }), prep(`${base}/ntlm`), DEFAULT_SEND_OPTIONS)
    expect(text(r)).toBe('200 ntlm ok')
    expect(seen).toHaveLength(3)
    expect(new Set(seen.map((s) => s.split(':')[0])).size).toBe(1)
  })

  it('NTLM : mauvais mot de passe refusé', async () => {
    const r = await sendWithAuth(auth('ntlm', { username: 'alice', domain: 'CORP', password: 'faux' }), prep(`${base}/ntlm`), DEFAULT_SEND_OPTIONS)
    expect(r.ok && r.status).toBe(403)
  })

  it('NTLM : lit un message de type 2', () => {
    const t2 = parseType2Message(ntlmType2())!
    expect(t2.challenge.equals(SERVER_CHALLENGE)).toBe(true)
    expect(t2.targetInfo.length).toBeGreaterThan(0)
    expect(ntlmv2Response(Buffer.alloc(16), t2.challenge, Buffer.alloc(8), Buffer.alloc(8), t2.targetInfo).length).toBe(16 + 28 + t2.targetInfo.length + 4)
  })
})
