// Console : requêtes envoyées, journaux des scripts et erreurs.

import { create } from 'zustand'
import { newId } from '@shared/model'
import type { LogLevel } from '@shared/scripting/types'

export type ConsoleEntry =
  | {
      id: string
      at: number
      kind: 'request'
      method: string
      url: string
      status?: number
      timeMs?: number
      error?: string
      requestHeaders?: Array<[string, string]>
      responseHeaders?: Array<[string, string]>
      fromScript?: boolean
    }
  | { id: string; at: number; kind: 'log'; level: LogLevel | 'error'; message: string; source?: string }

/** Entrée à ajouter (sans identifiant ni horodatage), distribuée sur chaque variante. */
export type NewConsoleEntry = ConsoleEntry extends infer E ? (E extends ConsoleEntry ? Omit<E, 'id' | 'at'> : never) : never

const LIMIT = 1000

interface ConsoleState {
  open: boolean
  entries: ConsoleEntry[]
  toggle: () => void
  setOpen: (open: boolean) => void
  add: (entries: NewConsoleEntry[]) => void
  clear: () => void
}

export const useConsole = create<ConsoleState>((set, get) => ({
  open: false,
  entries: [],
  toggle: () => set({ open: !get().open }),
  setOpen: (open) => set({ open }),
  add: (entries) => {
    const now = Date.now()
    const added = entries.map((e) => ({ ...e, id: newId(), at: now }) as ConsoleEntry)
    set({ entries: [...get().entries, ...added].slice(-LIMIT) })
  },
  clear: () => set({ entries: [] })
}))
