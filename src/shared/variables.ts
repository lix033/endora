// Variables `{{nom}}` : portées, résolution et format d'échange des environnements.
//
// Comportements de référence :
// - observé : chaque variable a une valeur initiale (`value`, partagée/exportée) et une valeur
//   courante (`sessionValue`, locale) ; l'info-bulle affiche les deux et la portée, les secrets
//   sont masqués par « ● » ;
// - observé : un fichier d'environnement a `name` et `values`, un fichier de globales a en plus
//   `_postman_variable_scope: "globals"` ;
// - inféré (documentation publique) : priorité locale > données > environnement > collection > globales.

import { newId } from './model'
import type { VariableMutation } from './scripting/types'

export type VariableType = 'default' | 'secret'

export interface Variable {
  id: string
  key: string
  /** Valeur initiale : exportée et partagée. */
  value: string
  /** Valeur courante : locale, utilisée à l'envoi ; absente = valeur initiale. */
  current?: string
  type: VariableType
  enabled: boolean
  description?: string
}

export type ScopeName = 'local' | 'data' | 'environment' | 'collection' | 'globals'

export interface Scope {
  name: ScopeName
  /** Libellé affiché (nom de l'environnement ou de la collection). */
  label?: string
  values: Variable[]
}

export interface ResolvedVariable {
  key: string
  value: string
  initial: string
  scope: ScopeName
  label?: string
  type: VariableType
}

export const SCOPE_ORDER: ScopeName[] = ['local', 'data', 'environment', 'collection', 'globals']

export const SCOPE_LABELS: Record<ScopeName, string> = {
  local: 'Locale',
  data: 'Données',
  environment: 'Environnement',
  collection: 'Collection',
  globals: 'Globale'
}

export const newVariable = (key = '', value = '', type: VariableType = 'default'): Variable => ({
  id: newId(),
  key,
  value,
  type,
  enabled: true
})

export const effectiveValue = (v: Variable): string => v.current ?? v.value

const VAR_PATTERN = /\{\{([^{}]+?)\}\}/g
const MAX_DEPTH = 10

/** Trie les portées de la plus prioritaire à la moins prioritaire. */
function ordered(scopes: Scope[]): Scope[] {
  return [...scopes].sort((a, b) => SCOPE_ORDER.indexOf(a.name) - SCOPE_ORDER.indexOf(b.name))
}

export function lookupVariable(scopes: Scope[], key: string): ResolvedVariable | null {
  for (const scope of ordered(scopes)) {
    // La dernière définition active d'une clé l'emporte dans une même portée.
    for (let i = scope.values.length - 1; i >= 0; i--) {
      const v = scope.values[i]!
      if (v.enabled && v.key === key) {
        return { key, value: effectiveValue(v), initial: v.value, scope: scope.name, label: scope.label, type: v.type }
      }
    }
  }
  return null
}

// --- Variables dynamiques ($guid, $timestamp…) ----------------------------------------------

const ALPHANUM = 'abcdefghijklmnopqrstuvwxyz0123456789'
const randomInt = (min: number, max: number): number => min + Math.floor(Math.random() * (max - min + 1))
const pick = <T>(list: readonly T[]): T => list[randomInt(0, list.length - 1)]!
const FIRST_NAMES = ['Alice', 'Bruno', 'Chloé', 'David', 'Emma', 'Farid', 'Gabrielle', 'Hugo', 'Inès', 'Jules']
const LAST_NAMES = ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau']
const WORDS = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'tempor']

export const DYNAMIC_VARIABLES: Record<string, { description: string; generate: () => string }> = {
  $guid: { description: 'UUID v4', generate: () => crypto.randomUUID() },
  $randomUUID: { description: 'UUID v4', generate: () => crypto.randomUUID() },
  $timestamp: { description: 'Horodatage Unix (secondes)', generate: () => String(Math.floor(Date.now() / 1000)) },
  $isoTimestamp: { description: 'Horodatage ISO 8601 (UTC)', generate: () => new Date().toISOString() },
  $randomInt: { description: 'Entier entre 0 et 1000', generate: () => String(randomInt(0, 1000)) },
  $randomBoolean: { description: 'true ou false', generate: () => String(Math.random() < 0.5) },
  $randomAlphaNumeric: { description: 'Caractère alphanumérique', generate: () => pick([...ALPHANUM]) },
  $randomHexColor: { description: 'Couleur hexadécimale', generate: () => `#${randomInt(0, 0xffffff).toString(16).padStart(6, '0')}` },
  $randomIP: { description: 'Adresse IPv4', generate: () => [0, 0, 0, 0].map(() => randomInt(1, 254)).join('.') },
  $randomFirstName: { description: 'Prénom', generate: () => pick(FIRST_NAMES) },
  $randomLastName: { description: 'Nom', generate: () => pick(LAST_NAMES) },
  $randomFullName: { description: 'Nom complet', generate: () => `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}` },
  $randomEmail: {
    description: 'Adresse e-mail',
    generate: () => `${pick(FIRST_NAMES).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')}.${pick(LAST_NAMES).toLowerCase()}@example.com`
  },
  $randomWord: { description: 'Mot', generate: () => pick(WORDS) },
  $randomLoremSentence: {
    description: 'Phrase',
    generate: () => {
      const s = Array.from({ length: randomInt(5, 10) }, () => pick(WORDS)).join(' ')
      return `${s[0]!.toUpperCase()}${s.slice(1)}.`
    }
  }
}

/**
 * Remplace les `{{variables}}` d'un texte. Les variables peuvent en référencer d'autres (résolution
 * imbriquée bornée) ; une variable inconnue reste telle quelle dans le texte.
 */
export function resolveString(text: string, scopes: Scope[]): string {
  if (!text.includes('{{')) return text
  let current = text
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    let changed = false
    current = current.replace(VAR_PATTERN, (match, rawName: string) => {
      const name = rawName.trim()
      const found = lookupVariable(scopes, name)
      if (found) {
        changed = true
        return found.value
      }
      const dynamic = DYNAMIC_VARIABLES[name]
      if (dynamic) {
        changed = true
        return dynamic.generate()
      }
      return match
    })
    if (!changed || !current.includes('{{')) break
  }
  return current
}

/** Résout récursivement toutes les chaînes d'une valeur JSON (paramètres d'auth…). */
export function resolveDeep<T>(value: T, scopes: Scope[]): T {
  if (typeof value === 'string') return resolveString(value, scopes) as T
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, scopes)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = resolveDeep(v, scopes)
    return out as T
  }
  return value
}

export interface VariableToken {
  name: string
  start: number
  end: number
}

/** Repère les `{{variables}}` d'un texte (coloration, info-bulles). */
export function findVariableTokens(text: string): VariableToken[] {
  const tokens: VariableToken[] = []
  for (const m of text.matchAll(VAR_PATTERN)) {
    tokens.push({ name: m[1]!.trim(), start: m.index!, end: m.index! + m[0].length })
  }
  return tokens
}

/** Toutes les variables visibles, la plus prioritaire pour chaque clé (autocomplétion, aperçu rapide). */
export function visibleVariables(scopes: Scope[]): ResolvedVariable[] {
  const seen = new Map<string, ResolvedVariable>()
  for (const scope of ordered(scopes)) {
    for (const v of scope.values) {
      if (!v.enabled || v.key === '' || seen.has(v.key)) continue
      const found = lookupVariable([scope], v.key)
      if (found) seen.set(v.key, found)
    }
  }
  return [...seen.values()]
}

// --- Format d'échange -----------------------------------------------------------------------

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Convertit les variables d'un fichier (environnement, globales, collection) en variables internes. */
export function importVariables(list: unknown, opts: { keepCurrent?: boolean } = {}): Variable[] {
  if (!Array.isArray(list)) return []
  const out: Variable[] = []
  for (const e of list) {
    if (!isObject(e) || (typeof e['key'] !== 'string' && typeof e['key'] !== 'number')) continue
    const raw = e['value']
    const v: Variable = {
      id: typeof e['id'] === 'string' && opts.keepCurrent ? e['id'] : newId(),
      key: String(e['key']),
      value: raw == null ? '' : typeof raw === 'string' ? raw : JSON.stringify(raw),
      type: e['type'] === 'secret' ? 'secret' : 'default',
      enabled: e['enabled'] !== false && e['disabled'] !== true
    }
    if (opts.keepCurrent && typeof e['current'] === 'string') v.current = e['current']
    if (typeof e['description'] === 'string' && e['description'] !== '') v.description = e['description']
    out.push(v)
  }
  return out
}

export type EnvironmentFile =
  | { kind: 'environment'; name: string; values: Variable[] }
  | { kind: 'globals'; values: Variable[] }

/** Détecte un fichier d'environnement ou de globales (format observé : `name` + `values`). */
export function parseEnvironmentFile(input: unknown): EnvironmentFile | null {
  if (!isObject(input) || !Array.isArray(input['values'])) return null
  if (input['_postman_variable_scope'] === 'globals') return { kind: 'globals', values: importVariables(input['values']) }
  if (typeof input['name'] !== 'string') return null
  return { kind: 'environment', name: input['name'].trim() || 'Environnement', values: importVariables(input['values']) }
}

/**
 * Valeurs exportées : la valeur initiale seulement, comme dans le format d'échange de référence.
 * Format `environment` : `type` et `enabled` explicites ; format `collection` : `disabled` et `type`
 * seulement pour les secrets.
 */
export function exportVariables(
  values: Variable[],
  opts: { includeCurrent?: boolean; withIds?: boolean; format?: 'environment' | 'collection' } = {}
): Json[] {
  const collection = opts.format === 'collection'
  return values
    .filter((v) => v.key !== '' || v.value !== '')
    .map((v) => ({
      ...(opts.withIds ? { id: v.id } : {}),
      key: v.key,
      value: v.value,
      ...(collection ? (v.type === 'secret' ? { type: 'secret' } : {}) : { type: v.type }),
      ...(collection ? (v.enabled ? {} : { disabled: true }) : { enabled: v.enabled }),
      ...(v.description ? { description: v.description } : {}),
      ...(opts.includeCurrent && v.current !== undefined ? { current: v.current } : {})
    }))
}

export function exportEnvironmentFile(name: string, values: Variable[], scope: 'environment' | 'globals', id: string): Json {
  return {
    id,
    name,
    values: exportVariables(values),
    _postman_variable_scope: scope,
    _postman_exported_at: new Date().toISOString()
  }
}

/**
 * Applique des modifications de script à une liste de variables. Une variable existante reçoit une
 * nouvelle valeur courante (comportement de référence : `set` modifie la valeur courante) ; une
 * variable créée par un script reçoit la même valeur initiale et courante (inféré).
 */
export function mutateVariables(values: Variable[], mutations: VariableMutation[]): Variable[] {
  let next = values.map((v) => ({ ...v }))
  for (const m of mutations) {
    if (m.op === 'clear') next = []
    else if (m.op === 'unset') next = next.filter((v) => v.key !== m.key)
    else {
      const existing = [...next].reverse().find((v) => v.key === m.key)
      if (existing) {
        existing.current = m.value
        existing.enabled = true
      } else next.push({ ...newVariable(m.key, m.value), current: m.value })
    }
  }
  return next
}

