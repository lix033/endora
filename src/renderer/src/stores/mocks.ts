// Mock servers vus par l'interface : l'état fait foi dans le process principal, ce store le reflète
// (rechargé à chaque événement « changed », journal reçu en direct).

import { create } from 'zustand'
import type { MockActionResult, MockLogEntry, MockPatch, MockState, NewMockInput } from '@shared/mock'
import { t } from '@shared/i18n'
import { toast } from './ui'
import { saveCollectionNow } from './workspace'

interface MocksState {
  mocks: MockState[]
  loaded: boolean
  /** Journal par mock, chargé à l'ouverture du mock puis complété en direct. */
  logs: Record<string, MockLogEntry[]>

  refresh: () => Promise<void>
  create: (input: NewMockInput) => Promise<MockState | null>
  update: (id: string, patch: MockPatch) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
  start: (id: string) => Promise<void>
  stop: (id: string) => Promise<void>
  deploy: (id: string) => Promise<void>
  loadLogs: (id: string) => Promise<void>
  clearLogs: (id: string) => Promise<void>
  resetState: (id: string) => Promise<void>
}

const LOG_LIMIT = 200

export const useMocks = create<MocksState>((set, get) => {
  /** Applique le résultat d'une action : erreur affichée, sinon état rafraîchi. */
  async function apply(promise: Promise<MockActionResult>): Promise<MockState | null> {
    let r: MockActionResult
    try {
      r = await promise
    } catch (err) {
      // Exception côté process principal : signalée plutôt que de laisser l'action bloquée.
      r = { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
    if (!r.ok) {
      toast(r.message, 'error')
      return null
    }
    set({ mocks: get().mocks.some((m) => m.config.id === r.mock.config.id) ? get().mocks.map((m) => (m.config.id === r.mock.config.id ? r.mock : m)) : [...get().mocks, r.mock] })
    return r.mock
  }

  return {
    mocks: [],
    loaded: false,
    logs: {},

    refresh: async () => set({ mocks: await window.endora.mockList(), loaded: true }),

    create: async (input) => {
      // Le mock lit la collection enregistrée : on n'attend pas l'enregistrement différé.
      if (!(await saveCollectionNow(input.collectionId).catch(() => false))) return null
      return apply(window.endora.mockCreate(input))
    },

    update: async (id, patch) => (await apply(window.endora.mockUpdate(id, patch))) !== null,

    remove: async (id) => {
      const r = await window.endora.mockDelete(id)
      if (!r.ok) toast(r.message, 'error')
      else set({ mocks: get().mocks.filter((m) => m.config.id !== id) })
      return r.ok
    },

    start: async (id) => {
      await apply(window.endora.mockStart(id))
      void get().refresh()
    },

    stop: async (id) => {
      await apply(window.endora.mockStop(id))
    },

    deploy: async (id) => {
      const mock = get().mocks.find((m) => m.config.id === id)
      if (mock) await saveCollectionNow(mock.config.collectionId)
      if (await apply(window.endora.mockDeploy(id))) toast(t('mocks.deployed'))
    },

    loadLogs: async (id) => set({ logs: { ...get().logs, [id]: await window.endora.mockLogs(id) } }),

    clearLogs: async (id) => {
      await window.endora.mockClearLogs(id)
      set({ logs: { ...get().logs, [id]: [] } })
    },

    resetState: async (id) => {
      await window.endora.mockResetState(id)
      toast(t('mocks.stateReset'))
    }
  }
})

/** Suit les événements des mocks (à appeler une fois au démarrage). */
export function startMockEvents(): () => void {
  void useMocks.getState().refresh()
  return window.endora.onMockEvent((event) => {
    if (event.type === 'changed') {
      void useMocks.getState().refresh()
      return
    }
    const { logs } = useMocks.getState()
    const current = logs[event.entry.mockId]
    if (!current) return
    useMocks.setState({ logs: { ...logs, [event.entry.mockId]: [event.entry, ...current].slice(0, LOG_LIMIT) } })
  })
}
