// Modèle de l'espace de travail local : brouillons de requêtes, collections, historique, onglets.
// Indépendant d'Electron et de React pour être testable et partagé.

import type { HttpMethod, HttpRequestSpec, KeyValue, RequestBody } from './http'
import type { AuthConfig } from './auth'
import type { Variable } from './variables'

export type BodyMode = RequestBody['mode']
export type RawLanguage = Extract<RequestBody, { mode: 'raw' }>['language']

/** Champs v2.1 que l'on ne sait pas encore éditer, conservés tels quels pour un aller-retour sans perte. */
export type Extra = Record<string, unknown>

/**
 * Requête telle qu'éditée. Chaque mode de body garde son contenu, comme dans le client de
 * référence : changer de mode ne perd pas la saisie des autres modes.
 */
export interface RequestDraft {
  method: HttpMethod
  url: string
  params: KeyValue[]
  headers: KeyValue[]
  body: {
    mode: BodyMode
    language: RawLanguage
    raw: string
    urlencoded: KeyValue[]
    formdata: KeyValue[]
  }
  /** `null` : hérite de l'auth du dossier ou de la collection parente (défaut de référence). */
  auth: AuthConfig | null
  scripts: Scripts
  /** Version HTTP propre à la requête ; absente = réglage global. */
  protocolVersion?: ProtocolVersion
  extra?: Extra
}

export type ProtocolVersion = 'auto' | 'http1' | 'http2'

/** Scripts exécutés avant l'envoi et après la réponse (événements `prerequest` et `test` en v2.1). */
export interface Scripts {
  prerequest: string
  test: string
}

export const emptyScripts = (): Scripts => ({ prerequest: '', test: '' })

export interface RequestItem {
  type: 'request'
  id: string
  name: string
  request: RequestDraft
  extra?: Extra
}

export interface FolderItem {
  type: 'folder'
  id: string
  name: string
  description?: string
  items: TreeItem[]
  auth: AuthConfig | null
  scripts: Scripts
  extra?: Extra
}

export type TreeItem = RequestItem | FolderItem

export interface Collection {
  id: string
  name: string
  description?: string
  items: TreeItem[]
  /** `null` : aucune auth au niveau de la collection. */
  auth: AuthConfig | null
  scripts: Scripts
  variables: Variable[]
  extra?: Extra
}

/** Environnement de travail : un jeu nommé de variables, dont un seul est actif à la fois. */
export interface Environment {
  id: string
  name: string
  values: Variable[]
}

export interface HistoryEntry {
  id: string
  /** Horodatage ISO de l'envoi. */
  createdAt: string
  request: RequestDraft
  status?: number
  error?: string
  timeMs?: number
}

/** Origine d'un onglet : élément de collection, entrée d'historique ou rien (requête non enregistrée). */
export type TabSource =
  | { kind: 'collection'; collectionId: string; itemId: string }
  | { kind: 'history'; historyId: string }
  | null

/** Onglets qui n'éditent pas une requête : réglages, environnement, collection, dossier… */
export type TabView =
  | { kind: 'settings'; section?: SettingsSection }
  | { kind: 'environment'; environmentId: string }
  | { kind: 'globals' }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'folder'; collectionId: string; folderId: string }
  | { kind: 'runner'; collectionId: string; folderId?: string }

export type SettingsSection = 'general' | 'themes' | 'shortcuts' | 'update'

export interface PersistedTab {
  id: string
  title: string
  source: TabSource
  draft: RequestDraft
  /** Brouillon tel qu'enregistré ; sert à détecter les modifications. */
  saved: RequestDraft | null
  preview: boolean
  /** Présent pour un onglet de vue ; `draft` est alors inutilisé. */
  view?: TabView
}

export interface PersistedSession {
  tabs: PersistedTab[]
  activeTabId: string | null
  activeEnvironmentId?: string | null
}

export const HISTORY_LIMIT = 1000

/**
 * Conteneur des « requêtes libres » : requêtes enregistrées sans collection (fonctionnalité propre à
 * Endora). Stocké comme une collection à identifiant réservé, présenté à part dans l'interface.
 */
export const LOOSE_COLLECTION_ID = 'endora-requetes-libres'
export const LOOSE_COLLECTION_NAME = 'Requêtes libres'
export const isLoose = (c: { id: string } | null | undefined): boolean => c?.id === LOOSE_COLLECTION_ID

export const newId = (): string => crypto.randomUUID()

export const newRow = (key = '', value = '', enabled = true): KeyValue => ({ id: newId(), key, value, enabled })

export function emptyDraft(): RequestDraft {
  return {
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    body: { mode: 'none', language: 'json', raw: '', urlencoded: [], formdata: [] },
    auth: null,
    scripts: emptyScripts()
  }
}

/** Complète un brouillon enregistré par une version antérieure (session, historique). */
export function normalizeDraft(d: Partial<RequestDraft> | null | undefined): RequestDraft {
  const base = emptyDraft()
  if (!d || typeof d !== 'object') return base
  return {
    ...base,
    ...d,
    body: { ...base.body, ...(d.body ?? {}) },
    auth: d.auth ?? null,
    scripts: { ...base.scripts, ...(d.scripts ?? {}) }
  }
}

const isBlankRow = (r: KeyValue): boolean => r.key === '' && r.value === ''

/** Représentation canonique d'un brouillon, insensible aux identifiants de lignes et aux lignes vides. */
export function draftSignature(d: RequestDraft): string {
  const rows = (rs: KeyValue[]) => rs.filter((r) => !isBlankRow(r)).map((r) => [r.key, r.value, r.enabled, r.kind ?? 'text', r.description ?? ''])
  return JSON.stringify([
    d.method,
    d.url,
    rows(d.params),
    rows(d.headers),
    d.body.mode,
    d.body.language,
    d.body.raw,
    rows(d.body.urlencoded),
    rows(d.body.formdata),
    d.auth,
    d.scripts.prerequest,
    d.scripts.test,
    d.protocolVersion ?? null,
    d.extra ?? null
  ])
}

export const sameDraft = (a: RequestDraft, b: RequestDraft): boolean => draftSignature(a) === draftSignature(b)

/** Copie profonde avec de nouveaux identifiants de lignes. */
export function cloneDraft(d: RequestDraft): RequestDraft {
  const rows = (rs: KeyValue[]) => rs.map((r) => ({ ...r, id: newId() }))
  return {
    ...d,
    params: rows(d.params),
    headers: rows(d.headers),
    body: { ...d.body, urlencoded: rows(d.body.urlencoded), formdata: rows(d.body.formdata) },
    auth: d.auth ? structuredClone(d.auth) : null,
    scripts: { ...d.scripts },
    extra: d.extra ? structuredClone(d.extra) : undefined
  }
}

/**
 * Spécification envoyée au process principal. L'URL porte déjà la query string (synchronisée avec
 * le tableau des params), donc aucun param n'est ajouté une seconde fois.
 */
export function draftToSpec(d: RequestDraft): HttpRequestSpec {
  let body: RequestBody
  switch (d.body.mode) {
    case 'raw':
      body = { mode: 'raw', language: d.body.language, text: d.body.raw }
      break
    case 'urlencoded':
      body = { mode: 'urlencoded', fields: d.body.urlencoded }
      break
    case 'formdata':
      body = { mode: 'formdata', fields: d.body.formdata }
      break
    default:
      body = { mode: 'none' }
  }
  return { method: d.method, url: d.url, params: [], headers: d.headers, body }
}

/** Libellé d'une requête sans nom : l'URL, comme pour les entrées d'historique. */
export function draftLabel(d: RequestDraft): string {
  return d.url.trim() || 'Nouvelle requête'
}

/**
 * Nom unique pour un doublon : « Nom Copy », puis « Nom Copy 2 », « Nom Copy 3 »…
 * Comportement observé dans le client de référence (suffixe incrémenté jusqu'à unicité).
 */
export function duplicateName(existing: Iterable<string>, name: string): string {
  const taken = new Set(existing)
  const next = (n: string): string => {
    const parts = n.split(' ')
    const last = parts[parts.length - 1] ?? ''
    const num = Number.parseInt(last, 10)
    if (last === 'Copy') return `${n} 2`
    if (parts.length >= 3 && parts[parts.length - 2] === 'Copy' && /^\d+$/.test(last)) {
      parts[parts.length - 1] = String(num + 1)
      return parts.join(' ')
    }
    return `${n} Copy`
  }
  let candidate = next(name)
  while (taken.has(candidate)) candidate = next(candidate)
  return candidate
}

// --- Parcours de l'arbre --------------------------------------------------------------------

export function findItem(items: TreeItem[], id: string): TreeItem | null {
  for (const it of items) {
    if (it.id === id) return it
    if (it.type === 'folder') {
      const found = findItem(it.items, id)
      if (found) return found
    }
  }
  return null
}

/** Liste du conteneur direct (racine de collection ou dossier) d'un élément. */
export function findParentList(items: TreeItem[], id: string): TreeItem[] | null {
  for (const it of items) {
    if (it.id === id) return items
    if (it.type === 'folder') {
      const found = findParentList(it.items, id)
      if (found) return found
    }
  }
  return null
}

export function* walkRequests(items: TreeItem[]): Generator<RequestItem> {
  for (const it of items) {
    if (it.type === 'request') yield it
    else yield* walkRequests(it.items)
  }
}

/** Vrai si `id` est `ancestorId` ou se trouve dans son sous-arbre. */
export function isWithin(items: TreeItem[], ancestorId: string, id: string): boolean {
  const ancestor = findItem(items, ancestorId)
  if (!ancestor) return false
  if (ancestor.id === id) return true
  return ancestor.type === 'folder' && findItem(ancestor.items, id) !== null
}

/** Copie profonde d'un élément avec de nouveaux identifiants. */
export function cloneItem(item: TreeItem): TreeItem {
  if (item.type === 'request') {
    return { ...item, id: newId(), request: cloneDraft(item.request), extra: item.extra ? structuredClone(item.extra) : undefined }
  }
  return {
    ...item,
    id: newId(),
    items: item.items.map(cloneItem),
    auth: item.auth ? structuredClone(item.auth) : null,
    scripts: { ...item.scripts },
    extra: item.extra ? structuredClone(item.extra) : undefined
  }
}

/** Dossiers traversés pour atteindre un élément, du plus externe au plus proche. */
export function folderPath(items: TreeItem[], id: string): FolderItem[] | null {
  for (const it of items) {
    if (it.id === id) return []
    if (it.type === 'folder') {
      const sub = folderPath(it.items, id)
      if (sub) return [it, ...sub]
    }
  }
  return null
}
