// Envoi avec authentification. La plupart des types signent la requête finale avant l'envoi ;
// Digest et NTLM répondent au défi du serveur (401) en renvoyant la requête, sauf si
// « disableRetryRequest » est coché (comportement de référence observé).

import { authBool, authString, type AuthConfig } from '@shared/auth'
import type { HttpErrorResult, HttpResult } from '@shared/http'
import { sendPrepared, singleConnection, type PreparedRequest, type SendOptions } from '../http'
import { createType1Message, createType3Message, parseType2Message } from './ntlm'
import {
  parseDigestChallenge,
  signApiKey,
  signAsap,
  signAwsV4,
  signBasic,
  signBearer,
  signDigest,
  signEdgeGrid,
  signHawk,
  signJwt,
  signOAuth1,
  signOAuth2,
  type SignResult
} from './signatures'
import { t } from '@shared/i18n'

const authError = (message: string): HttpErrorResult => ({ ok: false, code: 'auth', message, timeMs: 0 })

function challengeHeaders(res: HttpResult): string[] {
  return res.ok ? res.headers.filter(([k]) => k.toLowerCase() === 'www-authenticate').map(([, v]) => v) : []
}

/** Signature avant envoi (types sans défi). */
export async function signRequest(auth: AuthConfig, p: PreparedRequest): Promise<SignResult> {
  switch (auth.type) {
    case 'apikey':
      return signApiKey(auth, p)
    case 'bearer':
      return signBearer(auth, p)
    case 'basic':
      return signBasic(auth, p)
    case 'oauth2':
      return signOAuth2(auth, p)
    case 'oauth1':
      return signOAuth1(auth, p)
    case 'hawk':
      return signHawk(auth, p)
    case 'edgegrid':
      return signEdgeGrid(auth, p)
    case 'awsv4':
      return signAwsV4(auth, p)
    case 'jwt':
      return signJwt(auth, p)
    case 'asap':
      return signAsap(auth, p)
    case 'digest':
      return signDigest(auth, p)
    default:
      return { ok: true, prepared: p }
  }
}

async function sendDigest(auth: AuthConfig, p: PreparedRequest, opts: SendOptions): Promise<HttpResult> {
  const first = signDigest(auth, p)
  if (!first.ok) return authError(first.message)
  const res = await sendPrepared(first.prepared, opts)
  if (!res.ok || res.status !== 401 || authBool(auth, 'disableRetryRequest')) return res
  const challenge = challengeHeaders(res)
    .map(parseDigestChallenge)
    .find((c) => c !== null)
  if (!challenge?.nonce) return res
  const signed = signDigest(auth, p, challenge)
  if (!signed.ok) return authError(signed.message)
  return sendPrepared(signed.prepared, opts)
}

async function sendNtlm(auth: AuthConfig, p: PreparedRequest, opts: SendOptions): Promise<HttpResult> {
  // Le handshake NTLM authentifie la connexion : les trois échanges utilisent le même socket.
  const client = singleConnection(p.url)
  const local: SendOptions = { ...opts, dispatcher: client, followRedirects: false }
  try {
    const first = await sendPrepared(p, local)
    if (!first.ok || (first.status !== 401 && first.status !== 403) || authBool(auth, 'disableRetryRequest')) return first
    if (!challengeHeaders(first).some((h) => /^(NTLM|Negotiate)\b/i.test(h))) return first

    const negotiate = await sendPrepared({ ...p, headers: [...p.headers.filter(([k]) => k.toLowerCase() !== 'authorization'), ['Authorization', createType1Message()]] }, local)
    if (!negotiate.ok) return negotiate
    const type2Header = challengeHeaders(negotiate).find((h) => h.startsWith('NTLM '))
    const type2 = type2Header ? parseType2Message(type2Header) : null
    if (!type2) return authError(t('auth.ntlmNoType2'))

    const type3 = createType3Message(type2, {
      username: authString(auth, 'username'),
      password: authString(auth, 'password'),
      domain: authString(auth, 'domain'),
      workstation: authString(auth, 'workstation')
    })
    return await sendPrepared({ ...p, headers: [...p.headers.filter(([k]) => k.toLowerCase() !== 'authorization'), ['Authorization', type3]] }, local)
  } finally {
    void client.close().catch(() => undefined)
  }
}

/** Envoie une requête préparée en appliquant l'auth effective (`null` = aucune). */
export async function sendWithAuth(auth: AuthConfig | null, p: PreparedRequest, opts: SendOptions): Promise<HttpResult> {
  if (!auth || auth.type === 'noauth') return sendPrepared(p, opts)
  if (auth.type === 'digest') return sendDigest(auth, p, opts)
  if (auth.type === 'ntlm') return sendNtlm(auth, p, opts)
  const signed = await signRequest(auth, p)
  if (!signed.ok) return authError(signed.message)
  return sendPrepared(signed.prepared, opts)
}
