// Contrat partagé entre le renderer et le process principal pour l'envoi de requêtes.

/** Méthodes proposées dans l'UI ; toute autre méthode (importée ou saisie) reste acceptée. */
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const
export type HttpMethod = string

export interface KeyValue {
  id: string
  key: string
  value: string
  enabled: boolean
  /** Champ form-data : `file` signifie que `value` est un chemin local lu par le process principal. */
  kind?: 'text' | 'file'
  description?: string
}

export type RequestBody =
  | { mode: 'none' }
  | { mode: 'raw'; language: 'json' | 'xml' | 'html' | 'text' | 'javascript'; text: string }
  | { mode: 'urlencoded'; fields: KeyValue[] }
  | { mode: 'formdata'; fields: KeyValue[] }

export interface HttpRequestSpec {
  method: HttpMethod
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  body: RequestBody
  timeoutMs?: number
}

export interface HttpResponseResult {
  ok: true
  status: number
  statusText: string
  headers: Array<[string, string]>
  bodyBase64: string
  contentType: string | null
  sizeBytes: number
  timeMs: number
  finalUrl: string
  /** Requête réellement envoyée (après auth et redirections), pour la console. */
  sent?: { method: string; url: string; headers: Array<[string, string]> }
}

export interface HttpErrorResult {
  ok: false
  code: 'invalid_url' | 'timeout' | 'aborted' | 'network' | 'file' | 'too_large' | 'auth' | 'script'
  message: string
  timeMs: number
}

export type HttpResult = HttpResponseResult | HttpErrorResult

const RAW_CONTENT_TYPES: Record<Extract<RequestBody, { mode: 'raw' }>['language'], string> = {
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  text: 'text/plain',
  javascript: 'application/javascript'
}

export function rawContentType(language: keyof typeof RAW_CONTENT_TYPES): string {
  return RAW_CONTENT_TYPES[language]
}

/** Construit l'URL finale en ajoutant les query params activés à ceux déjà présents dans l'URL. */
export function buildUrl(url: string, params: KeyValue[]): URL {
  const trimmed = url.trim()
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
  const parsed = new URL(withScheme)
  for (const p of params) {
    if (p.enabled && p.key !== '') parsed.searchParams.append(p.key, p.value)
  }
  return parsed
}
