// Autorisation : types, champs (noms de paramètres observés dans le moteur de référence pour
// rester compatible avec le format v2.1), conversion v2.1 et héritage dossier → collection.

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
  label: string
  kind: 'text' | 'secret' | 'select' | 'checkbox' | 'textarea' | 'json'
  options?: Array<{ value: string; label: string }>
  default?: string | boolean
  placeholder?: string
  /** Affiché dans la section « Avancé ». */
  advanced?: boolean
  /** N'affiche le champ que si un autre paramètre a l'une des valeurs indiquées. */
  when?: { key: string; values: string[] }
  hint?: string
}

const opts = (...values: string[]) => values.map((v) => ({ value: v, label: v }))
const HMAC_ALGS = ['HS256', 'HS384', 'HS512']
const ASYM_ALGS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512']

export const AUTH_TYPES: Array<{ type: AuthType; label: string; fields: AuthField[] }> = [
  { type: 'noauth', label: 'Aucune', fields: [] },
  {
    type: 'apikey',
    label: 'Clé d’API',
    fields: [
      { key: 'key', label: 'Clé', kind: 'text', placeholder: 'X-API-Key' },
      { key: 'value', label: 'Valeur', kind: 'secret' },
      { key: 'in', label: 'Ajouter dans', kind: 'select', default: 'header', options: [{ value: 'header', label: 'En-tête' }, { value: 'query', label: 'Paramètres de requête' }] }
    ]
  },
  { type: 'bearer', label: 'Jeton Bearer', fields: [{ key: 'token', label: 'Jeton', kind: 'secret' }] },
  {
    type: 'basic',
    label: 'Basique',
    fields: [
      { key: 'username', label: 'Utilisateur', kind: 'text' },
      { key: 'password', label: 'Mot de passe', kind: 'secret' }
    ]
  },
  {
    type: 'digest',
    label: 'Digest',
    fields: [
      { key: 'username', label: 'Utilisateur', kind: 'text' },
      { key: 'password', label: 'Mot de passe', kind: 'secret' },
      { key: 'disableRetryRequest', label: 'Ne pas renvoyer la requête après le défi 401', kind: 'checkbox', default: false, advanced: true },
      { key: 'realm', label: 'Realm', kind: 'text', advanced: true, hint: 'Rempli automatiquement depuis le défi du serveur.' },
      { key: 'nonce', label: 'Nonce', kind: 'text', advanced: true },
      { key: 'algorithm', label: 'Algorithme', kind: 'select', default: 'MD5', advanced: true, options: opts('MD5', 'MD5-sess', 'SHA-256', 'SHA-256-sess', 'SHA-512-256', 'SHA-512-256-sess') },
      { key: 'qop', label: 'qop', kind: 'text', advanced: true, placeholder: 'auth' },
      { key: 'nonceCount', label: 'Compteur de nonce', kind: 'text', advanced: true, placeholder: '00000001' },
      { key: 'clientNonce', label: 'Nonce client', kind: 'text', advanced: true },
      { key: 'opaque', label: 'Opaque', kind: 'text', advanced: true }
    ]
  },
  {
    type: 'oauth1',
    label: 'OAuth 1.0',
    fields: [
      { key: 'signatureMethod', label: 'Méthode de signature', kind: 'select', default: 'HMAC-SHA1', options: opts('HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512', 'PLAINTEXT') },
      { key: 'consumerKey', label: 'Clé consommateur', kind: 'text' },
      { key: 'consumerSecret', label: 'Secret consommateur', kind: 'secret', when: { key: 'signatureMethod', values: ['HMAC-SHA1', 'HMAC-SHA256', 'HMAC-SHA512', 'PLAINTEXT'] } },
      { key: 'privateKey', label: 'Clé privée (PEM)', kind: 'textarea', when: { key: 'signatureMethod', values: ['RSA-SHA1', 'RSA-SHA256', 'RSA-SHA512'] } },
      { key: 'token', label: 'Jeton d’accès', kind: 'text' },
      { key: 'tokenSecret', label: 'Secret du jeton', kind: 'secret' },
      { key: 'addParamsToHeader', label: 'Ajouter les paramètres dans l’en-tête Authorization', kind: 'checkbox', default: true },
      { key: 'callback', label: 'URL de callback', kind: 'text', advanced: true },
      { key: 'verifier', label: 'Vérificateur', kind: 'text', advanced: true },
      { key: 'timestamp', label: 'Horodatage', kind: 'text', advanced: true },
      { key: 'nonce', label: 'Nonce', kind: 'text', advanced: true },
      { key: 'version', label: 'Version', kind: 'text', default: '1.0', advanced: true },
      { key: 'realm', label: 'Realm', kind: 'text', advanced: true },
      { key: 'includeBodyHash', label: 'Inclure le hash du body', kind: 'checkbox', default: false, advanced: true },
      { key: 'addEmptyParamsToSign', label: 'Signer aussi les paramètres vides', kind: 'checkbox', default: false, advanced: true },
      { key: 'disableHeaderEncoding', label: 'Ne pas encoder les paramètres de l’en-tête', kind: 'checkbox', default: false, advanced: true }
    ]
  },
  {
    type: 'oauth2',
    label: 'OAuth 2.0',
    fields: [
      { key: 'accessToken', label: 'Jeton d’accès', kind: 'secret' },
      { key: 'addTokenTo', label: 'Ajouter le jeton dans', kind: 'select', default: 'header', options: [{ value: 'header', label: 'En-tête' }, { value: 'queryParams', label: 'Paramètres de requête' }] },
      { key: 'headerPrefix', label: 'Préfixe de l’en-tête', kind: 'text', default: 'Bearer' },
      { key: 'tokenName', label: 'Nom du jeton', kind: 'text', advanced: true },
      {
        key: 'grant_type',
        label: 'Type d’octroi',
        kind: 'select',
        default: 'authorization_code',
        advanced: true,
        options: [
          { value: 'authorization_code', label: 'Code d’autorisation' },
          { value: 'authorization_code_with_pkce', label: 'Code d’autorisation (PKCE)' },
          { value: 'implicit', label: 'Implicite' },
          { value: 'password_credentials', label: 'Identifiants (mot de passe)' },
          { value: 'client_credentials', label: 'Identifiants client' }
        ]
      },
      { key: 'redirect_uri', label: 'URL de redirection', kind: 'text', advanced: true, placeholder: 'https://localhost/callback', when: { key: 'grant_type', values: ['authorization_code', 'authorization_code_with_pkce', 'implicit'] } },
      { key: 'authUrl', label: 'URL d’autorisation', kind: 'text', advanced: true, when: { key: 'grant_type', values: ['authorization_code', 'authorization_code_with_pkce', 'implicit'] } },
      { key: 'accessTokenUrl', label: 'URL du jeton', kind: 'text', advanced: true, when: { key: 'grant_type', values: ['authorization_code', 'authorization_code_with_pkce', 'password_credentials', 'client_credentials'] } },
      { key: 'clientId', label: 'ID client', kind: 'text', advanced: true },
      { key: 'clientSecret', label: 'Secret client', kind: 'secret', advanced: true },
      { key: 'username', label: 'Utilisateur', kind: 'text', advanced: true, when: { key: 'grant_type', values: ['password_credentials'] } },
      { key: 'password', label: 'Mot de passe', kind: 'secret', advanced: true, when: { key: 'grant_type', values: ['password_credentials'] } },
      { key: 'challengeAlgorithm', label: 'Méthode du code challenge', kind: 'select', default: 'S256', advanced: true, options: opts('S256', 'plain'), when: { key: 'grant_type', values: ['authorization_code_with_pkce'] } },
      { key: 'code_verifier', label: 'Code verifier', kind: 'text', advanced: true, placeholder: 'généré automatiquement', when: { key: 'grant_type', values: ['authorization_code_with_pkce'] } },
      { key: 'scope', label: 'Portée (scope)', kind: 'text', advanced: true },
      { key: 'state', label: 'État (state)', kind: 'text', advanced: true },
      {
        key: 'client_authentication',
        label: 'Authentification du client',
        kind: 'select',
        default: 'header',
        advanced: true,
        options: [{ value: 'header', label: 'En-tête Basic' }, { value: 'body', label: 'Dans le body' }]
      }
    ]
  },
  {
    type: 'hawk',
    label: 'Hawk',
    fields: [
      { key: 'authId', label: 'ID Hawk', kind: 'text' },
      { key: 'authKey', label: 'Clé Hawk', kind: 'secret' },
      { key: 'algorithm', label: 'Algorithme', kind: 'select', default: 'sha256', options: opts('sha256', 'sha1') },
      { key: 'user', label: 'Utilisateur', kind: 'text', advanced: true },
      { key: 'nonce', label: 'Nonce', kind: 'text', advanced: true },
      { key: 'extraData', label: 'ext', kind: 'text', advanced: true },
      { key: 'app', label: 'ID d’application', kind: 'text', advanced: true },
      { key: 'delegation', label: 'Délégation', kind: 'text', advanced: true },
      { key: 'timestamp', label: 'Horodatage', kind: 'text', advanced: true },
      { key: 'includePayloadHash', label: 'Inclure le hash du body', kind: 'checkbox', default: false, advanced: true }
    ]
  },
  {
    type: 'awsv4',
    label: 'Signature AWS',
    fields: [
      { key: 'accessKey', label: 'Clé d’accès', kind: 'text' },
      { key: 'secretKey', label: 'Clé secrète', kind: 'secret' },
      { key: 'addAuthDataToQuery', label: 'Ajouter la signature dans l’URL', kind: 'checkbox', default: false },
      { key: 'region', label: 'Région', kind: 'text', advanced: true, placeholder: 'us-east-1' },
      { key: 'service', label: 'Service', kind: 'text', advanced: true, placeholder: 'execute-api' },
      { key: 'sessionToken', label: 'Jeton de session', kind: 'secret', advanced: true }
    ]
  },
  {
    type: 'ntlm',
    label: 'NTLM',
    fields: [
      { key: 'username', label: 'Utilisateur', kind: 'text' },
      { key: 'password', label: 'Mot de passe', kind: 'secret' },
      { key: 'domain', label: 'Domaine', kind: 'text', advanced: true },
      { key: 'workstation', label: 'Poste de travail', kind: 'text', advanced: true },
      { key: 'disableRetryRequest', label: 'Ne pas renvoyer la requête après le défi 401', kind: 'checkbox', default: false, advanced: true }
    ]
  },
  {
    type: 'edgegrid',
    label: 'Akamai EdgeGrid',
    fields: [
      { key: 'accessToken', label: 'Jeton d’accès', kind: 'text' },
      { key: 'clientToken', label: 'Jeton client', kind: 'text' },
      { key: 'clientSecret', label: 'Secret client', kind: 'secret' },
      { key: 'nonce', label: 'Nonce', kind: 'text', advanced: true },
      { key: 'timestamp', label: 'Horodatage', kind: 'text', advanced: true },
      { key: 'baseURL', label: 'URL de base', kind: 'text', advanced: true },
      { key: 'headersToSign', label: 'En-têtes à signer (séparés par des virgules)', kind: 'text', advanced: true }
    ]
  },
  {
    type: 'jwt',
    label: 'Jeton JWT',
    fields: [
      { key: 'algorithm', label: 'Algorithme', kind: 'select', default: 'HS256', options: opts(...HMAC_ALGS, ...ASYM_ALGS) },
      { key: 'secret', label: 'Secret', kind: 'secret', when: { key: 'algorithm', values: HMAC_ALGS } },
      { key: 'isSecretBase64Encoded', label: 'Secret encodé en Base64', kind: 'checkbox', default: false, when: { key: 'algorithm', values: HMAC_ALGS } },
      { key: 'privateKey', label: 'Clé privée (PKCS#8 PEM)', kind: 'textarea', when: { key: 'algorithm', values: ASYM_ALGS } },
      { key: 'payload', label: 'Charge utile (JSON)', kind: 'json', default: '{}' },
      { key: 'addTokenTo', label: 'Ajouter le jeton dans', kind: 'select', default: 'header', options: [{ value: 'header', label: 'En-tête' }, { value: 'queryParam', label: 'Paramètres de requête' }] },
      { key: 'headerPrefix', label: 'Préfixe de l’en-tête', kind: 'text', default: 'Bearer', advanced: true },
      { key: 'queryParamKey', label: 'Nom du paramètre', kind: 'text', default: 'token', advanced: true },
      { key: 'header', label: 'En-têtes JWT (JSON)', kind: 'json', default: '{}', advanced: true }
    ]
  },
  {
    type: 'asap',
    label: 'ASAP (Atlassian)',
    fields: [
      { key: 'alg', label: 'Algorithme', kind: 'select', default: 'RS256', options: opts(...ASYM_ALGS) },
      { key: 'iss', label: 'Émetteur (iss)', kind: 'text' },
      { key: 'aud', label: 'Audience (aud)', kind: 'text' },
      { key: 'kid', label: 'ID de clé (kid)', kind: 'text' },
      { key: 'privateKey', label: 'Clé privée', kind: 'textarea' },
      { key: 'sub', label: 'Sujet (sub)', kind: 'text', advanced: true },
      { key: 'exp', label: 'Expiration (secondes)', kind: 'text', default: '3600', advanced: true },
      { key: 'claims', label: 'Revendications supplémentaires (JSON)', kind: 'json', default: '{}', advanced: true }
    ]
  }
]

export const AUTH_LABELS: Record<AuthType, string> = Object.fromEntries(AUTH_TYPES.map((t) => [t.type, t.label])) as Record<AuthType, string>

export const isAuthType = (t: unknown): t is AuthType => typeof t === 'string' && t in AUTH_LABELS

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
