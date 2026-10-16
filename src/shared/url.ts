// Synchronisation entre la query string de l'URL et le tableau des params.
// Le texte est conservé tel quel (pas de décodage), pour ne pas altérer les {{variables}}.

import type { KeyValue } from './http'
import { newId } from './model'

interface UrlParts {
  base: string
  query: string | null
  hash: string | null
}

export function splitUrl(url: string): UrlParts {
  let rest = url
  let hash: string | null = null
  const h = rest.indexOf('#')
  if (h !== -1) {
    hash = rest.slice(h + 1)
    rest = rest.slice(0, h)
  }
  const q = rest.indexOf('?')
  if (q === -1) return { base: rest, query: null, hash }
  return { base: rest.slice(0, q), query: rest.slice(q + 1), hash }
}

export function parseQuery(query: string | null): Array<{ key: string; value: string }> {
  if (query === null || query === '') return []
  return query.split('&').map((pair) => {
    const eq = pair.indexOf('=')
    return eq === -1 ? { key: pair, value: '' } : { key: pair.slice(0, eq), value: pair.slice(eq + 1) }
  })
}

const formatPair = (key: string, value: string): string => (value === '' ? key : `${key}=${value}`)

/** Reconstruit l'URL à partir des params activés (les params désactivés restent hors de l'URL). */
export function urlWithParams(url: string, params: KeyValue[]): string {
  const { base, hash } = splitUrl(url)
  const active = params.filter((p) => p.enabled && (p.key !== '' || p.value !== ''))
  const query = active.map((p) => formatPair(p.key, p.value)).join('&')
  return `${base}${active.length > 0 ? `?${query}` : ''}${hash !== null ? `#${hash}` : ''}`
}

/**
 * Params après une modification de l'URL : les paires de l'URL deviennent les params activés
 * (identifiants réutilisés par position pour garder l'édition stable), les params désactivés
 * existants sont conservés à la suite.
 */
export function paramsFromUrl(url: string, previous: KeyValue[]): KeyValue[] {
  const pairs = parseQuery(splitUrl(url).query)
  const enabledPrev = previous.filter((p) => p.enabled && (p.key !== '' || p.value !== ''))
  const next: KeyValue[] = pairs.map((pair, i) => ({ id: enabledPrev[i]?.id ?? newId(), key: pair.key, value: pair.value, enabled: true }))
  for (const p of previous) if (!p.enabled) next.push(p)
  return next
}
