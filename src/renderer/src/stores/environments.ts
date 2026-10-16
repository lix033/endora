// Environnements de travail et variables globales.

import { create } from 'zustand'
import { duplicateName, newId, type Environment } from '@shared/model'
import type { VariableMutation } from '@shared/scripting/types'
import { mutateVariables, type Variable } from '@shared/variables'

export { mutateVariables }
import { toast } from './ui'

interface EnvironmentsState {
  environments: Environment[]
  globals: Variable[]
  activeId: string | null

  init: (environments: Environment[], globals: Variable[], activeId: string | null) => void
  setActive: (id: string | null) => void
  create: (name?: string, values?: Variable[]) => Environment
  rename: (id: string, name: string) => void
  duplicate: (id: string) => void
  remove: (id: string) => void
  setValues: (id: string, values: Variable[]) => void
  setGlobals: (values: Variable[]) => void
  /** Rejoue les modifications faites par les scripts (environnement actif, ou celui indiqué, et globales). */
  applyMutations: (mutations: VariableMutation[], environmentId?: string | null) => void
}

const envTimers = new Map<string, ReturnType<typeof setTimeout>>()
let globalsTimer: ReturnType<typeof setTimeout> | null = null

function persistEnvironment(id: string): void {
  const prev = envTimers.get(id)
  if (prev) clearTimeout(prev)
  envTimers.set(
    id,
    setTimeout(() => {
      envTimers.delete(id)
      const env = useEnvironments.getState().environments.find((e) => e.id === id)
      const op = env ? window.endora.saveEnvironment(env) : window.endora.deleteEnvironment(id)
      void op.then((r) => {
        if (!r.ok) toast(`Environnement non enregistré : ${r.message}`, 'error')
      })
    }, 300)
  )
}

function persistGlobals(): void {
  if (globalsTimer) clearTimeout(globalsTimer)
  globalsTimer = setTimeout(() => {
    void window.endora.saveGlobals(useEnvironments.getState().globals).then((r) => {
      if (!r.ok) toast(`Globales non enregistrées : ${r.message}`, 'error')
    })
  }, 300)
}

export const useEnvironments = create<EnvironmentsState>((set, get) => ({
  environments: [],
  globals: [],
  activeId: null,

  init: (environments, globals, activeId) =>
    set({
      environments: [...environments].sort((a, b) => a.name.localeCompare(b.name)),
      globals,
      activeId: environments.some((e) => e.id === activeId) ? activeId : null
    }),

  setActive: (activeId) => set({ activeId }),

  create: (name = 'Nouvel environnement', values = []) => {
    const env: Environment = { id: newId(), name, values }
    set({ environments: [...get().environments, env] })
    persistEnvironment(env.id)
    return env
  },

  rename: (id, name) => {
    if (name.trim() === '') return
    set({ environments: get().environments.map((e) => (e.id === id ? { ...e, name: name.trim() } : e)) })
    persistEnvironment(id)
  },

  duplicate: (id) => {
    const src = get().environments.find((e) => e.id === id)
    if (!src) return
    get().create(
      duplicateName(
        get().environments.map((e) => e.name),
        src.name
      ),
      src.values.map((v) => ({ ...v, id: newId() }))
    )
  },

  remove: (id) => {
    set({ environments: get().environments.filter((e) => e.id !== id), activeId: get().activeId === id ? null : get().activeId })
    persistEnvironment(id)
  },

  setValues: (id, values) => {
    set({ environments: get().environments.map((e) => (e.id === id ? { ...e, values } : e)) })
    persistEnvironment(id)
  },

  setGlobals: (globals) => {
    set({ globals })
    persistGlobals()
  },

  applyMutations: (mutations, environmentId) => {
    const envMutations = mutations.filter((m) => m.scope === 'environment')
    const globalMutations = mutations.filter((m) => m.scope === 'globals')
    const active = environmentId === undefined ? get().activeId : environmentId
    if (envMutations.length > 0 && active) {
      const env = get().environments.find((e) => e.id === active)
      if (env) get().setValues(active, mutateVariables(env.values, envMutations))
    } else if (envMutations.length > 0) {
      toast('Un script a modifié l’environnement, mais aucun environnement n’est actif.', 'error')
    }
    if (globalMutations.length > 0) get().setGlobals(mutateVariables(get().globals, globalMutations))
  }
}))
