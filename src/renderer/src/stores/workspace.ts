// Collections et historique, persistés localement par le process principal.

import { create } from 'zustand'
import { exportCollection, importCollection } from '@shared/collection-v21'
import {
  cloneItem,
  duplicateName,
  emptyScripts,
  findItem,
  findParentList,
  HISTORY_LIMIT,
  isLoose,
  isWithin,
  LOOSE_COLLECTION_ID,
  LOOSE_COLLECTION_NAME,
  newId,
  normalizeDraft,
  type Collection,
  type FolderItem,
  type HistoryEntry,
  type PersistedSession,
  type RequestDraft,
  type TreeItem
} from '@shared/model'
import type { VariableMutation } from '@shared/scripting/types'
import { mutateVariables, useEnvironments } from './environments'
import { useSettings } from './settings'
import { toast } from './ui'

interface WorkspaceState {
  loaded: boolean
  collections: Collection[]
  history: HistoryEntry[]

  init: () => Promise<PersistedSession | null>

  createCollection: (name?: string) => Collection
  /** Conteneur des requêtes libres, créé à la première utilisation. */
  ensureLoose: () => Collection
  addCollections: (collections: Collection[]) => void
  renameCollection: (id: string, name: string) => void
  duplicateCollection: (id: string) => void
  deleteCollection: (id: string) => void

  addFolder: (collectionId: string, parentId: string | null, name?: string) => string | null
  addRequest: (collectionId: string, parentId: string | null, name: string, draft: RequestDraft) => string | null
  updateRequest: (collectionId: string, itemId: string, draft: RequestDraft) => boolean
  renameItem: (collectionId: string, itemId: string, name: string) => void
  duplicateItem: (collectionId: string, itemId: string) => string | null
  deleteItem: (collectionId: string, itemId: string) => void
  moveItem: (from: { collectionId: string; itemId: string }, to: { collectionId: string; parentId: string | null; beforeId?: string }) => void

  updateCollection: (id: string, fn: (c: Collection) => void) => void
  updateFolder: (collectionId: string, folderId: string, fn: (f: FolderItem) => void) => void
  applyCollectionMutations: (collectionId: string, mutations: VariableMutation[]) => void

  addHistory: (entry: HistoryEntry) => void
  updateHistory: (id: string, patch: Partial<HistoryEntry>) => void
  deleteHistory: (id: string) => void
  clearHistory: () => void
}

// --- Persistance différée ------------------------------------------------------------------

const pendingCollections = new Map<string, ReturnType<typeof setTimeout>>()
let historyTimer: ReturnType<typeof setTimeout> | null = null

function persistCollection(id: string): void {
  const previous = pendingCollections.get(id)
  if (previous) clearTimeout(previous)
  pendingCollections.set(
    id,
    setTimeout(() => {
      pendingCollections.delete(id)
      const c = useWorkspace.getState().collections.find((x) => x.id === id)
      const op = c ? window.endora.saveCollection(id, exportCollection(c, { includeCurrentValues: true })) : window.endora.deleteCollection(id)
      void op.then((r) => {
        if (!r.ok) toast(`Enregistrement impossible : ${r.message}`, 'error')
      })
    }, 300)
  )
}

function persistHistory(): void {
  if (historyTimer) clearTimeout(historyTimer)
  historyTimer = setTimeout(() => {
    historyTimer = null
    void window.endora.saveHistory(useWorkspace.getState().history).then((r) => {
      if (!r.ok) toast(`Historique non enregistré : ${r.message}`, 'error')
    })
  }, 500)
}

/** Liste dans laquelle insérer : racine de la collection ou contenu d'un dossier. */
function containerOf(c: Collection, parentId: string | null): TreeItem[] | null {
  if (parentId === null) return c.items
  const parent = findItem(c.items, parentId)
  return parent?.type === 'folder' ? parent.items : null
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  /** Applique une modification sur une copie de la collection, puis la persiste. */
  function mutate<T>(collectionId: string, fn: (c: Collection) => T): T | undefined {
    const current = get().collections.find((c) => c.id === collectionId)
    if (!current) return undefined
    const copy = structuredClone(current)
    const result = fn(copy)
    set({ collections: get().collections.map((c) => (c.id === collectionId ? copy : c)) })
    persistCollection(collectionId)
    return result
  }

  return {
    loaded: false,
    collections: [],
    history: [],

    init: async () => {
      const snapshot = await window.endora.loadWorkspace()
      const collections: Collection[] = []
      for (const raw of snapshot.collections) {
        const r = importCollection(raw, { keepIds: true })
        if (r.ok) collections.push(r.collection)
        else toast(`Collection ignorée : ${r.message}`, 'error')
      }
      for (const w of snapshot.warnings) toast(`Fichier ignoré : ${w}`, 'error')
      collections.sort((a, b) => (isLoose(a) ? -1 : isLoose(b) ? 1 : a.name.localeCompare(b.name)))
      useSettings.getState().init(snapshot.settings)
      useEnvironments.getState().init(snapshot.environments, snapshot.globals, snapshot.session?.activeEnvironmentId ?? null)
      set({ loaded: true, collections, history: snapshot.history.map((h) => ({ ...h, request: normalizeDraft(h.request) })) })
      return snapshot.session
    },

    createCollection: (name = 'Nouvelle collection') => {
      const c: Collection = { id: newId(), name, items: [], auth: null, scripts: emptyScripts(), variables: [] }
      set({ collections: [...get().collections, c] })
      persistCollection(c.id)
      return c
    },

    ensureLoose: () => {
      const existing = get().collections.find(isLoose)
      if (existing) return existing
      const c: Collection = { id: LOOSE_COLLECTION_ID, name: LOOSE_COLLECTION_NAME, items: [], auth: null, scripts: emptyScripts(), variables: [] }
      set({ collections: [c, ...get().collections] })
      persistCollection(c.id)
      return c
    },

    addCollections: (collections) => {
      set({ collections: [...get().collections, ...collections] })
      for (const c of collections) persistCollection(c.id)
    },

    renameCollection: (id, name) => {
      if (name.trim() === '') return
      mutate(id, (c) => {
        c.name = name.trim()
      })
    },

    duplicateCollection: (id) => {
      const source = get().collections.find((c) => c.id === id)
      if (!source) return
      const copy: Collection = {
        ...structuredClone(source),
        id: newId(),
        name: duplicateName(get().collections.map((c) => c.name), source.name),
        items: source.items.map(cloneItem)
      }
      const index = get().collections.indexOf(source)
      const next = [...get().collections]
      next.splice(index + 1, 0, copy)
      set({ collections: next })
      persistCollection(copy.id)
    },

    deleteCollection: (id) => {
      set({ collections: get().collections.filter((c) => c.id !== id) })
      persistCollection(id)
    },

    addFolder: (collectionId, parentId, name = 'Nouveau dossier') =>
      mutate(collectionId, (c) => {
        const list = containerOf(c, parentId)
        if (!list) return null
        const folder: FolderItem = { type: 'folder', id: newId(), name, items: [], auth: null, scripts: emptyScripts() }
        list.push(folder)
        return folder.id
      }) ?? null,

    addRequest: (collectionId, parentId, name, draft) =>
      mutate(collectionId, (c) => {
        const list = containerOf(c, parentId)
        if (!list) return null
        const id = newId()
        list.push({ type: 'request', id, name: name.trim() || 'Nouvelle requête', request: structuredClone(draft) })
        return id
      }) ?? null,

    updateRequest: (collectionId, itemId, draft) =>
      mutate(collectionId, (c) => {
        const item = findItem(c.items, itemId)
        if (item?.type !== 'request') return false
        item.request = structuredClone(draft)
        return true
      }) ?? false,

    renameItem: (collectionId, itemId, name) => {
      if (name.trim() === '') return
      mutate(collectionId, (c) => {
        const item = findItem(c.items, itemId)
        if (item) item.name = name.trim()
      })
    },

    duplicateItem: (collectionId, itemId) =>
      mutate(collectionId, (c) => {
        const list = findParentList(c.items, itemId)
        const item = list?.find((i) => i.id === itemId)
        if (!list || !item) return null
        const copy = cloneItem(item)
        copy.name = duplicateName(
          list.map((i) => i.name),
          item.name
        )
        list.splice(list.indexOf(item) + 1, 0, copy)
        return copy.id
      }) ?? null,

    deleteItem: (collectionId, itemId) => {
      mutate(collectionId, (c) => {
        const list = findParentList(c.items, itemId)
        if (!list) return
        const index = list.findIndex((i) => i.id === itemId)
        if (index !== -1) list.splice(index, 1)
      })
    },

    moveItem: (from, to) => {
      const src = get().collections.find((c) => c.id === from.collectionId)
      const dst = get().collections.find((c) => c.id === to.collectionId)
      if (!src || !dst) return
      const item = findItem(src.items, from.itemId)
      if (!item || to.beforeId === from.itemId) return
      // Un dossier ne peut pas être déplacé dans son propre sous-arbre.
      if (from.collectionId === to.collectionId && to.parentId !== null && isWithin(src.items, from.itemId, to.parentId)) return

      const collections = get().collections.map((c) =>
        c.id === from.collectionId || c.id === to.collectionId ? structuredClone(c) : c
      )
      const srcCopy = collections.find((c) => c.id === from.collectionId)!
      const dstCopy = collections.find((c) => c.id === to.collectionId)!
      const srcList = findParentList(srcCopy.items, from.itemId)!
      const [moved] = srcList.splice(
        srcList.findIndex((i) => i.id === from.itemId),
        1
      )
      const target = containerOf(dstCopy, to.parentId)
      if (!moved || !target) return
      const before = to.beforeId ? target.findIndex((i) => i.id === to.beforeId) : -1
      if (before === -1) target.push(moved)
      else target.splice(before, 0, moved)
      set({ collections })
      persistCollection(from.collectionId)
      if (to.collectionId !== from.collectionId) persistCollection(to.collectionId)
    },

    updateCollection: (id, fn) => {
      mutate(id, fn)
    },

    updateFolder: (collectionId, folderId, fn) => {
      mutate(collectionId, (c) => {
        const folder = findItem(c.items, folderId)
        if (folder?.type === 'folder') fn(folder)
      })
    },

    applyCollectionMutations: (collectionId, mutations) => {
      const relevant = mutations.filter((m) => m.scope === 'collectionVariables')
      if (relevant.length === 0) return
      mutate(collectionId, (c) => {
        c.variables = mutateVariables(c.variables, relevant)
      })
    },

    addHistory: (entry) => {
      set({ history: [entry, ...get().history].slice(0, HISTORY_LIMIT) })
      persistHistory()
    },

    updateHistory: (id, patch) => {
      set({ history: get().history.map((h) => (h.id === id ? { ...h, ...patch } : h)) })
      persistHistory()
    },

    deleteHistory: (id) => {
      set({ history: get().history.filter((h) => h.id !== id) })
      persistHistory()
    },

    clearHistory: () => {
      set({ history: [] })
      persistHistory()
    }
  }
})

/** Retrouve un élément de collection (pour titres d'onglets et détection de suppression). */
export function lookupItem(collections: Collection[], collectionId: string, itemId: string): TreeItem | null {
  const c = collections.find((x) => x.id === collectionId)
  return c ? findItem(c.items, itemId) : null
}
