// Mock servers locaux. Comportement de référence observé (moteur de mock local du client de
// référence) : un serveur HTTP par mock, réponses tirées des exemples enregistrés sur les requêtes,
// correspondance méthode + chemin (+ paramètres), état par session choisi par l'en-tête
// `x-mock-session` quand les sessions sont activées (sinon un état partagé), script de mock.
// Choix Endora : mock privé = écoute locale + clé `x-mock-key` ; mock public = réseau local, sans clé.

import type { Collection, TreeItem } from './model'

export const MOCK_HEADERS = {
  key: 'x-mock-key',
  session: 'x-mock-session',
  responseName: 'x-mock-response-name',
  responseCode: 'x-mock-response-code'
} as const

/** État commun à tous les clients quand les sessions sont désactivées ou non précisées. */
export const SHARED_SESSION = 'shared'

/** Premier port essayé pour un nouveau mock. */
export const MOCK_BASE_PORT = 4010

export interface MockConfig {
  id: string
  name: string
  collectionId: string
  /** Port attribué à la création puis conservé : l'URL du mock reste stable. */
  port: number
  /** Public : écoute sur le réseau local, sans clé. Privé : cette machine seulement, clé requise. */
  publicAccess: boolean
  apiKey: string
  /** Les modifications de la collection sont servies dès leur enregistrement. */
  autoDeploy: boolean
  /** État `pm.state` propre à chaque valeur de l'en-tête `x-mock-session`. */
  enableSession: boolean
  /** Script exécuté à chaque requête (injection de script). */
  script: string
  /** Le mock doit tourner (redémarré au lancement de l'app). */
  enabled: boolean
  createdAt: string
  deployedAt: string | null
  /** Collection v2.1 figée au dernier déploiement, servie quand le déploiement automatique est désactivé. */
  snapshot: unknown
}

export type MockInfo = Omit<MockConfig, 'snapshot'>

export interface MockState {
  config: MockInfo
  running: boolean
  url: string
  /** Adresse sur le réseau local (mock public). */
  networkUrl?: string
  /** Nom de la collection servie (absente si supprimée). */
  collectionName?: string
  routes: number
  examples: number
  error?: string
}

export interface NewMockInput {
  name: string
  collectionId: string
  publicAccess: boolean
  autoDeploy: boolean
  enableSession: boolean
}

export type MockPatch = Partial<Pick<MockConfig, 'name' | 'publicAccess' | 'autoDeploy' | 'enableSession' | 'script'>>

export type MockActionResult = { ok: true; mock: MockState } | { ok: false; message: string }

export interface MockLogEntry {
  id: string
  mockId: string
  time: string
  method: string
  path: string
  status: number
  durationMs: number
  session: string
  /** Requête de la collection qui a répondu. */
  route?: string
  example?: string
  error?: string
  /** Messages `console.*` du script du mock. */
  logs?: Array<{ level: string; message: string }>
}

export type MockEvent = { type: 'changed' } | { type: 'log'; entry: MockLogEntry }

// --- Routes ----------------------------------------------------------------------------------

export interface MockExample {
  name: string
  code: number
  headers: Array<{ key: string; value: string }>
  body: string
  /** Paramètres de requête de la requête d'origine : départagent les exemples d'une même route. */
  query: Array<{ key: string; value: string }>
}

type Segment = { kind: 'literal'; value: string } | { kind: 'param'; name: string } | { kind: 'wildcard' }

export interface MockRoute {
  itemId: string
  name: string
  method: string
  pattern: string
  segments: Segment[]
  examples: MockExample[]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/**
 * Chemin d'une URL de requête : sans schéma ni hôte (`https://api.test`, `{{baseUrl}}`, `localhost:3000`),
 * sans query ni fragment.
 */
export function mockPath(url: string): string {
  let rest = url.trim().split('#')[0]!.split('?')[0]!
  rest = rest.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
  if (!rest.startsWith('/')) {
    const slash = rest.indexOf('/')
    rest = slash === -1 ? '/' : rest.slice(slash)
  }
  const segments = rest.split('/').filter(Boolean)
  return `/${segments.join('/')}`
}

function parseSegments(path: string): Segment[] {
  return path
    .split('/')
    .filter(Boolean)
    .map((s): Segment => {
      if (s.startsWith(':') && s.length > 1) return { kind: 'param', name: s.slice(1) }
      if (s.includes('{{')) return { kind: 'wildcard' }
      return { kind: 'literal', value: safeDecode(s) }
    })
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

function pairs(list: unknown): Array<{ key: string; value: string }> {
  if (!Array.isArray(list)) return []
  return list.filter(isObject).filter((h) => h['disabled'] !== true).map((h) => ({ key: str(h['key']), value: str(h['value']) }))
}

/** Exemples enregistrés sur une requête (`response` au format v2.1, conservé dans `extra`). */
export function examplesOf(item: TreeItem): MockExample[] {
  const list = item.extra?.['response']
  if (!Array.isArray(list)) return []
  return list.filter(isObject).map((r, i) => {
    const original = isObject(r['originalRequest']) ? r['originalRequest'] : {}
    const url = original['url']
    const query = isObject(url) && Array.isArray(url['query']) ? pairs(url['query']) : queryFromRaw(str(isObject(url) ? url['raw'] : url))
    const code = Number(r['code'])
    return {
      name: str(r['name']) || `Exemple ${i + 1}`,
      code: Number.isInteger(code) && code >= 100 && code <= 599 ? code : 200,
      headers: pairs(r['header']),
      body: str(r['body']),
      query
    }
  })
}

function queryFromRaw(raw: string): Array<{ key: string; value: string }> {
  const q = raw.split('#')[0]!.split('?')[1]
  if (!q) return []
  return q
    .split('&')
    .filter(Boolean)
    .map((p) => {
      const [k = '', ...v] = p.split('=')
      return { key: safeDecode(k), value: safeDecode(v.join('=')) }
    })
}

/** Routes d'une collection : une par requête, dans l'ordre de l'arbre. */
export function buildRoutes(collection: Collection): MockRoute[] {
  const routes: MockRoute[] = []
  const walk = (items: TreeItem[]) => {
    for (const item of items) {
      if (item.type === 'folder') {
        walk(item.items)
        continue
      }
      const pattern = mockPath(item.request.url)
      routes.push({
        itemId: item.id,
        name: item.name,
        method: (item.request.method || 'GET').toUpperCase(),
        pattern,
        segments: parseSegments(pattern),
        examples: examplesOf(item)
      })
    }
  }
  walk(collection.items)
  return routes
}

export interface RouteMatch {
  route: MockRoute
  params: Record<string, string>
}

/** Route la plus précise (le plus de segments littéraux) pour une méthode et un chemin. */
export function matchRoute(routes: MockRoute[], method: string, path: string): RouteMatch | null {
  const parts = path.split('/').filter(Boolean).map(safeDecode)
  let best: RouteMatch | null = null
  let bestScore = -1
  for (const route of routes) {
    if (route.method !== method.toUpperCase() || route.segments.length !== parts.length) continue
    const params: Record<string, string> = {}
    let score = 0
    let ok = true
    for (let i = 0; i < parts.length; i++) {
      const seg = route.segments[i]!
      const part = parts[i]!
      if (seg.kind === 'literal') {
        if (seg.value !== part) {
          ok = false
          break
        }
        score++
      } else if (seg.kind === 'param') params[seg.name] = part
    }
    if (ok && score > bestScore) {
      best = { route, params }
      bestScore = score
    }
  }
  return best
}

/**
 * Exemple renvoyé : celui nommé par `x-mock-response-name`, sinon parmi ceux du code
 * `x-mock-response-code`, celui dont les paramètres de requête correspondent le mieux.
 */
export function pickExample(route: MockRoute, headers: Record<string, string | undefined>, query: URLSearchParams): MockExample | null {
  let candidates = route.examples
  const wantedName = headers[MOCK_HEADERS.responseName]?.trim().toLowerCase()
  if (wantedName) {
    const named = candidates.find((e) => e.name.toLowerCase() === wantedName)
    if (named) return named
  }
  const wantedCode = Number(headers[MOCK_HEADERS.responseCode])
  if (Number.isInteger(wantedCode)) {
    const byCode = candidates.filter((e) => e.code === wantedCode)
    if (byCode.length > 0) candidates = byCode
  }
  let best: MockExample | null = null
  let bestScore = -1
  for (const e of candidates) {
    const score = e.query.filter((q) => query.get(q.key) === q.value).length
    if (score > bestScore) {
      best = e
      bestScore = score
    }
  }
  return best
}

/** Nom de session lu dans l'en-tête ; une valeur invalide revient à l'état partagé. */
export function sessionFromHeader(value: string | string[] | undefined, enabled: boolean): string {
  if (!enabled) return SHARED_SESSION
  const v = (Array.isArray(value) ? value[0] : value)?.trim()
  return v && /^[A-Za-z0-9_-]{1,128}$/.test(v) && v !== SHARED_SESSION ? v : SHARED_SESSION
}

// --- Stockage --------------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** Configuration relue du disque : champs attendus seulement, valeurs par défaut sinon. */
export function normalizeMockConfig(input: unknown): MockConfig | null {
  if (!isObject(input) || typeof input['id'] !== 'string' || !ID_PATTERN.test(input['id'])) return null
  if (typeof input['collectionId'] !== 'string' || !ID_PATTERN.test(input['collectionId'])) return null
  const port = Number(input['port'])
  return {
    id: input['id'],
    name: str(input['name']).trim() || 'Mock',
    collectionId: input['collectionId'],
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : MOCK_BASE_PORT,
    publicAccess: input['publicAccess'] === true,
    apiKey: str(input['apiKey']),
    autoDeploy: input['autoDeploy'] !== false,
    enableSession: input['enableSession'] !== false,
    script: str(input['script']),
    enabled: input['enabled'] !== false,
    createdAt: str(input['createdAt']) || new Date().toISOString(),
    deployedAt: typeof input['deployedAt'] === 'string' ? input['deployedAt'] : null,
    snapshot: input['snapshot'] ?? null
  }
}

/** Modification reçue du renderer : champs modifiables seulement, avec le bon type. */
export function sanitizeMockPatch(input: unknown): MockPatch {
  if (!isObject(input)) return {}
  const patch: MockPatch = {}
  if (typeof input['name'] === 'string') patch.name = input['name'].slice(0, 200)
  if (typeof input['script'] === 'string') patch.script = input['script'].slice(0, 200_000)
  for (const key of ['publicAccess', 'autoDeploy', 'enableSession'] as const) if (typeof input[key] === 'boolean') patch[key] = input[key]
  return patch
}

export const mockInfo = ({ snapshot: _snapshot, ...info }: MockConfig): MockInfo => info
