// Persistance locale de l'espace de travail sous forme de fichiers JSON :
//   collections/<id>.json  — une collection par fichier, au format v2.1 (lisible par d'autres outils)
//   history.json           — historique des requêtes envoyées
//   session.json           — onglets ouverts, y compris les modifications non enregistrées
//   environments/<id>.json — environnements (valeurs initiales et courantes)
//   globals.json           — variables globales
//   settings.json          — réglages
//   mocks.json             — mock servers (configuration, script, version déployée)
// Les valeurs des variables de type « secret » sont chiffrées sur disque quand un chiffreur est
// disponible (trousseau du système via safeStorage).
// Chaque écriture passe par un fichier temporaire puis un renommage, et les écritures d'un même
// fichier sont sérialisées : un arrêt brutal ne laisse jamais un fichier tronqué.

import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { StorageResult, WorkspaceSnapshot } from '@shared/api'
import { normalizeMockConfig, type MockConfig } from '@shared/mock'
import { HISTORY_LIMIT, type Environment, type HistoryEntry, type PersistedSession } from '@shared/model'
import { normalizeSettings, type Settings } from '@shared/settings'
import type { Variable } from '@shared/variables'
import { t } from '@shared/i18n'

/** Chiffrement des secrets au repos. */
export interface SecretCipher {
  encrypt(text: string): string
  decrypt(data: string): string
}

const ENC = '$enc'
type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Variables reçues du renderer : seuls les champs attendus, en chaînes. */
export function sanitizeVariables(input: unknown): Variable[] {
  if (!Array.isArray(input)) return []
  return input.filter(isObject).map((v) => ({
    id: typeof v['id'] === 'string' ? v['id'] : randomUUID(),
    key: String(v['key'] ?? ''),
    value: String(v['value'] ?? ''),
    ...(typeof v['current'] === 'string' ? { current: v['current'] } : {}),
    type: v['type'] === 'secret' ? 'secret' : 'default',
    enabled: v['enabled'] !== false,
    ...(typeof v['description'] === 'string' && v['description'] ? { description: v['description'] } : {})
  }))
}

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

const failure = (err: unknown): StorageResult => ({ ok: false, message: err instanceof Error ? err.message : String(err) })

export class WorkspaceStorage {
  private readonly pending = new Map<string, Promise<unknown>>()

  constructor(
    private readonly root: string,
    private readonly cipher: SecretCipher | null = null
  ) {}

  /** Chiffre `value`/`current` des entrées secrètes d'une liste de variables (environnement, collection). */
  private sealList(list: unknown): unknown {
    if (!this.cipher || !Array.isArray(list)) return list
    return list.map((v) => {
      if (!isObject(v) || v['type'] !== 'secret') return v
      const out: Json = { ...v }
      for (const field of ['value', 'current']) if (typeof v[field] === 'string') out[field] = { [ENC]: this.cipher!.encrypt(v[field]) }
      return out
    })
  }

  private openList(list: unknown, warnings: string[], where: string): unknown {
    if (!Array.isArray(list)) return list
    return list.map((v) => {
      if (!isObject(v)) return v
      const out: Json = { ...v }
      for (const field of ['value', 'current']) {
        const sealed = v[field]
        if (!isObject(sealed) || typeof sealed[ENC] !== 'string') continue
        try {
          if (!this.cipher) throw new Error('trousseau indisponible')
          out[field] = this.cipher.decrypt(sealed[ENC])
        } catch {
          out[field] = ''
          warnings.push(t('storage.secretUnreadable', { where, key: String(v['key']) }))
        }
      }
      return out
    })
  }

  private get environmentsDir(): string {
    return join(this.root, 'environments')
  }

  private get collectionsDir(): string {
    return join(this.root, 'collections')
  }

  private collectionPath(id: string): string {
    return join(this.collectionsDir, `${id}.json`)
  }

  /** Exécute les opérations sur un même chemin l'une après l'autre. */
  private serialize<T>(path: string, op: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(path) ?? Promise.resolve()
    const next = previous.then(op, op)
    const settled = next.catch(() => undefined)
    this.pending.set(path, settled)
    void settled.then(() => {
      if (this.pending.get(path) === settled) this.pending.delete(path)
    })
    return next
  }

  private writeJson(path: string, data: unknown): Promise<StorageResult> {
    const text = JSON.stringify(data, null, 2)
    return this.serialize(path, async () => {
      try {
        await mkdir(dirname(path), { recursive: true })
        const tmp = `${path}.${randomUUID()}.tmp`
        await writeFile(tmp, text, 'utf8')
        await rename(tmp, path)
        return { ok: true } as const
      } catch (err) {
        return failure(err)
      }
    })
  }

  private async readJson(path: string): Promise<{ found: false } | { found: true; data: unknown } | { found: true; error: string }> {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { found: false }
      return { found: true, error: (err as Error).message }
    }
    try {
      return { found: true, data: JSON.parse(text) as unknown }
    } catch (err) {
      return { found: true, error: `JSON invalide (${(err as Error).message})` }
    }
  }

  async load(): Promise<WorkspaceSnapshot> {
    const warnings: string[] = []
    const collections: unknown[] = []

    let names: string[] = []
    try {
      names = (await readdir(this.collectionsDir)).filter((n) => n.endsWith('.json')).sort()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`Collections illisibles : ${(err as Error).message}`)
    }
    for (const name of names) {
      const r = await this.readJson(join(this.collectionsDir, name))
      if (!r.found) continue
      if ('error' in r) warnings.push(`${name} : ${r.error}`)
      else collections.push(isObject(r.data) ? { ...r.data, variable: this.openList(r.data['variable'], warnings, name) } : r.data)
    }

    const environments: Environment[] = []
    let envNames: string[] = []
    try {
      envNames = (await readdir(this.environmentsDir)).filter((n) => n.endsWith('.json')).sort()
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(`Environnements illisibles : ${(err as Error).message}`)
    }
    for (const name of envNames) {
      const r = await this.readJson(join(this.environmentsDir, name))
      if (!r.found) continue
      if ('error' in r || !isObject(r.data) || !isValidId(r.data['id'])) {
        warnings.push(`${name} : ${'error' in r ? r.error : 'environnement invalide'}`)
        continue
      }
      environments.push({
        id: r.data['id'],
        name: String(r.data['name'] ?? 'Environnement'),
        values: sanitizeVariables(this.openList(r.data['values'], warnings, name))
      })
    }

    const g = await this.readJson(join(this.root, 'globals.json'))
    let globals: Variable[] = []
    if (g.found && 'error' in g) warnings.push(`globals.json : ${g.error}`)
    else if (g.found && isObject(g.data)) globals = sanitizeVariables(this.openList(g.data['values'], warnings, 'globals.json'))

    const st = await this.readJson(join(this.root, 'settings.json'))
    if (st.found && 'error' in st) warnings.push(`settings.json : ${st.error}`)
    const settings = normalizeSettings(st.found && !('error' in st) ? st.data : null)

    const h = await this.readJson(join(this.root, 'history.json'))
    let history: HistoryEntry[] = []
    if (h.found && 'error' in h) warnings.push(`history.json : ${h.error}`)
    else if (h.found && Array.isArray(h.data)) history = (h.data as HistoryEntry[]).slice(0, HISTORY_LIMIT)

    const s = await this.readJson(join(this.root, 'session.json'))
    let session: PersistedSession | null = null
    if (s.found && 'error' in s) warnings.push(`session.json : ${s.error}`)
    else if (s.found && typeof s.data === 'object' && s.data !== null && Array.isArray((s.data as PersistedSession).tabs)) {
      session = s.data as PersistedSession
    }

    return { collections, history, session, environments, globals, settings, warnings }
  }

  saveCollection(id: unknown, collection: unknown): Promise<StorageResult> {
    if (!isValidId(id)) return Promise.resolve({ ok: false, message: t('storage.badCollectionId') })
    if (typeof collection !== 'object' || collection === null) {
      return Promise.resolve({ ok: false, message: t('storage.badCollection') })
    }
    const sealed = isObject(collection) && 'variable' in collection ? { ...collection, variable: this.sealList(collection['variable']) } : collection
    return this.writeJson(this.collectionPath(id), sealed)
  }

  /** Collection enregistrée (format v2.1, secrets déchiffrés), ou `null` si absente ou illisible. */
  async readCollection(id: string): Promise<unknown> {
    if (!isValidId(id)) return null
    const r = await this.readJson(this.collectionPath(id))
    if (!r.found || 'error' in r || !isObject(r.data)) return null
    return { ...r.data, variable: this.openList(r.data['variable'], [], id) }
  }

  async loadMocks(): Promise<MockConfig[]> {
    const r = await this.readJson(join(this.root, 'mocks.json'))
    if (!r.found || 'error' in r || !isObject(r.data) || !Array.isArray(r.data['mocks'])) return []
    return r.data['mocks'].map(normalizeMockConfig).filter((m): m is MockConfig => m !== null)
  }

  saveMocks(mocks: MockConfig[]): Promise<StorageResult> {
    return this.writeJson(join(this.root, 'mocks.json'), { mocks })
  }

  saveEnvironment(env: unknown): Promise<StorageResult> {
    if (!isObject(env) || !isValidId(env['id'])) return Promise.resolve({ ok: false, message: t('storage.badEnvironment') })
    const data = { id: env['id'], name: String(env['name'] ?? 'Environnement'), values: this.sealList(sanitizeVariables(env['values'])) }
    return this.writeJson(join(this.environmentsDir, `${env['id']}.json`), data)
  }

  deleteEnvironment(id: unknown): Promise<StorageResult> {
    if (!isValidId(id)) return Promise.resolve({ ok: false, message: t('storage.badEnvironmentId') })
    const path = join(this.environmentsDir, `${id}.json`)
    return this.serialize(path, async () => {
      try {
        await rm(path, { force: true })
        return { ok: true } as const
      } catch (err) {
        return failure(err)
      }
    })
  }

  saveGlobals(values: unknown): Promise<StorageResult> {
    return this.writeJson(join(this.root, 'globals.json'), { values: this.sealList(sanitizeVariables(values)) })
  }

  saveSettings(settings: unknown): Promise<StorageResult> {
    return this.writeJson(join(this.root, 'settings.json'), normalizeSettings(settings))
  }

  /** Réglages courants (lecture synchrone du dernier état connu par le process principal). */
  async readSettings(): Promise<Settings> {
    const st = await this.readJson(join(this.root, 'settings.json'))
    return normalizeSettings(st.found && !('error' in st) ? st.data : null)
  }

  deleteCollection(id: unknown): Promise<StorageResult> {
    if (!isValidId(id)) return Promise.resolve({ ok: false, message: t('storage.badCollectionId') })
    const path = this.collectionPath(id)
    return this.serialize(path, async () => {
      try {
        await rm(path, { force: true })
        return { ok: true } as const
      } catch (err) {
        return failure(err)
      }
    })
  }

  saveHistory(entries: unknown): Promise<StorageResult> {
    if (!Array.isArray(entries)) return Promise.resolve({ ok: false, message: t('storage.badHistory') })
    return this.writeJson(join(this.root, 'history.json'), entries.slice(0, HISTORY_LIMIT))
  }

  saveSession(session: unknown): Promise<StorageResult> {
    if (typeof session !== 'object' || session === null || !Array.isArray((session as PersistedSession).tabs)) {
      return Promise.resolve({ ok: false, message: t('storage.badSession') })
    }
    return this.writeJson(join(this.root, 'session.json'), session)
  }

  /** Attend la fin des écritures en cours (fermeture de l'app, tests). */
  async flush(): Promise<void> {
    await Promise.all([...this.pending.values()])
  }
}
