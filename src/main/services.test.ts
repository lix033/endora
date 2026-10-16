import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Le module OAuth 2.0 importe Electron pour la fenêtre d'autorisation, inutile ici.
vi.mock('electron', () => ({ BrowserWindow: class {}, session: { fromPartition: () => ({}) } }))

const { buildAuthorizationUrl, parseRedirect, pkcePair, requestToken } = await import('./oauth2')
const { checkForUpdates, compareVersions } = await import('./updates')

let server: Server
let base: string
const received: Array<{ auth?: string; body: string }> = []

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      if (req.url === '/token') {
        received.push({ auth: req.headers.authorization, body })
        const form = new URLSearchParams(body)
        res.setHeader('content-type', 'application/json')
        if (form.get('grant_type') === 'password' && form.get('password') !== 'pw') {
          return res.writeHead(400).end(JSON.stringify({ error: 'invalid_grant', error_description: 'mauvais mot de passe' }))
        }
        return res.end(JSON.stringify({ access_token: `tok-${form.get('grant_type')}`, token_type: 'Bearer', expires_in: 3600, refresh_token: 'r' }))
      }
      if (req.url === '/feed') {
        res.setHeader('content-type', 'application/json')
        return res.end(JSON.stringify({ version: '9.1.0', url: 'https://example.com/dl', notes: 'Nouveautés' }))
      }
      res.writeHead(404).end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => server.close())

const oauth = (params: Record<string, string>) => ({ type: 'oauth2' as const, params: { accessTokenUrl: `${base}/token`, clientId: 'app', clientSecret: 's3', ...params } })

describe('OAuth 2.0', () => {
  it('identifiants client avec authentification Basic, ou dans le body', async () => {
    received.length = 0
    expect(await requestToken(oauth({ scope: 'read' }), { grant_type: 'client_credentials', scope: 'read' })).toMatchObject({
      ok: true,
      accessToken: 'tok-client_credentials',
      refreshToken: 'r',
      expiresIn: 3600
    })
    expect(received[0]!.auth).toBe(`Basic ${Buffer.from('app:s3').toString('base64')}`)
    await requestToken(oauth({ client_authentication: 'body' }), { grant_type: 'client_credentials' })
    expect(received[1]!.auth).toBeUndefined()
    expect(new URLSearchParams(received[1]!.body).get('client_secret')).toBe('s3')
  })

  it('rapporte l’erreur du serveur', async () => {
    expect(await requestToken(oauth({}), { grant_type: 'password', username: 'u', password: 'faux' })).toEqual({
      ok: false,
      message: 'invalid_grant : mauvais mot de passe'
    })
  })

  it('construit l’URL d’autorisation PKCE et lit les redirections', () => {
    const { verifier, challenge } = pkcePair('verifier-fixe')
    expect(challenge).toBe(createHash('sha256').update('verifier-fixe').digest('base64url'))
    expect(verifier).toBe('verifier-fixe')
    const url = new URL(
      buildAuthorizationUrl(
        { type: 'oauth2', params: { authUrl: 'https://idp/authorize', clientId: 'app', redirect_uri: 'https://localhost/cb', scope: 'a b', grant_type: 'authorization_code_with_pkce' } },
        { state: 'st', challenge }
      )
    )
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'app',
      redirect_uri: 'https://localhost/cb',
      scope: 'a b',
      state: 'st',
      code_challenge: challenge,
      code_challenge_method: 'S256'
    })
    expect(parseRedirect('https://localhost/cb?code=abc&state=st', 'https://localhost/cb')).toEqual({ kind: 'code', code: 'abc', state: 'st' })
    expect(parseRedirect('https://localhost/cb#access_token=t&token_type=bearer', 'https://localhost/cb')).toMatchObject({ kind: 'token' })
    expect(parseRedirect('https://localhost/cb?error=access_denied', 'https://localhost/cb')).toEqual({ kind: 'error', message: 'access_denied' })
    expect(parseRedirect('https://idp/login', 'https://localhost/cb')).toBeNull()
  })
})

describe('mises à jour', () => {
  it('compare les versions semver', () => {
    expect(compareVersions('1.2.0', '1.10.0')).toBe(-1)
    expect(compareVersions('v2.0.0', '1.9.9')).toBe(1)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
  })

  it('lit un flux JSON et signale une version plus récente', async () => {
    expect(await checkForUpdates(`${base}/feed`, '0.1.0')).toEqual({
      ok: true,
      current: '0.1.0',
      latest: '9.1.0',
      updateAvailable: true,
      url: 'https://example.com/dl',
      notes: 'Nouveautés'
    })
  })

  it('distingue une source absente ou invalide', async () => {
    expect(await checkForUpdates('', '0.1.0')).toMatchObject({ ok: false, notConfigured: true })
    expect(await checkForUpdates('pas une source', '0.1.0')).toMatchObject({ ok: false })
    expect(await checkForUpdates(`${base}/absent`, '0.1.0')).toMatchObject({ ok: false, message: 'La source a répondu 404.' })
  })
})
