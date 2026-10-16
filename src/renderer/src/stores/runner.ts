// Collection Runner côté interface : configuration par collection/dossier, exécutions et résultats.

import { create } from 'zustand'
import { newId } from '@shared/model'
import {
  DEFAULT_RUN_OPTIONS,
  planFor,
  reconcilePlan,
  runCollection,
  summarize,
  type RunOptions,
  type RunPlanItem,
  type RunRequestResult,
  type RunStatus,
  type RunSummary
} from '@shared/runner'
import { useConsole, type NewConsoleEntry } from './console'
import { useEnvironments } from './environments'
import { useSettings } from './settings'
import { toast } from './ui'
import { useWorkspace } from './workspace'

export interface RunnerConfig {
  plan: RunPlanItem[]
  options: RunOptions
  /** `undefined` = environnement actif au lancement ; `null` = aucun. */
  environmentId?: string | null
}

export interface RunRecord {
  id: string
  key: string
  title: string
  startedAt: number
  finishedAt?: number
  status: RunStatus
  iteration: number
  iterations: number
  environmentName?: string
  dataFile?: string
  results: RunRequestResult[]
  summary?: RunSummary
  message?: string
}

interface RunnerState {
  configs: Record<string, RunnerConfig>
  runs: RunRecord[]
  /** Exécution affichée par vue (sinon : configuration). */
  shown: Record<string, string | null>
  config: (collectionId: string, folderId?: string) => RunnerConfig
  update: (key: string, patch: Partial<RunnerConfig>) => void
  updateOptions: (key: string, patch: Partial<RunOptions>) => void
  start: (collectionId: string, folderId?: string) => Promise<void>
  stop: (runId: string) => void
  show: (key: string, runId: string | null) => void
}

export const runnerKey = (collectionId: string, folderId?: string): string => `${collectionId}:${folderId ?? ''}`
const RUNS_LIMIT = 20

/** Requêtes et attentes en cours, pour pouvoir interrompre une exécution. */
const control = new Map<string, { stop: boolean; requestId: string | null; wake: (() => void) | null }>()

export const useRunner = create<RunnerState>((set, get) => {
  const patchRun = (id: string, patch: Partial<RunRecord> | ((r: RunRecord) => Partial<RunRecord>)) =>
    set({ runs: get().runs.map((r) => (r.id === id ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)) })

  return {
    configs: {},
    runs: [],
    shown: {},

    config: (collectionId, folderId) => {
      const key = runnerKey(collectionId, folderId)
      const collection = useWorkspace.getState().collections.find((c) => c.id === collectionId)
      const current = collection ? planFor(collection, folderId ?? null) : []
      const saved = get().configs[key]
      return saved ? { ...saved, plan: reconcilePlan(saved.plan, current) } : { plan: current, options: { ...DEFAULT_RUN_OPTIONS } }
    },

    update: (key, patch) => {
      const [collectionId, folderId] = key.split(':')
      const base = get().configs[key] ?? get().config(collectionId!, folderId || undefined)
      set({ configs: { ...get().configs, [key]: { ...base, ...patch } } })
    },

    updateOptions: (key, patch) => {
      const [collectionId, folderId] = key.split(':')
      const base = get().configs[key] ?? get().config(collectionId!, folderId || undefined)
      set({ configs: { ...get().configs, [key]: { ...base, options: { ...base.options, ...patch } } } })
    },

    start: async (collectionId, folderId) => {
      const key = runnerKey(collectionId, folderId)
      const collection = useWorkspace.getState().collections.find((c) => c.id === collectionId)
      if (!collection) return
      const config = get().config(collectionId, folderId)
      if (!config.plan.some((p) => p.enabled)) {
        toast('Sélectionnez au moins une requête à exécuter.', 'error')
        return
      }
      const envs = useEnvironments.getState()
      const environmentId = config.environmentId === undefined ? envs.activeId : config.environmentId
      const env = envs.environments.find((e) => e.id === environmentId)
      const folderName = folderId ? config.plan[0]?.path.at(-1) : undefined
      const run: RunRecord = {
        id: newId(),
        key,
        title: folderName ? `${collection.name} › ${folderName}` : collection.name,
        startedAt: Date.now(),
        status: 'running',
        iteration: 0,
        iterations: config.options.iterations,
        environmentName: env?.name,
        dataFile: config.options.data?.fileName,
        results: []
      }
      const ctl = { stop: false, requestId: null as string | null, wake: null as (() => void) | null }
      control.set(run.id, ctl)
      set({ runs: [run, ...get().runs].slice(0, RUNS_LIMIT), shown: { ...get().shown, [key]: run.id } })

      const outcome = await runCollection(
        collection,
        config.plan,
        config.options,
        { environment: env?.values ?? [], environmentName: env?.name, globals: envs.globals, collection: collection.variables },
        {
          settings: useSettings.getState().settings.general,
          newId,
          stopped: () => ctl.stop,
          execute: async (input) => {
            ctl.requestId = input.requestId
            const out = await window.endora.execute(input)
            ctl.requestId = null
            const entries: NewConsoleEntry[] = out.logs.map((l) => ({ kind: 'log', level: l.level, message: l.message, source: `${input.name} · ${l.source}` }))
            const r = out.result
            if (r) {
              entries.push(
                r.ok
                  ? { kind: 'request', method: r.sent?.method ?? input.draft.method, url: r.sent?.url ?? out.resolvedUrl ?? '', status: r.status, timeMs: r.timeMs, requestHeaders: r.sent?.headers, responseHeaders: r.headers }
                  : { kind: 'request', method: input.draft.method, url: out.resolvedUrl ?? input.draft.url, error: r.message, timeMs: r.timeMs }
              )
            }
            useConsole.getState().add(entries)
            return out
          },
          sleep: (ms) =>
            new Promise<void>((resolve) => {
              const t = setTimeout(done, ms)
              function done() {
                clearTimeout(t)
                ctl.wake = null
                resolve()
              }
              ctl.wake = done
            }),
          onIteration: (index) => patchRun(run.id, { iteration: index }),
          onResult: (result) => patchRun(run.id, (r) => ({ results: [...r.results, result] })),
          onMutations: (mutations) => {
            useEnvironments.getState().applyMutations(mutations, environmentId ?? null)
            useWorkspace.getState().applyCollectionMutations(collectionId, mutations)
          }
        }
      )
      control.delete(run.id)
      const finishedAt = Date.now()
      patchRun(run.id, {
        status: outcome.status,
        finishedAt,
        message: outcome.message,
        summary: summarize(outcome.results, config.options.iterations, finishedAt - run.startedAt)
      })
      if (outcome.status === 'error' && outcome.message) toast(outcome.message, 'error')
    },

    stop: (runId) => {
      const ctl = control.get(runId)
      if (!ctl) return
      ctl.stop = true
      ctl.wake?.()
      if (ctl.requestId) void window.endora.cancelHttp(ctl.requestId)
    },

    show: (key, runId) => set({ shown: { ...get().shown, [key]: runId } })
  }
})

/** Résultats exportés : métadonnées, bilan et détail par requête (sans les corps de réponse). */
export async function exportRun(run: RunRecord): Promise<void> {
  const data = {
    name: run.title,
    startedAt: new Date(run.startedAt).toISOString(),
    finishedAt: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
    status: run.status,
    environment: run.environmentName ?? null,
    dataFile: run.dataFile ?? null,
    summary: run.summary ?? null,
    results: run.results.map(({ response: _r, ...rest }) => rest)
  }
  const safe = run.title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'run'
  const r = await window.endora.saveTextFile(`${safe}.run-results.json`, JSON.stringify(data, null, 2))
  if (r.ok) toast(`Résultats exportés : ${r.path}`)
  else if (!r.canceled) toast(`Export impossible : ${r.message}`, 'error')
}
