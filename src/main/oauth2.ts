// Obtention d'un jeton OAuth 2.0 (RFC 6749 / RFC 7636 PKCE).
// Code d'autorisation et implicite : page d'autorisation dans une fenêtre dédiée (session
// séparée), l'URL de redirection est interceptée sans être chargée.

import { createHash, randomBytes } from 'node:crypto'
import { BrowserWindow, session } from 'electron'
import { authString, type AuthConfig } from '@shared/auth'
import type { OAuth2TokenResult } from '@shared/api'
import { executeHttp } from './http'
import { t } from '@shared/i18n'

export const base64url = (b: Buffer): string => b.toString('base64url')

export function pkcePair(verifier?: string, method: 'S256' | 'plain' = 'S256'): { verifier: string; challenge: string } {
  const v = verifier || base64url(randomBytes(32))
  return { verifier: v, challenge: method === 'plain' ? v : base64url(createHash('sha256').update(v).digest()) }
}

export function buildAuthorizationUrl(auth: AuthConfig, extra: { state: string; challenge?: string }): string {
  const url = new URL(authString(auth, 'authUrl'))
  const implicit = authString(auth, 'grant_type') === 'implicit'
  url.searchParams.set('response_type', implicit ? 'token' : 'code')
  url.searchParams.set('client_id', authString(auth, 'clientId'))
  const redirect = authString(auth, 'redirect_uri')
  if (redirect) url.searchParams.set('redirect_uri', redirect)
  const scope = authString(auth, 'scope')
  if (scope) url.searchParams.set('scope', scope)
  url.searchParams.set('state', extra.state)
  if (extra.challenge) {
    url.searchParams.set('code_challenge', extra.challenge)
    url.searchParams.set('code_challenge_method', authString(auth, 'challengeAlgorithm') || 'S256')
  }
  return url.toString()
}

export type RedirectOutcome =
  | { kind: 'code'; code: string; state: string | null }
  | { kind: 'token'; params: URLSearchParams }
  | { kind: 'error'; message: string }
  | null

/** Analyse une URL vers laquelle la page d'autorisation redirige ; `null` si ce n'est pas la redirection attendue. */
export function parseRedirect(target: string, redirectUri: string): RedirectOutcome {
  if (!redirectUri || !target.startsWith(redirectUri)) return null
  const url = new URL(target)
  const params = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : '')
  for (const [k, v] of url.searchParams) if (!params.has(k)) params.set(k, v)
  const error = params.get('error')
  if (error) return { kind: 'error', message: `${error}${params.get('error_description') ? ` : ${params.get('error_description')}` : ''}` }
  if (params.get('access_token')) return { kind: 'token', params }
  const code = params.get('code')
  if (code) return { kind: 'code', code, state: params.get('state') }
  return { kind: 'error', message: t('oauth.noCode') }
}

function tokenFromParams(params: Record<string, unknown>): OAuth2TokenResult {
  const accessToken = params['access_token']
  if (typeof accessToken !== 'string' || accessToken === '') {
    const err = params['error']
    return { ok: false, message: typeof err === 'string' ? `${err}${params['error_description'] ? ` : ${String(params['error_description'])}` : ''}` : t('oauth.noToken') }
  }
  return {
    ok: true,
    accessToken,
    tokenType: typeof params['token_type'] === 'string' ? params['token_type'] : undefined,
    refreshToken: typeof params['refresh_token'] === 'string' ? params['refresh_token'] : undefined,
    expiresIn: params['expires_in'] !== undefined ? Number(params['expires_in']) : undefined,
    scope: typeof params['scope'] === 'string' ? params['scope'] : undefined
  }
}

/** Échange au point de terminaison du jeton (code, mot de passe, identifiants client). */
export async function requestToken(auth: AuthConfig, form: Record<string, string>): Promise<OAuth2TokenResult> {
  const tokenUrl = authString(auth, 'accessTokenUrl')
  if (!tokenUrl) return { ok: false, message: t('oauth.noTokenUrl') }
  const clientId = authString(auth, 'clientId')
  const clientSecret = authString(auth, 'clientSecret')
  const headers = [
    { id: 'a', key: 'Accept', value: 'application/json', enabled: true },
    { id: 'c', key: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true }
  ]
  const fields = Object.entries(form).filter(([, v]) => v !== '')
  if (authString(auth, 'client_authentication') === 'body') {
    fields.push(['client_id', clientId])
    if (clientSecret) fields.push(['client_secret', clientSecret])
  } else {
    headers.push({ id: 'b', key: 'Authorization', value: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`, enabled: true })
  }
  const res = await executeHttp({
    method: 'POST',
    url: tokenUrl,
    params: [],
    headers,
    body: { mode: 'urlencoded', fields: fields.map(([key, value], i) => ({ id: String(i), key, value, enabled: true })) }
  })
  if (!res.ok) return { ok: false, message: res.message }
  const text = Buffer.from(res.bodyBase64, 'base64').toString('utf8')
  let params: Record<string, unknown>
  try {
    params = JSON.parse(text) as Record<string, unknown>
  } catch {
    params = Object.fromEntries(new URLSearchParams(text))
  }
  if (res.status >= 400 && !params['error']) return { ok: false, message: t('oauth.status', { status: res.status }) }
  return tokenFromParams(params)
}

/** Ouvre la page d'autorisation et attend la redirection. */
function authorize(auth: AuthConfig, parent: BrowserWindow | null): Promise<RedirectOutcome> {
  const redirectUri = authString(auth, 'redirect_uri')
  const state = authString(auth, 'state') || base64url(randomBytes(12))
  const pkce = authString(auth, 'grant_type') === 'authorization_code_with_pkce'
    ? pkcePair(authString(auth, 'code_verifier'), authString(auth, 'challengeAlgorithm') === 'plain' ? 'plain' : 'S256')
    : null
  const url = buildAuthorizationUrl(auth, { state, challenge: pkce?.challenge })
  verifiers.set(state, pkce?.verifier ?? '')
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent ?? undefined,
      title: 'Autorisation OAuth 2.0',
      webPreferences: { session: session.fromPartition('endora-oauth2'), sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    let settled = false
    const finish = (outcome: RedirectOutcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
      if (!win.isDestroyed()) win.close()
    }
    const inspect = (event: { preventDefault(): void }, target: string) => {
      const outcome = parseRedirect(target, redirectUri)
      if (!outcome) return
      event.preventDefault()
      if (outcome.kind === 'code' && outcome.state !== state) finish({ kind: 'error', message: t('oauth.badState') })
      else finish(outcome)
    }
    win.webContents.on('will-redirect', (e, target) => inspect(e, target))
    win.webContents.on('will-navigate', (e, target) => inspect(e, target))
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('closed', () => finish({ kind: 'error', message: t('oauth.windowClosed') }))
    void win.loadURL(url).catch(() => undefined)
  })
}

/** Code verifier PKCE par valeur de `state`, le temps de l'échange. */
const verifiers = new Map<string, string>()

export async function getOAuth2Token(auth: AuthConfig, parent: BrowserWindow | null): Promise<OAuth2TokenResult> {
  const grant = authString(auth, 'grant_type') || 'authorization_code'
  const scope = authString(auth, 'scope')
  try {
    if (grant === 'client_credentials') return await requestToken(auth, { grant_type: 'client_credentials', scope })
    if (grant === 'password_credentials') {
      return await requestToken(auth, { grant_type: 'password', username: authString(auth, 'username'), password: authString(auth, 'password'), scope })
    }
    if (!authString(auth, 'authUrl')) return { ok: false, message: t('oauth.noAuthUrl') }
    if (!authString(auth, 'redirect_uri')) return { ok: false, message: t('oauth.noRedirectUrl') }
    const outcome = await authorize(auth, parent)
    if (!outcome || outcome.kind === 'error') return { ok: false, message: outcome?.message ?? t('oauth.interrupted') }
    if (outcome.kind === 'token') return tokenFromParams(Object.fromEntries(outcome.params))
    const verifier = outcome.state ? (verifiers.get(outcome.state) ?? '') : ''
    if (outcome.state) verifiers.delete(outcome.state)
    return await requestToken(auth, {
      grant_type: 'authorization_code',
      code: outcome.code,
      redirect_uri: authString(auth, 'redirect_uri'),
      ...(verifier ? { code_verifier: verifier } : {})
    })
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
