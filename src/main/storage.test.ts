import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyDraft, HISTORY_LIMIT, type HistoryEntry } from '@shared/model'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { newVariable } from '@shared/variables'
import { WorkspaceStorage, type SecretCipher } from './storage'

/** Chiffreur de test réversible (le vrai utilise le trousseau du système). */
const cipher: SecretCipher = {
  encrypt: (t) => Buffer.from(`sealed:${t}`).toString('base64'),
  decrypt: (d) => {
    const t = Buffer.from(d, 'base64').toString()
    if (!t.startsWith('sealed:')) throw new Error('bad')
    return t.slice(7)
  }
}

let root: string
let storage: WorkspaceStorage

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'endora-storage-'))
  storage = new WorkspaceStorage(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const entry = (i: number): HistoryEntry => ({ id: `h${i}`, createdAt: new Date(i).toISOString(), request: emptyDraft() })

describe('WorkspaceStorage', () => {
  it('démarre vide sans erreur', async () => {
    expect(await storage.load()).toEqual({
      collections: [],
      history: [],
      session: null,
      environments: [],
      globals: [],
      settings: DEFAULT_SETTINGS,
      warnings: []
    })
  })

  it('persiste collections, historique et session', async () => {
    expect(await storage.saveCollection('abc-1', { info: { name: 'A' }, item: [] })).toEqual({ ok: true })
    await storage.saveHistory([entry(1)])
    await storage.saveSession({ tabs: [], activeTabId: null })
    const loaded = await storage.load()
    expect(loaded.collections).toEqual([{ info: { name: 'A' }, item: [] }])
    expect(loaded.history).toHaveLength(1)
    expect(loaded.session).toEqual({ tabs: [], activeTabId: null })

    await storage.deleteCollection('abc-1')
    expect((await storage.load()).collections).toEqual([])
  })

  it('refuse les identifiants qui sortiraient du dossier', async () => {
    for (const id of ['../x', 'a/b', '', '..', 'a.json', 42]) {
      expect(await storage.saveCollection(id, { item: [] })).toMatchObject({ ok: false })
      expect(await storage.deleteCollection(id)).toMatchObject({ ok: false })
    }
    await expect(readdir(root)).resolves.toEqual([])
  })

  it('sérialise les écritures concurrentes : la dernière gagne et aucun fichier temporaire ne reste', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => storage.saveCollection('c', { info: { name: `v${i}` }, item: [] })))
    await storage.flush()
    const text = await readFile(join(root, 'collections', 'c.json'), 'utf8')
    expect(JSON.parse(text)).toEqual({ info: { name: 'v19' }, item: [] })
    expect(await readdir(join(root, 'collections'))).toEqual(['c.json'])
  })

  it('borne la taille de l’historique', async () => {
    await storage.saveHistory(Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => entry(i)))
    expect((await storage.load()).history).toHaveLength(HISTORY_LIMIT)
  })

  it('signale un fichier corrompu sans bloquer le reste', async () => {
    await mkdir(join(root, 'collections'), { recursive: true })
    await writeFile(join(root, 'collections', 'bad.json'), '{ pas du json')
    await storage.saveCollection('good', { info: { name: 'G' }, item: [] })
    const loaded = await storage.load()
    expect(loaded.collections).toHaveLength(1)
    expect(loaded.warnings[0]).toMatch(/^bad\.json/)
  })

  it('persiste environnements, globales et réglages, avec secrets chiffrés sur disque', async () => {
    const sealed = new WorkspaceStorage(root, cipher)
    const secret = { ...newVariable('token', 'initial-secret', 'secret'), current: 'courant-secret' }
    await sealed.saveEnvironment({ id: 'env-1', name: 'Prod', values: [newVariable('host', 'h'), secret] })
    await sealed.saveGlobals([{ ...newVariable('g', 'gs', 'secret') }])
    await sealed.saveSettings({ ...DEFAULT_SETTINGS, general: { ...DEFAULT_SETTINGS.general, httpVersion: 'http2' } })
    await sealed.saveCollection('c1', { info: { name: 'C' }, item: [], variable: [{ key: 'k', value: 'cs', type: 'secret' }] })

    const raw = await readFile(join(root, 'environments', 'env-1.json'), 'utf8')
    expect(raw).not.toContain('initial-secret')
    expect(raw).not.toContain('courant-secret')
    expect(raw).toContain('"host"')
    expect(await readFile(join(root, 'globals.json'), 'utf8')).not.toContain('gs')
    expect(await readFile(join(root, 'collections', 'c1.json'), 'utf8')).not.toContain('"cs"')

    const loaded = await sealed.load()
    expect(loaded.warnings).toEqual([])
    expect(loaded.environments[0]!.values[1]).toMatchObject({ key: 'token', value: 'initial-secret', current: 'courant-secret', type: 'secret' })
    expect(loaded.globals[0]).toMatchObject({ key: 'g', value: 'gs' })
    expect(loaded.settings.general.httpVersion).toBe('http2')
    expect((loaded.collections[0] as { variable: unknown[] }).variable[0]).toMatchObject({ value: 'cs' })

    // Sans trousseau, une valeur chiffrée devient vide et un avertissement est émis.
    const plain = await new WorkspaceStorage(root, null).load()
    expect(plain.environments[0]!.values[1]!.value).toBe('')
    expect(plain.warnings.some((w) => w.includes('token'))).toBe(true)
  })

  it('refuse un environnement invalide et normalise des réglages corrompus', async () => {
    expect(await storage.saveEnvironment({ id: '../x', name: 'a', values: [] })).toMatchObject({ ok: false })
    await writeFile(join(root, 'settings.json'), JSON.stringify({ general: { httpVersion: 'http9', requestTimeoutMs: -5 }, theme: { mode: 'fixed', fixed: 'inconnu' } }))
    const s = (await storage.load()).settings
    expect(s.general.httpVersion).toBe('auto')
    expect(s.general.requestTimeoutMs).toBe(0)
    expect(s.theme).toMatchObject({ mode: 'fixed', fixed: 'endora-dark' })
  })
})
