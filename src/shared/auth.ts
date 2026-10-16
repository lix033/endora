// Autorisation : types, champs (noms de paramètres observés dans le moteur de référence pour
// rester compatible avec le format v2.1), conversion v2.1 et héritage dossier → collection.

import { t, type MessageKey } from './i18n'

export type AuthType =
  | 'noauth'
  | 'apikey'
  | 'bearer'
  | 'basic'
  | 'digest'
  | 'oauth1'
  | 'oauth2'
  | 'hawk'
  | 'awsv4'
  | 'ntlm'
  | 'edgegrid'
  | 'jwt'
  | 'asap'

export type AuthParamValue = string | boolean | number | null | Record<string, unknown> | unknown[]

export interface AuthConfig {
  type: AuthType
  params: Record<string, AuthParamValue>
}

export interface AuthField {
  key: string
  label: MessageKey
  kind: 'text' | 'secret' | 'select' | 'checkbox' | 'textarea' | 'json'
  /** Sans `label`, la valeur est affichée telle quelle (MD5, HS256…). */
  options?: Array<{ value: string; label?: MessageKey }>
  default?: string | boolean
  /** Texte d'exemple littéral (X-API-Key, us-east-1…). */
  placeholder?: string
  placeholderKey?: MessageKey
  /** Affiché dans la section « Avancé ». */
  advanced?: boolean
  /** N'affiche le champ que si un autre paramètre a l'une des valeurs indiquées. */
  when?: { key: string; values: string[] }
  hint?: MessageKey
}

const opts = (...values: string[]) => values.map((v) => ({ value: v }))
const HMAC_ALGS = ['HS256', 'HS384', 'HS512']
const ASYM_ALGS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512']

export const AUTH_TYPES: Array<{ type: AuthType; label: MessageKey; fields: AuthField[] }> = [
  { type: 'noauth', label: 'auth.type.noauth', fields: [] },
  {
    type: 'apikey',
    label: 'auth.type.apikey',
    fields: [
      { key: 'key', label: 'auth.f.key', kind: 'text', placeholder: 'X-API-Key' },
      { key: 'value', label: 'auth.f.value', kind: 'secret' },
      { key: 'in', label: 'auth.f.addTo', kind: 'select', default: 'header', options: [{ value: 'header', label: 'auth.f.header' }, { value: 'query', label: 'auth.f.queryParams' }] }
    ]
  },
  { type: 'bearer', label: 'auth.type.bearer', fields: [{ key: 'token', label: 'auth.f.token', kind: 'secret' }] },
  {
    type: 'basic',
    label: 'auth.type.basic',
    fields: [
      { key: 'username', label: 'auth.f.username', kind: 'text' },
      { key: 'password', label: 'auth.f.password', kind: 'secret' }
    ]
  },
  {
    type: 'digest',
    label: 'auth.type.digest',
    fields: [
      { key: 'username', label: 'auth.f.username', kind: 'text' },
      { key: 'password', label: 'auth.f.password', kind: 'secret' },
      { key: 'disableRetryRequest', label: 'auth.f.disableRetry', kind: 'checkbox', default: false, advanced: true },
      { key: 'realm', label: 'auth.f.realm', kind: 'text', advanced: true, hint: 'auth.f.realmHint' },
      { key: 'nonce', label: 'auth.f.nonce', kind: 'text', advanced: true },
      { key: 'algorithm', label: 'auth.f.algorithm', kind: 'select', default: 'MD5', advanced: true, options: opts('MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess', 'SHA-512-256', 'SHA-512-256-sess') },
      { key: 'qop', label: 'auth.f.qop', kind: 'text', advanced: true, placeholder: 'auth' },
      { key: 'nonceCount', label: 'auth.f.nonceCount', kind: 'text', advanced: true, placeholder: '00000001' },
      { key: 'clientNonce', label: 'auth.f.clientNonce', kind: 'text', advanced: true },
      { key: 'opaque', label: 'auth.f.opaque', kind: 'text', advanced: true }
    ]
  },
  {
    type: 'oauth1',
    label: 'auth.type.oauth1',
    fields: [
      { key: 'signatureMethod', label: 'auth.f.signatureMethod', kind: 'select', default: 'HMAC-SHA1', options: opts('HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512', 'PLAINTEXT') },
      { key: 'consumerKey', label: 'auth.f.consumerKey', kind: 'text' },
      { key: 'consumerSecret', label: 'auth.f.consumerSecret', kind: 'secret', when: { key: 'signatureMethod', values: ['HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'PLAINTEXT'] } },
      { key: 'privateKey', label: 'auth.f.privateKeyPem', kind: 'textarea', when: { key: 'signatureMethod', values: ['RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512'] } },
      { key: 'token', label: 'auth.f.accessToken', kind: 'text' },
      { key: 'tokenSecret', label: 'auth.f.tokenSecret', kind: 'secret' },
      { key: 'addParamsToHeader', label: 'auth.f.addParamsToHeader', kind: 'checkbox', default: true },
      { key: 'callback', label: 'auth.f.callbackUrl', kind: 'text', advanced: true },
      { key: 'verifier', label: 'auth.f.verifier', kind: 'text', advanced: true },
      { key: 'timestamp', label: 'auth.f.timestamp', kind: 'text', advanced: true },
      { key: 'nonce', label: 'auth.f.nonce', kind: 'text', advanced: true },
      { key: 'version', label: 'auth.f.version', kind: 'text', default: '1.0', advanced: true },
      { key: 'realm', label: 'auth.f.realm', kind: 'text', advanced: true },
      { key: 'includeBodyHash', label: 'auth.f.includeBodyHash', kind: 'checkbox', default: false, advanced: true },
      { key: 'addEmptyParamsToSign', label: 'auth.f.addEmptyParams', kind: 'checkbox', default: false, advanced: true },
      { key: 'disableHeaderEncoding', label: 'auth.f.disableHeaderEncoding', kind: 'checkbox', default: false, advanced: true }
    ]
  },
  {
    type: 'oauth2',
    label: 'auth.type.oauth2',
    fields: [
      { key: 'accessToken', label: 'auth.f.accessToken', kind: 'secret' },
      { key: 'addTokenTo', label: 'auth.f.addTokenTo', kind: 'select', default: 'header', options: [{ value: 'header', label: 'auth.f.header' }, { value: 'queryParams', label: 'auth.f.queryParams' }] },
      { key: 'headerPrefix', label: 'auth.f.headerPrefix', kind: 'text', default: 'Bearer' },
      { key: 'tokenName', label: 'auth.f.tokenName', kind: 'text', advanced: true },
      {
        key: 'grant_type',
        label: 'auth.f.grantType',
        kind: 'select',
        default: 'authorization_code',
        advanced: true,
        options: [
          { value: 'authorization_code', label: 'auth.grant.authorization_code' },
          { value: 'authorization_code_with_pkce', label: 'auth.grant.authorization_code_with_pkce' },
          { value: 'implicit', label: 'auth.grant.implicit' },
          { value: 'password_credentials', label: 'auth.grant.password_credentials' },
          { value: 'client_credentials', label: 'auth.grant.client_credentials' }
        ]
      },
      { key: 'redirect_uri', label: 'auth.f.callbackUrlOauth2', kind: 'text', advanced: true, placeholder: 'https://localhost/callback', when: { key: 'grant_type', values: ['authorization_code', 'authorization_code_with_pkce', 'implicit'] } },
      { key: 'authUrl', label: 'auth.f.authUrl', kind: 'text', advanced: true, when: { key: 'grant_type', values: ['authorization_code', 'authorization_code_with_pkce', 'implicit'] } },
      { key: 'accessTokenUrl', label: 'auth.f.accessTokenUrl', kind: 'text', advanced: true, when: { key: 'grant_type', values: ['authorization_code', 'authorization_code_with_pkce', 'password_credentials', 'client_credentials'] } },
      { key: 'clientId', label: 'auth.f.clientId', kind: 'text', advanced: true },
      { key: 'clientSecret', label: 'auth.f.clientSecret', kind: 'secret', advanced: true },
      { key: 'username', label: 'auth.f.username', kind: 'text', advanced: true, when: { key: 'grant_type', values: ['password_credentials'] } },
      { key: 'password', label: 'auth.f.password', kind: 'secret', advanced: true, when: { key: 'grant_type', values: ['password_credentials'] } },
      { key: 'challengeAlgorithm', label: 'auth.f.challengeAlgorithm', kind: 'select', default: 'S256', advanced: true, options: opts('S256', 'plain'), when: { key: 'grant_type', values: ['authorization_code_with_pkce'] } },
      { key: 'code_verifier', label: 'auth.f.codeVerifier', kind: 'text', advanced: true, placeholderKey: 'auth.f.codeVerifierPlaceholder', when: { key: 'grant_type', values: ['authorization_code_with_pkce'] } },
      { key: 'scope', label: 'auth.f.scope', kind: 'text', advanced: true },
      { key: 'state', label: 'auth.f.state', kind: 'text', advanced: true },
      {
        key: 'client_authentication',
        label: 'auth.f.clientAuthentication',
        kind: 'select',
        default: 'header',
        advanced: true,
        options: [{ value: 'header', label: 'auth.f.clientAuthHeader' }, { value: 'body', label: 'auth.f.clientAuthBody' }]
      }
    ]
  },
  {
    type: 'hawk',
    label: 'auth.type.hawk',
    fields: [
      { key: 'authId', label: 'auth.f.hawkId', kind: 'text' },
      { key: 'authKey', label: 'auth.f.hawkKey', kind: 'secret' },
      { key: 'algorithm', label: 'auth.f.algorithm', kind: 'select', default: 'sha256', options: opts('sha256', 'sha1') },
      { key: 'user', label: 'auth.f.username', kind: 'text', advanced: true },
      { key: 'nonce', label: 'auth.f.nonce', kind: 'text', advanced: true },
      { key: 'extraData', label: 'auth.f.ext', kind: 'text', advanced: true },
      { key: 'app', label: 'auth.f.app', kind: 'text', advanced: true },
      { key: 'delegation', label: 'auth.f.delegation', kind: 'text', advanced: true },
      { key: 'timestamp', label: 'auth.f.timestamp', kind: 'text', advanced: true },
      { key: 'includePayloadHash', label: 'auth.f.includeBodyHash', kind: 'checkbox', default: false, advanced: true }
    ]
  },
  {
    type: 'awsv4',
    label: 'auth.type.awsv4',
    fields: [
      { key: 'accessKey', label: 'auth.f.accessKey', kind: 'text' },
      { key: 'secretKey', label: 'auth.f.secretKey', kind: 'secret' },
      { key: 'addAuthDataToQuery', label: 'auth.f.addAuthToQuery', kind: 'checkbox', default: false },
      { key: 'region', label: 'auth.f.region', kind: 'text', advanced: true, placeholder: 'us-east-1' },
      { key: 'service', label: 'auth.f.service', kind: 'text', advanced: true, placeholder: 'execute-api' },
      { key: 'sessionToken', label: 'auth.f.sessionToken', kind: 'secret', advanced: true }
    ]
  },
  {
    type: 'ntlm',
    label: 'auth.type.ntlm',
    fields: [
      { key: 'username', label: 'auth.f.username', kind: 'text' },
      { key: 'password', label: 'auth.f.password', kind: 'secret' },
      { key: 'domain', label: 'auth.f.domain', kind: 'text', advanced: true },
      { key: 'workstation', label: 'auth.f.workstation', kind: 'text', advanced: true },
      { key: 'disableRetryRequest', label: 'auth.f.disableRetry', kind: 'checkbox', default: false, advanced: true }
    ]
  },
  {
    type: 'edgegrid',
    label: 'auth.type.edgegrid',
    fields: [
      { key: 'accessToken', label: 'auth.f.accessToken', kind: 'text' },
      { key: 'clientToken', label: 'auth.f.clientToken', kind: 'text' },
      { key: 'clientSecret', label: 'auth.f.clientSecret', kind: 'secret' },
      { key: 'nonce', label: 'auth.f.nonce', kind: 'text', advanced: true },
      { key: 'timestamp', label: 'auth.f.timestamp', kind: 'text', advanced: true },
      { key: 'baseURL', label: 'auth.f.baseUrl', kind: 'text', advanced: true },
      { key: 'headersToSign', label: 'auth.f.headersToSign', kind: 'text', advanced: true }
    ]
  },
  {
    type: 'jwt',
    label: 'auth.type.jwt',
    fields: [
      { key: 'algorithm', label: 'auth.f.algorithm', kind: 'select', default: 'HS256', options: opts(...HMAC_ALGS, ...ASYM_ALGS) },
      { key: 'secret', label: 'auth.f.secret', kind: 'secret', when: { key: 'algorithm', values: HMAC_ALGS } },
      { key: 'isSecretBase64Encoded', label: 'auth.f.secretBase64', kind: 'checkbox', default: false, when: { key: 'algorithm', values: HMAC_ALGS } },
      { key: 'privateKey', label: 'auth.f.privateKeyPkcs8', kind: 'textarea', when: { key: 'algorithm', values: ASYM_ALGS } },
      { key: 'payload', label: 'auth.f.payload', kind: 'json', default: '{}' },
      { key: 'addTokenTo', label: 'auth.f.addTokenTo', kind: 'select', default: 'header', options: [{ value: 'header', label: 'auth.f.header' }, { value: 'queryParam', label: 'auth.f.queryParams' }] },
      { key: 'headerPrefix', label: 'auth.f.headerPrefix', kind: 'text', default: 'Bearer', advanced: true },
      { key: 'queryParamKey', label: 'auth.f.queryParamName', kind: 'text', default: 'token', advanced: true },
      { key: 'header', label: 'auth.f.jwtHeaders', kind: 'json', default: '{}', advanced: true }
    ]
  },
  {
    type: 'asap',
    label: 'auth.type.asap',
    fields: [
      { key: 'alg', label: 'auth.f.algorithm', kind: 'select', default: 'RS256', options: opts(...ASYM_ALGS) },
      { key: 'iss', label: 'auth.f.issuer', kind: 'text' },
      { key: 'aud', label: 'auth.f.audience', kind: 'text' },
      { key: 'kid', label: 'auth.f.keyId', kind: 'text' },
      { key: 'privateKey', label: 'auth.f.privateKey', kind: 'textarea' },
      { key: 'sub', label: 'auth.f.subject', kind: 'text', advanced: true },
      { key: 'exp', label: 'auth.f.expiry', kind: 'text', default: '3600', advanced: true },
      { key: 'claims', label: 'auth.f.claims', kind: 'json', default: '{}', advanced: true }
    ]
  }
]

/** Nom affiché d'un type d'autorisation (terme familier, identique dans toutes les langues). */
export const authLabel = (type: AuthType): string => t(`auth.type.${type}`)

export const isAuthType = (v: unknown): v is AuthType => typeof v === 'string' && AUTH_TYPES.some((x) => x.type === v)

/** Valeur d'un paramètre avec la valeur par défaut du catalogue. */
export function authParam(auth: AuthConfig, key: string): AuthParamValue {
  if (auth.params[key] !== undefined && auth.params[key] !== null && auth.params[key] !== '') return auth.params[key]!
  const field = AUTH_TYPES.find((t) => t.type === auth.type)?.fields.find((f) => f.key === key)
  return field?.default ?? ''
}

export const authString = (auth: AuthConfig, key: string): string => {
  const v = authParam(auth, key)
  if (v === null || v === undefined) return ''
  return typeof v === 'string' ? v : typeof v === 'object' ? JSON.stringify(v) : String(v)
}

export const authBool = (auth: AuthConfig, key: string): boolean => {
  const v = authParam(auth, key)
  return v === true || v === 'true'
}

// --- Format v2.1 ----------------------------------------------------------------------------

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * `{ type, <type>: [{ key, value, type }] }` → configuration interne. Une auth absente signifie
 * « hériter » (retourne `null`). Un type inconnu est conservé tel quel dans `params.__raw`.
 */
export function authFromV21(raw: unknown): AuthConfig | null {
  if (!isObject(raw) || typeof raw['type'] !== 'string') return null
  const type = raw['type']
  if (type === 'inherit') return null
  if (!isAuthType(type)) return { type: 'noauth', params: { __raw: raw as Record<string, unknown> } }
  const params: Record<string, AuthParamValue> = {}
  const list = raw[type]
  if (Array.isArray(list)) {
    for (const e of list) if (isObject(e) && typeof e['key'] === 'string') params[e['key']] = (e['value'] ?? '') as AuthParamValue
  } else if (isObject(list)) {
    for (const [k, v] of Object.entries(list)) params[k] = v as AuthParamValue
  }
  return { type, params }
}

export function authToV21(auth: AuthConfig): Json {
  const raw = auth.params['__raw']
  if (isObject(raw)) return raw
  if (auth.type === 'noauth') return { type: 'noauth' }
  return {
    type: auth.type,
    [auth.type]: Object.entries(auth.params).map(([key, value]) => ({
      key,
      value,
      type: typeof value === 'boolean' ? 'boolean' : typeof value === 'string' ? 'string' : 'any'
    }))
  }
}

// --- Héritage -------------------------------------------------------------------------------

export interface AuthOwner {
  auth: AuthConfig | null
  name: string
  kind: 'folder' | 'collection'
}

export interface EffectiveAuth {
  auth: AuthConfig | null
  /** Élément dont l'auth est héritée ; absent quand la requête définit la sienne. */
  inheritedFrom?: { name: string; kind: 'folder' | 'collection' }
}

/** `chain` va du dossier le plus proche jusqu'à la collection. */
export function effectiveAuth(own: AuthConfig | null, chain: AuthOwner[]): EffectiveAuth {
  if (own) return { auth: own.type === 'noauth' ? null : own }
  for (const owner of chain) {
    if (owner.auth) {
      return { auth: owner.auth.type === 'noauth' ? null : owner.auth, inheritedFrom: { name: owner.name, kind: owner.kind } }
    }
  }
  return { auth: null }
}

export function newAuth(type: AuthType): AuthConfig {
  const params: Record<string, AuthParamValue> = {}
  for (const f of AUTH_TYPES.find((t) => t.type === type)?.fields ?? []) if (f.default !== undefined) params[f.key] = f.default
  return { type, params }
}
