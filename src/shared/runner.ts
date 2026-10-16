// Collection Runner : plan d'exécution, fichiers de données, boucle d'itérations et bilan.
//
// Comportements de référence :
// - observé : options Itérations, Délai (ms), Données (fichier CSV ou JSON), « conserver les valeurs
//   des variables », « enregistrer les réponses » ; `pm.execution.setNextRequest(nom|id)` choisit la
//   requête suivante, désactivé hors Runner ; `pm.iterationData` expose la ligne de l'itération ;
// - inféré : `setNextRequest(null)` ou une cible introuvable termine l'itération en cours ; au-delà
//   du nombre de lignes du fichier, la dernière ligne est réutilisée.
//
// Module pur : l'exécution réelle (process principal) est injectée, ce qui le rend testable.

import type { ExecutionInput, ExecutionOutput, ParentContext } from './execution'
import { t } from './i18n'
import { findItem, folderPath, type Collection, type RequestItem, type TreeItem } from './model'
import type { TestResult, VariableMutation } from './scripting/types'
import type { Settings } from './settings'
import { mutateVariables, type Variable } from './variables'

export interface RunPlanItem {
  itemId: string
  name: string
  method: string
  /** Dossiers parents, du plus externe au plus proche. */
  path: string[]
  enabled: boolean
}

export type DataRow = Record<string, string>

export interface RunOptions {
  iterations: number
  delayMs: number
  data: { fileName: string; rows: DataRow[] } | null
  /** Les modifications de variables faites par les scripts sont enregistrées. */
  persistVariables: boolean
  /** Les corps de réponse sont conservés dans les résultats. */
  saveResponses: boolean
  /** Arrête l'exécution à la première erreur réseau ou de script (les tests échoués n'arrêtent pas). */
  stopOnError: boolean
}

export const DEFAULT_RUN_OPTIONS: RunOptions = {
  iterations: 1,
  delayMs: 0,
  data: null,
  persistVariables: true,
  saveResponses: false,
  stopOnError: false
}

export interface RunVariables {
  environment: Variable[]
  environmentName?: string
  globals: Variable[]
  collection: Variable[]
}

export interface RunRequestResult {
  id: string
  iteration: number
  itemId: string
  name: string
  method: string
  url: string
  status?: number
  statusText?: string
  timeMs?: number
  sizeBytes?: number
  error?: string
  skipped?: boolean
  tests: TestResult[]
  scriptError?: { message: string; source: string; phase: 'prerequest' | 'test' }
  response?: { headers: Array<[string, string]>; bodyBase64: string; contentType: string | null }
}

export type RunStatus = 'running' | 'done' | 'stopped' | 'error'

export interface RunSummary {
  iterations: number
  requests: number
  testsPassed: number
  testsFailed: number
  testsSkipped: number
  errors: number
  avgResponseMs: number
  totalMs: number
}

export interface RunDeps {
  execute(input: ExecutionInput): Promise<ExecutionOutput>
  settings: Settings['general']
  sleep(ms: number): Promise<void>
  stopped(): boolean
  newId(): string
  onResult(result: RunRequestResult): void
  /** Appelé après chaque requête, avec les modifications de variables à persister (si demandé). */
  onMutations(mutations: VariableMutation[]): void
  onIteration?(index: number): void
}

const MAX_STEPS_PER_ITERATION = 10_000

// --- Plan ----------------------------------------------------------------------------------------

/** Requêtes d'une collection ou d'un dossier, dans l'ordre de l'arbre. */
export function planFor(collection: Collection, folderId: string | null = null): RunPlanItem[] {
  const root = folderId ? findItem(collection.items, folderId) : null
  const items = root?.type === 'folder' ? root.items : collection.items
  const base = root?.type === 'folder' ? [...(folderPath(collection.items, root.id) ?? []).map((f) => f.name), root.name] : []
  const out: RunPlanItem[] = []
  const walk = (list: TreeItem[], path: string[]) => {
    for (const it of list) {
      if (it.type === 'request') out.push({ itemId: it.id, name: it.name, method: it.request.method, path, enabled: true })
      else walk(it.items, [...path, it.name])
    }
  }
  walk(items, base)
  return out
}

/**
 * Remet un ordre sauvegardé en phase avec la collection : les requêtes supprimées disparaissent, les
 * nouvelles s'ajoutent à la fin (activées), les noms et méthodes sont mis à jour.
 */
export function reconcilePlan(saved: RunPlanItem[], current: RunPlanItem[]): RunPlanItem[] {
  const byId = new Map(current.map((p) => [p.itemId, p]))
  const kept = saved.filter((p) => byId.has(p.itemId)).map((p) => ({ ...byId.get(p.itemId)!, enabled: p.enabled }))
  const seen = new Set(kept.map((p) => p.itemId))
  return [...kept, ...current.filter((p) => !seen.has(p.itemId))]
}

/** Parents d'un élément (du plus proche à la collection), pour l'auth et les scripts hérités. */
export function parentContexts(collection: Collection, itemId: string): ParentContext[] {
  const folders = folderPath(collection.items, itemId) ?? []
  return [
    ...[...folders].reverse().map((f) => ({ kind: 'folder' as const, name: f.name, auth: f.auth, scripts: f.scripts })),
    { kind: 'collection' as const, name: collection.name, auth: collection.auth, scripts: collection.scripts }
  ]
}

// --- Fichiers de données -------------------------------------------------------------------------

export type DataParseResult = { ok: true; rows: DataRow[]; format: 'csv' | 'json' } | { ok: false; message: string }

/** CSV conforme RFC 4180 : guillemets, guillemets doublés, retours à la ligne dans les champs. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

const asText = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/** Lit un fichier de données : tableau JSON d'objets, ou CSV avec une ligne d'en-tête. */
export function parseDataFile(fileName: string, text: string): DataParseResult {
  const trimmed = text.replace(/^﻿/, '').trim()
  if (trimmed === '') return { ok: false, message: t('run.dataEmpty') }
  const looksJson = /\.json$/i.test(fileName) || trimmed.startsWith('[') || trimmed.startsWith('{')
  if (looksJson) {
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch (err) {
      return { ok: false, message: t('run.dataJsonInvalid', { message: (err as Error).message }) }
    }
    if (!Array.isArray(parsed) || !parsed.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r))) {
      return { ok: false, message: t('run.dataJsonShape') }
    }
    return {
      ok: true,
      format: 'json',
      rows: (parsed as Array<Record<string, unknown>>).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, asText(v)])))
    }
  }
  const table = parseCsv(trimmed)
  const [header, ...lines] = table
  if (!header || header.every((h) => h.trim() === '')) return { ok: false, message: t('run.dataCsvHeader') }
  const keys = header.map((h) => h.trim())
  return { ok: true, format: 'csv', rows: lines.map((cells) => Object.fromEntries(keys.map((k, i) => [k, cells[i] ?? '']))) }
}

// --- Exécution -----------------------------------------------------------------------------------

/** Cible de `setNextRequest` : identifiant d'abord, puis nom, parmi les requêtes sélectionnées. */
export function resolveNextRequest(plan: RunPlanItem[], target: string): number {
  const byId = plan.findIndex((p) => p.itemId === target)
  return byId !== -1 ? byId : plan.findIndex((p) => p.name === target)
}

export function summarize(results: RunRequestResult[], iterations: number, totalMs: number): RunSummary {
  const tests = results.flatMap((r) => r.tests)
  const timed = results.filter((r) => r.timeMs !== undefined && r.status !== undefined)
  return {
    iterations,
    requests: results.length,
    testsPassed: tests.filter((t) => t.passed && !t.skipped).length,
    testsFailed: tests.filter((t) => !t.passed).length,
    testsSkipped: tests.filter((t) => t.skipped).length,
    errors: results.filter((r) => r.error || r.scriptError).length,
    avgResponseMs: timed.length ? Math.round(timed.reduce((n, r) => n + (r.timeMs ?? 0), 0) / timed.length) : 0,
    totalMs
  }
}

export interface RunOutcome {
  status: Exclude<RunStatus, 'running'>
  results: RunRequestResult[]
  variables: RunVariables
  message?: string
}

export async function runCollection(
  collection: Collection,
  plan: RunPlanItem[],
  options: RunOptions,
  initial: RunVariables,
  deps: RunDeps
): Promise<RunOutcome> {
  const order = plan.filter((p) => p.enabled)
  const results: RunRequestResult[] = []
  let vars: RunVariables = { ...initial }
  const rows = options.data?.rows ?? []
  const iterations = Math.max(1, Math.floor(options.iterations))
  if (order.length === 0) return { status: 'error', results, variables: vars, message: t('run.noneSelected') }

  for (let iteration = 0; iteration < iterations; iteration++) {
    deps.onIteration?.(iteration)
    const data = rows.length > 0 ? rows[Math.min(iteration, rows.length - 1)] : undefined
    let index = 0
    let steps = 0
    while (index < order.length) {
      if (deps.stopped()) return { status: 'stopped', results, variables: vars }
      if (++steps > MAX_STEPS_PER_ITERATION) {
        return { status: 'error', results, variables: vars, message: t('run.loop', { max: MAX_STEPS_PER_ITERATION }) }
      }
      const planItem = order[index]!
      const found = findItem(collection.items, planItem.itemId)
      if (found?.type !== 'request') {
        index++
        continue
      }
      const item: RequestItem = found
      const input: ExecutionInput = {
        requestId: deps.newId(),
        name: item.name,
        itemId: item.id,
        draft: item.request,
        chain: parentContexts(collection, item.id),
        variables: { environment: vars.environment, environmentName: vars.environmentName, globals: vars.globals, collection: vars.collection, ...(data ? { data } : {}) },
        settings: deps.settings,
        iteration: { index: iteration, count: iterations, location: [...planItem.path, item.name] }
      }
      const out = await deps.execute(input)

      // Les scripts suivants voient les variables modifiées, qu'elles soient persistées ou non.
      vars = {
        ...vars,
        environment: mutateVariables(vars.environment, out.mutations.filter((m) => m.scope === 'environment')),
        globals: mutateVariables(vars.globals, out.mutations.filter((m) => m.scope === 'globals')),
        collection: mutateVariables(vars.collection, out.mutations.filter((m) => m.scope === 'collectionVariables'))
      }
      if (options.persistVariables && out.mutations.length > 0) deps.onMutations(out.mutations)

      const r = out.result
      const result: RunRequestResult = {
        id: deps.newId(),
        iteration,
        itemId: item.id,
        name: item.name,
        method: item.request.method,
        url: out.resolvedUrl ?? item.request.url,
        tests: out.tests,
        ...(out.skipped ? { skipped: true } : {}),
        ...(out.prerequestError ? { scriptError: { ...out.prerequestError, phase: 'prerequest' as const } } : {}),
        ...(out.testError ? { scriptError: { ...out.testError, phase: 'test' as const } } : {})
      }
      if (r?.ok) {
        Object.assign(result, { status: r.status, statusText: r.statusText, timeMs: r.timeMs, sizeBytes: r.sizeBytes })
        if (options.saveResponses) result.response = { headers: r.headers, bodyBase64: r.bodyBase64, contentType: r.contentType }
      } else if (r) {
        Object.assign(result, { error: r.message, timeMs: r.timeMs })
      }
      results.push(result)
      deps.onResult(result)

      if (r && !r.ok && r.code === 'aborted') return { status: 'stopped', results, variables: vars }
      if (options.stopOnError && (result.error || result.scriptError)) {
        return { status: 'error', results, variables: vars, message: t('run.stoppedOnError', { message: result.error ?? result.scriptError!.message }) }
      }

      if (out.nextRequest === null) break
      if (out.nextRequest !== undefined) {
        const next = resolveNextRequest(order, out.nextRequest)
        if (next === -1) break
        index = next
      } else {
        index++
      }
      const isLast = index >= order.length && iteration === iterations - 1
      if (options.delayMs > 0 && !isLast) await deps.sleep(options.delayMs)
    }
  }
  return { status: 'done', results, variables: vars }
}
