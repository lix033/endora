// Contrat d'exécution complète d'une requête (scripts, variables, auth, envoi).

import type { AuthConfig } from './auth'
import type { HttpResult } from './http'
import type { RequestDraft, Scripts } from './model'
import type { ScriptLog, TestResult, VariableMutation } from './scripting/types'
import type { Settings } from './settings'
import type { Variable } from './variables'

/** Dossier ou collection parent, du plus proche au plus éloigné. */
export interface ParentContext {
  kind: 'folder' | 'collection'
  name: string
  auth: AuthConfig | null
  scripts: Scripts
}

export interface ExecutionInput {
  requestId: string
  name: string
  itemId?: string
  draft: RequestDraft
  chain: ParentContext[]
  variables: {
    environment: Variable[]
    environmentName?: string
    globals: Variable[]
    collection: Variable[]
    /** Ligne du fichier de données de l'itération (Collection Runner). */
    data?: Record<string, string>
  }
  settings: Settings['general']
  /** Itération courante (Collection Runner) ; absent pour un envoi simple. */
  iteration?: { index: number; count: number; location: string[] }
}

export interface ExecutionOutput {
  /** `null` si l'envoi n'a pas eu lieu (erreur de script pre-request ou `skipRequest`). */
  result: HttpResult | null
  prerequestError?: { message: string; source: string }
  testError?: { message: string; source: string }
  skipped: boolean
  tests: TestResult[]
  logs: ScriptLog[]
  mutations: VariableMutation[]
  sentRequests: Array<{ method: string; url: string; status?: number; error?: string }>
  /** URL après résolution des variables, telle qu'envoyée. */
  resolvedUrl?: string
  /** Demandé par `pm.execution.setNextRequest` (voir ScriptOutcome.nextRequest). */
  nextRequest?: string | null
}
