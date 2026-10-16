// Import/export au format public « collection v2.1 » (et import v2.0), pour rester compatible avec
// les fichiers de collections existants. Implémentation propre à partir du schéma JSON public.
//
// L'auth, les scripts (`event` prerequest/test), les variables de collection et la version HTTP
// sont convertis vers le modèle typé. Les champs que l'éditeur ne gère pas encore (exemples de
// réponses, autres événements, bodies GraphQL/fichier…) sont conservés dans `extra` et réémis.

import { authFromV21, authToV21 } from './auth'
import type { KeyValue } from './http'
import {
  emptyDraft,
  emptyScripts,
  newId,
  type Collection,
  type Extra,
  type FolderItem,
  type RawLanguage,
  type RequestDraft,
  type RequestItem,
  type Scripts,
  type TreeItem
} from './model'
import { parseQuery, splitUrl } from './url'
import { exportVariables, importVariables } from './variables'

export const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

export type CollectionImportResult = { ok: true; collection: Collection } | { ok: false; message: string }

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v))

function omit(obj: Json, keys: string[]): Extra | undefined {
  const out: Extra = {}
  for (const [k, v] of Object.entries(obj)) if (!keys.includes(k) && v !== undefined) out[k] = v
  return Object.keys(out).length > 0 ? out : undefined
}

// --- Import ---------------------------------------------------------------------------------

interface ImportContext {
  version: '2.0' | '2.1'
  keepIds: boolean
  seenIds: Set<string>
}

/** Détecte une collection v2.x (éventuellement enveloppée dans `{ collection: … }`). */
export function looksLikeCollection(input: unknown): boolean {
  const root = isObject(input) && isObject(input['collection']) ? input['collection'] : input
  return isObject(root) && isObject(root['info']) && Array.isArray(root['item'])
}

/**
 * Convertit une collection v2.0/v2.1 en collection interne. Ne lève jamais.
 * `keepIds` réutilise les identifiants présents (stockage local) ; sinon de nouveaux sont générés.
 */
export function importCollection(input: unknown, opts: { keepIds?: boolean } = {}): CollectionImportResult {
  const root = isObject(input) && isObject(input['collection']) ? input['collection'] : input
  if (!isObject(root)) return { ok: false, message: 'Le fichier ne contient pas un objet JSON.' }
  if (Array.isArray(root['requests']) && root['item'] === undefined) {
    return { ok: false, message: "Le format de collection v1 n'est pas pris en charge. Exportez la collection en v2.1." }
  }
  const info = root['info']
  if (!isObject(info) || !Array.isArray(root['item'])) {
    return { ok: false, message: "Ce fichier n'est pas une collection v2.0 ou v2.1 (champs « info » et « item » attendus)." }
  }
  const schema = str(info['schema'])
  if (schema !== '' && !/\/v2\.[01]\.\d+\//.test(schema)) {
    return { ok: false, message: `Version de schéma non prise en charge : ${schema}` }
  }
  const ctx: ImportContext = {
    version: schema.includes('/v2.0.') ? '2.0' : '2.1',
    keepIds: opts.keepIds ?? false,
    seenIds: new Set()
  }
  try {
    const rootExtra = omit(root, ['info', 'item'])
    const infoExtra = omit(info, ['_postman_id', 'name', 'schema', 'description'])
    const { auth, event, variable, ...others } = rootExtra ?? {}
    const extra: Extra = { ...others }
    if (infoExtra) extra['info'] = infoExtra
    const { scripts, otherEvents } = scriptsFromEvents(event)
    if (otherEvents) extra['event'] = otherEvents
    const description = info['description']
    if (description !== undefined && typeof description !== 'string') extra['description'] = description
    const collection: Collection = {
      id: pickId(info['_postman_id'], ctx),
      name: str(info['name']).trim() || 'Collection sans nom',
      items: (root['item'] as unknown[]).map((it) => importItem(it, ctx)),
      auth: authFromV21(auth),
      scripts,
      variables: importVariables(variable, { keepCurrent: ctx.keepIds }),
      ...(typeof description === 'string' && description !== '' ? { description } : {}),
      ...(Object.keys(extra).length > 0 ? { extra } : {})
    }
    return { ok: true, collection }
  } catch (err) {
    return { ok: false, message: `Collection invalide : ${err instanceof Error ? err.message : String(err)}` }
  }
}

function pickId(candidate: unknown, ctx: ImportContext): string {
  if (ctx.keepIds && typeof candidate === 'string' && candidate !== '' && !ctx.seenIds.has(candidate)) {
    ctx.seenIds.add(candidate)
    return candidate
  }
  return newId()
}

function importItem(raw: unknown, ctx: ImportContext): TreeItem {
  if (!isObject(raw)) throw new Error('élément de collection invalide')
  if (Array.isArray(raw['item'])) {
    const { auth, event, ...extra } = omit(raw, ['id', 'name', 'item', 'description']) ?? {}
    const { scripts, otherEvents } = scriptsFromEvents(event)
    const description = raw['description']
    const folderExtra: Extra = { ...extra }
    if (otherEvents) folderExtra['event'] = otherEvents
    if (description !== undefined && typeof description !== 'string') folderExtra['description'] = description
    const folder: FolderItem = {
      type: 'folder',
      id: pickId(raw['id'], ctx),
      name: str(raw['name']).trim() || 'Dossier',
      items: raw['item'].map((it) => importItem(it, ctx)),
      auth: authFromV21(auth),
      scripts,
      ...(typeof description === 'string' && description !== '' ? { description } : {}),
      ...(Object.keys(folderExtra).length > 0 ? { extra: folderExtra } : {})
    }
    return folder
  }
  const request = importRequest(raw['request'], ctx)
  const { event, protocolProfileBehavior, ...rest } = omit(raw, ['id', 'name', 'request']) ?? {}
  const extra: Extra = { ...rest }
  const { scripts, otherEvents } = scriptsFromEvents(event)
  request.scripts = scripts
  if (otherEvents) extra['event'] = otherEvents
  if (isObject(protocolProfileBehavior)) {
    const { protocolVersion, ...otherBehavior } = protocolProfileBehavior
    if (protocolVersion === 'auto' || protocolVersion === 'http1' || protocolVersion === 'http2') request.protocolVersion = protocolVersion
    if (Object.keys(otherBehavior).length > 0) extra['protocolProfileBehavior'] = otherBehavior
  }
  const item: RequestItem = {
    type: 'request',
    id: pickId(raw['id'], ctx),
    name: str(raw['name']).trim() || request.url || 'Requête',
    request,
    ...(Object.keys(extra).length > 0 ? { extra } : {})
  }
  return item
}

const RAW_LANGUAGES: RawLanguage[] = ['json', 'xml', 'html', 'text', 'javascript']

function kvRows(list: unknown, file = false): KeyValue[] {
  if (!Array.isArray(list)) return []
  const rows: KeyValue[] = []
  for (const e of list) {
    if (!isObject(e)) continue
    const isFile = file && e['type'] === 'file'
    const src = Array.isArray(e['src']) ? e['src'][0] : e['src']
    const row: KeyValue = {
      id: newId(),
      key: str(e['key']),
      value: isFile ? str(src) : str(e['value']),
      enabled: e['disabled'] !== true
    }
    if (isFile) row.kind = 'file'
    if (typeof e['description'] === 'string' && e['description'] !== '') row.description = e['description']
    rows.push(row)
  }
  return rows
}

function headerRows(header: unknown): KeyValue[] {
  if (typeof header === 'string') {
    // Forme chaîne autorisée par le schéma : « Clé: valeur » par ligne.
    return header
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .map((line) => {
        const i = line.indexOf(':')
        return { id: newId(), key: (i === -1 ? line : line.slice(0, i)).trim(), value: i === -1 ? '' : line.slice(i + 1).trim(), enabled: true }
      })
  }
  return kvRows(header)
}

/** Construit l'URL brute à partir d'un objet URL v2 quand `raw` est absent. */
function rawFromUrlObject(u: Json): string {
  const join = (v: unknown, sep: string) => (Array.isArray(v) ? v.map((x) => (isObject(x) ? str(x['value']) : str(x))).join(sep) : str(v))
  let raw = ''
  if (u['protocol']) raw += `${str(u['protocol'])}://`
  raw += join(u['host'], '.')
  if (u['port']) raw += `:${str(u['port'])}`
  const path = join(u['path'], '/')
  if (path !== '') raw += `/${path}`
  if (Array.isArray(u['query'])) {
    const q = u['query'].filter((e) => isObject(e) && e['disabled'] !== true) as Json[]
    if (q.length > 0) raw += `?${q.map((e) => (e['value'] == null ? str(e['key']) : `${str(e['key'])}=${str(e['value'])}`)).join('&')}`
  }
  if (u['hash']) raw += `#${str(u['hash'])}`
  return raw
}

/** Importe une requête v2.x (objet `request` ou simple chaîne d'URL). Exporté pour la conversion cURL. */
export function importRequest(raw: unknown, ctx: ImportContext = { version: '2.1', keepIds: false, seenIds: new Set() }): RequestDraft {
  const draft = emptyDraft()
  if (typeof raw === 'string') {
    draft.url = raw
    draft.params = kvRows(parseQuery(splitUrl(raw).query))
    return draft
  }
  if (!isObject(raw)) return draft
  draft.method = (str(raw['method']) || 'GET').toUpperCase()

  const url = raw['url']
  const extra: Extra = omit(raw, ['method', 'url', 'header', 'body']) ?? {}
  if (typeof url === 'string') {
    draft.url = url
    draft.params = kvRows(parseQuery(splitUrl(url).query))
  } else if (isObject(url)) {
    draft.url = typeof url['raw'] === 'string' ? url['raw'] : rawFromUrlObject(url)
    draft.params = Array.isArray(url['query']) ? kvRows(url['query']) : kvRows(parseQuery(splitUrl(draft.url).query))
    const urlExtra = omit(url, ['raw', 'protocol', 'host', 'port', 'path', 'query', 'hash'])
    if (urlExtra) extra['url'] = urlExtra
  }
  draft.headers = headerRows(raw['header'])

  const body = raw['body']
  if (isObject(body)) {
    const mode = str(body['mode'])
    if (mode === 'raw') {
      const options = isObject(body['options']) && isObject(body['options']['raw']) ? body['options']['raw'] : {}
      const lang = str(options['language']) as RawLanguage
      draft.body.mode = 'raw'
      draft.body.raw = str(body['raw'])
      draft.body.language = RAW_LANGUAGES.includes(lang) ? lang : 'text'
    } else if (mode === 'urlencoded') {
      draft.body.mode = 'urlencoded'
      draft.body.urlencoded = kvRows(body['urlencoded'])
    } else if (mode === 'formdata') {
      draft.body.mode = 'formdata'
      draft.body.formdata = kvRows(body['formdata'], true)
    } else if (mode !== '') {
      // file, graphql… : conservés tels quels jusqu'à leur prise en charge.
      extra['body'] = body
    }
    if (body['disabled'] === true && draft.body.mode !== 'none') extra['bodyDisabled'] = true
  }
  if (extra['auth'] !== undefined) {
    draft.auth = authFromV21(extra['auth'])
    delete extra['auth']
  }
  if (Object.keys(extra).length > 0) draft.extra = extra
  return draft
}

/** Événements `prerequest` / `test` → scripts ; les autres événements sont conservés. */
function scriptsFromEvents(event: unknown): { scripts: Scripts; otherEvents: unknown[] | undefined } {
  const scripts = emptyScripts()
  if (!Array.isArray(event)) return { scripts, otherEvents: undefined }
  const others: unknown[] = []
  for (const e of event) {
    const listen = isObject(e) ? e['listen'] : undefined
    if ((listen === 'prerequest' || listen === 'test') && isObject(e) && isObject(e['script'])) {
      const exec = e['script']['exec']
      const code = Array.isArray(exec) ? exec.map((l) => str(l)).join('\n') : str(exec)
      scripts[listen] = scripts[listen] ? `${scripts[listen]}\n${code}` : code
    } else {
      others.push(e)
    }
  }
  return { scripts, otherEvents: others.length > 0 ? others : undefined }
}

function eventsFromScripts(scripts: Scripts, others: unknown): unknown[] | undefined {
  const events: unknown[] = []
  for (const listen of ['prerequest', 'test'] as const) {
    if (scripts[listen].trim() === '') continue
    events.push({ listen, script: { type: 'text/javascript', exec: scripts[listen].split('\n') } })
  }
  if (Array.isArray(others)) events.push(...others)
  return events.length > 0 ? events : undefined
}

// --- Export ---------------------------------------------------------------------------------

/** Objet URL v2.1 décomposé à partir du texte de l'URL (les {{variables}} restent intactes). */
export function urlObject(raw: string, params: KeyValue[]): Json {
  const { base, hash } = splitUrl(raw)
  const out: Json = { raw }
  let rest = base
  const proto = /^([a-z][a-z0-9+.-]*):\/\//i.exec(rest)
  if (proto) {
    out['protocol'] = proto[1]
    rest = rest.slice(proto[0].length)
  }
  const slash = rest.indexOf('/')
  let hostPort = slash === -1 ? rest : rest.slice(0, slash)
  const pathPart = slash === -1 ? null : rest.slice(slash + 1)
  const port = /:(\d+|\{\{[^}]+\}\})$/.exec(hostPort)
  if (port) {
    out['port'] = port[1]
    hostPort = hostPort.slice(0, port.index)
  }
  if (hostPort !== '') out['host'] = hostPort.split('.')
  if (pathPart !== null) out['path'] = pathPart.split('/')
  const query = params
    .filter((p) => p.key !== '' || p.value !== '')
    .map((p) => ({ key: p.key, value: p.value, ...(p.enabled ? {} : { disabled: true }), ...(p.description ? { description: p.description } : {}) }))
  if (query.length > 0) out['query'] = query
  if (hash !== null) out['hash'] = hash
  return out
}

function exportRows(rows: KeyValue[], withType: boolean): Json[] {
  return rows
    .filter((r) => r.key !== '' || r.value !== '')
    .map((r) => {
      const isFile = withType && r.kind === 'file'
      return {
        key: r.key,
        ...(isFile ? { type: 'file', src: r.value } : { value: r.value, ...(withType ? { type: 'text' } : {}) }),
        ...(r.enabled ? {} : { disabled: true }),
        ...(r.description ? { description: r.description } : {})
      }
    })
}

export function exportRequest(d: RequestDraft): Json {
  const { body: keptBody, url: urlExtra, bodyDisabled, ...rest } = d.extra ?? {}
  const out: Json = { method: d.method }
  out['header'] = exportRows(d.headers, false).map((h) => ({ ...h, type: 'text' }))
  const b = d.body
  if (b.mode === 'raw') {
    out['body'] = { mode: 'raw', raw: b.raw, options: { raw: { language: b.language } } }
  } else if (b.mode === 'urlencoded') {
    out['body'] = { mode: 'urlencoded', urlencoded: exportRows(b.urlencoded, false) }
  } else if (b.mode === 'formdata') {
    out['body'] = { mode: 'formdata', formdata: exportRows(b.formdata, true) }
  } else if (isObject(keptBody)) {
    out['body'] = keptBody
  }
  if (bodyDisabled === true && isObject(out['body'])) out['body'] = { ...out['body'], disabled: true }
  out['url'] = { ...urlObject(d.url, d.params), ...(isObject(urlExtra) ? urlExtra : {}) }
  if (d.auth) out['auth'] = authToV21(d.auth)
  return { ...rest, ...out }
}

function exportItem(item: TreeItem, opts: ExportOptions): Json {
  if (item.type === 'folder') {
    const { description: richDescription, event: otherEvents, ...extra } = item.extra ?? {}
    const description = item.description ?? richDescription
    const event = eventsFromScripts(item.scripts, otherEvents)
    return {
      name: item.name,
      ...(description !== undefined ? { description } : {}),
      item: item.items.map((i) => exportItem(i, opts)),
      ...extra,
      ...(item.auth ? { auth: authToV21(item.auth) } : {}),
      ...(event ? { event } : {}),
      id: item.id
    }
  }
  const { event: otherEvents, protocolProfileBehavior, ...extra } = item.extra ?? {}
  const event = eventsFromScripts(item.request.scripts, otherEvents)
  const behavior = {
    ...(isObject(protocolProfileBehavior) ? protocolProfileBehavior : {}),
    ...(item.request.protocolVersion ? { protocolVersion: item.request.protocolVersion } : {})
  }
  return {
    name: item.name,
    ...extra,
    ...(event ? { event } : {}),
    ...(Object.keys(behavior).length > 0 ? { protocolProfileBehavior: behavior } : {}),
    id: item.id,
    request: exportRequest(item.request)
  }
}

export interface ExportOptions {
  /** Stockage local : conserve les valeurs courantes des variables (jamais dans un fichier exporté). */
  includeCurrentValues?: boolean
}

/** Sérialise une collection interne au format v2.1. */
export function exportCollection(c: Collection, opts: ExportOptions = {}): Json {
  const { info: infoExtra, description: richDescription, event: otherEvents, ...rootExtra } = c.extra ?? {}
  const event = eventsFromScripts(c.scripts, otherEvents)
  const variable = exportVariables(c.variables, { includeCurrent: opts.includeCurrentValues, withIds: opts.includeCurrentValues, format: 'collection' })
  const description = c.description ?? richDescription
  return {
    info: {
      _postman_id: c.id,
      name: c.name,
      ...(description !== undefined ? { description } : {}),
      schema: SCHEMA_V21,
      ...(isObject(infoExtra) ? infoExtra : {})
    },
    item: c.items.map((i) => exportItem(i, opts)),
    ...rootExtra,
    ...(c.auth ? { auth: authToV21(c.auth) } : {}),
    ...(event ? { event } : {}),
    ...(variable.length > 0 ? { variable } : {})
  }
}
