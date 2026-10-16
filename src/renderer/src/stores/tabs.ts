// Onglets. Comportement de référence observé :
// - ouvrir un élément déjà affiché dans un onglet donne simplement le focus à cet onglet ;
// - une ouverture « aperçu » (simple clic) réutilise l'onglet d'aperçu existant au lieu d'en créer un,
//   sauf si le réglage « ouvrir dans un nouvel onglet » est actif ;
// - une ouverture explicite (double clic) rend l'onglet permanent ;
// - fermer un onglet modifié demande confirmation (réglable) ; un onglet fermé peut être rouvert.
// Inféré : une modification rend l'onglet d'aperçu permanent.
// Les réglages, environnements, collections et dossiers s'ouvrent aussi dans des onglets (« vues »).

import { create } from 'zustand'
import type { ExecutionOutput } from '@shared/execution'
import type { HttpResult } from '@shared/http'
import {
  cloneDraft,
  draftLabel,
  duplicateName,
  emptyDraft,
  newId,
  normalizeDraft,
  sameDraft,
  type HistoryEntry,
  type PersistedSession,
  type PersistedTab,
  type RequestDraft,
  type SettingsSection,
  type TabSource,
  type TabView
} from '@shared/model'
import { buildExecutionInput, tabCollection } from './context'
import { useConsole, type NewConsoleEntry } from './console'
import { useEnvironments } from './environments'
import { useSettings } from './settings'
import { confirmDialog, saveDialog, toast } from './ui'
import { lookupItem, useWorkspace } from './workspace'

export interface Tab extends PersistedTab {
  sending: string | null
  result: HttpResult | null
  /** Résultat des scripts du dernier envoi. */
  outcome: Pick<ExecutionOutput, 'tests' | 'prerequestError' | 'testError' | 'skipped' | 'resolvedUrl'> | null
}

interface TabsState {
  tabs: Tab[]
  activeId: string | null
  closed: PersistedTab[]

  restore: (session: PersistedSession | null) => void
  openNew: (draft?: RequestDraft, title?: string) => string
  openItem: (collectionId: string, itemId: string, opts?: { preview?: boolean }) => void
  openHistory: (entry: HistoryEntry, opts?: { preview?: boolean }) => void
  openView: (view: TabView, opts?: { preview?: boolean }) => void
  openSettings: (section?: SettingsSection) => void
  activate: (id: string) => void
  activateRelative: (delta: number) => void
  activateIndex: (index: number) => void
  pin: (id: string) => void
  updateDraft: (id: string, fn: (d: RequestDraft) => RequestDraft) => void
  replaceDraft: (id: string, draft: RequestDraft) => void
  close: (id: string, opts?: { force?: boolean }) => Promise<boolean>
  closeOthers: (id: string) => Promise<void>
  closeAll: () => Promise<void>
  duplicate: (id: string) => void
  reopenClosed: () => void
  save: (id: string, opts?: { saveAs?: boolean }) => Promise<boolean>
  send: (id: string) => Promise<void>
  cancel: (id: string) => void
  syncWithWorkspace: () => void
}

const CLOSED_LIMIT = 20

export function isDirty(tab: PersistedTab): boolean {
  if (tab.view) return false
  return tab.saved ? !sameDraft(tab.draft, tab.saved) : !sameDraft(tab.draft, emptyDraft())
}

/** Titre affiché : nom courant de l'élément ouvert, sinon le titre mémorisé. */
export function tabTitle(tab: PersistedTab): string {
  const ws = useWorkspace.getState()
  if (tab.view) {
    switch (tab.view.kind) {
      case 'settings':
        return 'Paramètres'
      case 'globals':
        return 'Globales'
      case 'environment':
        return useEnvironments.getState().environments.find((e) => e.id === (tab.view as { environmentId: string }).environmentId)?.name ?? tab.title
      case 'collection':
        return ws.collections.find((c) => c.id === (tab.view as { collectionId: string }).collectionId)?.name ?? tab.title
      case 'folder': {
        const v = tab.view
        return lookupItem(ws.collections, v.collectionId, v.folderId)?.name ?? tab.title
      }
      case 'runner': {
        const v = tab.view
        const target = v.folderId ? lookupItem(ws.collections, v.collectionId, v.folderId)?.name : ws.collections.find((c) => c.id === v.collectionId)?.name
        return `Runner · ${target ?? tab.title}`
      }
    }
  }
  if (tab.source?.kind === 'collection') {
    const item = lookupItem(ws.collections, tab.source.collectionId, tab.source.itemId)
    if (item) return item.name
  }
  return tab.title
}

const sameSource = (a: TabSource, b: TabSource): boolean => {
  if (!a || !b || a.kind !== b.kind) return false
  if (a.kind === 'collection' && b.kind === 'collection') return a.collectionId === b.collectionId && a.itemId === b.itemId
  return a.kind === 'history' && b.kind === 'history' && a.historyId === b.historyId
}

const sameView = (a: TabView | undefined, b: TabView): boolean => {
  if (!a || a.kind !== b.kind) return false
  switch (b.kind) {
    case 'settings':
    case 'globals':
      return true
    case 'environment':
      return (a as typeof b).environmentId === b.environmentId
    case 'collection':
      return (a as typeof b).collectionId === b.collectionId
    case 'folder':
      return (a as typeof b).folderId === b.folderId
    case 'runner':
      return (a as typeof b).collectionId === b.collectionId && (a as typeof b).folderId === b.folderId
  }
}

const toPersisted = ({ id, title, source, draft, saved, preview, view }: Tab): PersistedTab => ({
  id,
  title,
  source,
  draft,
  saved,
  preview,
  ...(view ? { view } : {})
})
const fromPersisted = (t: PersistedTab): Tab => ({
  ...t,
  draft: normalizeDraft(t.draft),
  saved: t.saved ? normalizeDraft(t.saved) : null,
  sending: null,
  result: null,
  outcome: null
})

const blank = (): Omit<Tab, 'id' | 'title' | 'preview'> => ({
  source: null,
  draft: emptyDraft(),
  saved: null,
  sending: null,
  result: null,
  outcome: null
})

export const useTabs = create<TabsState>((set, get) => {
  function patchTab(id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)): void {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)) })
  }

  /** Algorithme de référence : focus si déjà ouvert, sinon réutilisation de l'aperçu, sinon nouvel onglet. */
  function openTab(matches: (t: Tab) => boolean, make: () => Omit<Tab, 'id' | 'preview'>, wantPreview: boolean): void {
    const preview = wantPreview && !useSettings.getState().settings.general.openInNewTab
    const existing = get().tabs.find(matches)
    if (existing) {
      set({ activeId: existing.id })
      if (!wantPreview && existing.preview) patchTab(existing.id, { preview: false })
      return
    }
    const previewTab = get().tabs.find((t) => t.preview)
    if (preview && previewTab && !isDirty(previewTab) && !previewTab.sending) {
      set({ tabs: get().tabs.map((t) => (t.id === previewTab.id ? { ...t, view: undefined, ...make(), preview: true } : t)), activeId: previewTab.id })
      return
    }
    const tab: Tab = { id: newId(), preview, ...make() }
    const tabs = get().tabs
    const activeIndex = tabs.findIndex((t) => t.id === get().activeId)
    const next = [...tabs]
    next.splice(activeIndex === -1 ? next.length : activeIndex + 1, 0, tab)
    set({ tabs: next, activeId: tab.id })
  }

  function removeTab(id: string): void {
    const tabs = get().tabs
    const index = tabs.findIndex((t) => t.id === id)
    const tab = tabs[index]
    if (!tab) return
    if (tab.sending) void window.endora.cancelHttp(tab.sending)
    const remaining = tabs.filter((t) => t.id !== id)
    let activeId = get().activeId
    if (activeId === id) activeId = (remaining[index] ?? remaining[index - 1])?.id ?? null
    set({ tabs: remaining, activeId, closed: [toPersisted(tab), ...get().closed].slice(0, CLOSED_LIMIT) })
  }

  return {
    tabs: [],
    activeId: null,
    closed: [],

    restore: (session) => {
      const tabs = (session?.tabs ?? []).map(fromPersisted)
      const activeId = tabs.some((t) => t.id === session?.activeTabId) ? session!.activeTabId : (tabs[0]?.id ?? null)
      set({ tabs, activeId })
      get().syncWithWorkspace()
      if (get().tabs.length === 0) get().openNew()
    },

    openNew: (draft, title) => {
      const tab: Tab = { ...blank(), id: newId(), title: title ?? 'Nouvelle requête', draft: draft ?? emptyDraft(), preview: false }
      set({ tabs: [...get().tabs, tab], activeId: tab.id })
      return tab.id
    },

    openItem: (collectionId, itemId, opts) => {
      const item = lookupItem(useWorkspace.getState().collections, collectionId, itemId)
      if (item?.type !== 'request') return
      const source: TabSource = { kind: 'collection', collectionId, itemId }
      openTab(
        (t) => sameSource(t.source, source),
        () => ({ ...blank(), title: item.name, source, draft: cloneDraft(item.request), saved: structuredClone(item.request) }),
        opts?.preview ?? true
      )
    },

    openHistory: (entry, opts) => {
      const source: TabSource = { kind: 'history', historyId: entry.id }
      openTab(
        (t) => sameSource(t.source, source),
        () => ({ ...blank(), title: draftLabel(entry.request), source, draft: cloneDraft(entry.request), saved: structuredClone(entry.request) }),
        opts?.preview ?? true
      )
    },

    openView: (view, opts) => {
      openTab(
        (t) => sameView(t.view, view),
        () => ({ ...blank(), title: '', view }),
        opts?.preview ?? false
      )
      // Les réglages s'ouvrent sur la section demandée.
      if (view.kind === 'settings' && view.section) {
        const tab = get().tabs.find((t) => t.view?.kind === 'settings')
        if (tab) patchTab(tab.id, { view })
      }
    },

    openSettings: (section) => get().openView({ kind: 'settings', ...(section ? { section } : {}) }),

    activate: (id) => set({ activeId: id }),

    activateRelative: (delta) => {
      const { tabs, activeId } = get()
      if (tabs.length === 0) return
      const i = tabs.findIndex((t) => t.id === activeId)
      set({ activeId: tabs[(i + delta + tabs.length) % tabs.length]!.id })
    },

    activateIndex: (index) => {
      const tabs = get().tabs
      const tab = index < 0 ? tabs[tabs.length - 1] : tabs[index]
      if (tab) set({ activeId: tab.id })
    },

    pin: (id) => patchTab(id, { preview: false }),

    updateDraft: (id, fn) => patchTab(id, (t) => ({ draft: fn(t.draft), preview: false })),

    replaceDraft: (id, draft) => patchTab(id, { draft, preview: false }),

    close: async (id, opts) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab) return true
      const confirm = useSettings.getState().settings.general.confirmCloseUnsaved
      if (!opts?.force && confirm && isDirty(tab)) {
        set({ activeId: id })
        const choice = await confirmDialog(
          'Modifications non enregistrées',
          `« ${tabTitle(tab)} » contient des modifications non enregistrées. Les enregistrer avant de fermer ?`,
          [
            { label: 'Annuler', value: 'cancel' },
            { label: 'Ne pas enregistrer', value: 'discard', variant: 'danger' },
            { label: 'Enregistrer', value: 'save', variant: 'primary' }
          ]
        )
        if (choice === 'cancel') return false
        if (choice === 'save' && !(await get().save(id))) return false
      }
      removeTab(id)
      return true
    },

    closeOthers: async (id) => {
      for (const t of get().tabs.filter((x) => x.id !== id)) {
        if (!(await get().close(t.id))) return
      }
      set({ activeId: id })
    },

    closeAll: async () => {
      for (const t of [...get().tabs]) {
        if (!(await get().close(t.id))) return
      }
    },

    duplicate: (id) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab || tab.view) return
      get().openNew(cloneDraft(tab.draft), duplicateName(get().tabs.map(tabTitle), tabTitle(tab)))
    },

    reopenClosed: () => {
      const [last, ...rest] = get().closed
      if (!last) return
      set({ closed: rest })
      const existing = get().tabs.find((t) => (last.view ? sameView(t.view, last.view) : last.source && sameSource(t.source, last.source)))
      if (existing) {
        set({ activeId: existing.id })
        return
      }
      const tab = fromPersisted({ ...last, id: newId(), preview: false })
      set({ tabs: [...get().tabs, tab], activeId: tab.id })
      get().syncWithWorkspace()
    },

    save: async (id, opts) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab || tab.view) return false
      const ws = useWorkspace.getState()
      if (!opts?.saveAs && tab.source?.kind === 'collection' && ws.updateRequest(tab.source.collectionId, tab.source.itemId, tab.draft)) {
        patchTab(id, { saved: structuredClone(tab.draft), preview: false })
        return true
      }
      const defaultName = tab.source?.kind === 'collection' ? (opts?.saveAs ? `${tabTitle(tab)} Copy` : tabTitle(tab)) : draftLabel(tab.draft)
      const target = await saveDialog(defaultName, opts?.saveAs ? 'Enregistrer sous' : 'Enregistrer la requête')
      if (!target) return false
      const current = get().tabs.find((t) => t.id === id)
      if (!current) return false
      const itemId = useWorkspace.getState().addRequest(target.collectionId, target.parentId, target.name, current.draft)
      if (!itemId) {
        toast("Emplacement d'enregistrement introuvable.", 'error')
        return false
      }
      patchTab(id, {
        source: { kind: 'collection', collectionId: target.collectionId, itemId },
        title: target.name,
        saved: structuredClone(current.draft),
        preview: false
      })
      return true
    },

    send: async (id) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (!tab || tab.sending || tab.view) return
      if (tab.draft.url.trim() === '') {
        toast("Saisissez une URL avant d'envoyer.", 'error')
        return
      }
      const requestId = newId()
      const historyId = newId()
      patchTab(id, { sending: requestId, preview: false })
      const collection = tabCollection(tab)
      const input = buildExecutionInput(tab, requestId, tabTitle(tab))
      useWorkspace.getState().addHistory({ id: historyId, createdAt: new Date().toISOString(), request: cloneDraft(tab.draft) })

      let output: ExecutionOutput
      try {
        output = await window.endora.execute(input)
      } catch (err) {
        output = {
          result: { ok: false, code: 'network', message: err instanceof Error ? err.message : String(err), timeMs: 0 },
          skipped: false,
          tests: [],
          logs: [],
          mutations: [],
          sentRequests: []
        }
      }
      const result = output.result
      useWorkspace
        .getState()
        .updateHistory(
          historyId,
          result?.ok ? { status: result.status, timeMs: result.timeMs } : { error: result ? result.message : (output.prerequestError?.message ?? 'Non envoyée'), timeMs: result?.timeMs }
        )

      // Variables modifiées par les scripts : environnement actif, globales, collection.
      useEnvironments.getState().applyMutations(output.mutations)
      if (collection) useWorkspace.getState().applyCollectionMutations(collection.id, output.mutations)
      else if (output.mutations.some((m) => m.scope === 'collectionVariables')) {
        toast('Variables de collection ignorées : la requête n’est pas enregistrée dans une collection.', 'error')
      }

      const consoleEntries: NewConsoleEntry[] = []
      for (const r of output.sentRequests) consoleEntries.push({ kind: 'request', method: r.method, url: r.url, status: r.status, error: r.error, fromScript: true })
      for (const l of output.logs) consoleEntries.push({ kind: 'log', level: l.level, message: l.message, source: l.source })
      if (output.prerequestError) consoleEntries.push({ kind: 'log', level: 'error', message: output.prerequestError.message, source: output.prerequestError.source })
      if (output.testError) consoleEntries.push({ kind: 'log', level: 'error', message: output.testError.message, source: output.testError.source })
      if (result) {
        consoleEntries.push(
          result.ok
            ? {
                kind: 'request',
                method: result.sent?.method ?? tab.draft.method,
                url: result.sent?.url ?? output.resolvedUrl ?? tab.draft.url,
                status: result.status,
                timeMs: result.timeMs,
                requestHeaders: result.sent?.headers,
                responseHeaders: result.headers
              }
            : { kind: 'request', method: tab.draft.method, url: output.resolvedUrl ?? tab.draft.url, error: result.message, timeMs: result.timeMs }
        )
      }
      useConsole.getState().add(consoleEntries)

      // Ignore une réponse arrivée après une annulation ou un nouvel envoi.
      if (get().tabs.find((t) => t.id === id)?.sending === requestId) {
        patchTab(id, {
          sending: null,
          result,
          outcome: {
            tests: output.tests,
            prerequestError: output.prerequestError,
            testError: output.testError,
            skipped: output.skipped,
            resolvedUrl: output.resolvedUrl
          }
        })
      }
    },

    cancel: (id) => {
      const tab = get().tabs.find((t) => t.id === id)
      if (tab?.sending) void window.endora.cancelHttp(tab.sending)
    },

    /** Détache les onglets dont l'élément a disparu ; ferme les vues d'éléments supprimés. */
    syncWithWorkspace: () => {
      const ws = useWorkspace.getState()
      const envs = useEnvironments.getState().environments
      let changed = false
      const tabs: Tab[] = []
      for (const t of get().tabs) {
        if (t.view) {
          const v = t.view
          const exists =
            v.kind === 'settings' ||
            v.kind === 'globals' ||
            (v.kind === 'environment' && envs.some((e) => e.id === v.environmentId)) ||
            (v.kind === 'collection' && ws.collections.some((c) => c.id === v.collectionId)) ||
            (v.kind === 'folder' && lookupItem(ws.collections, v.collectionId, v.folderId)?.type === 'folder') ||
            (v.kind === 'runner' &&
              ws.collections.some((c) => c.id === v.collectionId) &&
              (!v.folderId || lookupItem(ws.collections, v.collectionId, v.folderId)?.type === 'folder'))
          if (exists) tabs.push(t)
          else changed = true
          continue
        }
        if (t.source?.kind !== 'collection' || lookupItem(ws.collections, t.source.collectionId, t.source.itemId)?.type === 'request') {
          tabs.push(t)
          continue
        }
        changed = true
        tabs.push({ ...t, title: tabTitle(t), source: null, saved: null, preview: false })
      }
      if (!changed) return
      const activeId = tabs.some((t) => t.id === get().activeId) ? get().activeId : (tabs[tabs.length - 1]?.id ?? null)
      set({ tabs, activeId })
    }
  }
})

// Les onglets (avec leurs modifications non enregistrées) et l'environnement actif sont restaurés
// au prochain lancement.
let sessionTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSessionSave(): void {
  if (sessionTimer) clearTimeout(sessionTimer)
  sessionTimer = setTimeout(() => {
    const { tabs, activeId } = useTabs.getState()
    void window.endora.saveSession({
      tabs: tabs.map(toPersisted),
      activeTabId: activeId,
      activeEnvironmentId: useEnvironments.getState().activeId
    })
  }, 400)
}

export function startSessionPersistence(): void {
  useTabs.subscribe((state, prev) => {
    if (state.tabs !== prev.tabs || state.activeId !== prev.activeId) scheduleSessionSave()
  })
  useEnvironments.subscribe((state, prev) => {
    if (state.activeId !== prev.activeId) scheduleSessionSave()
  })
}
