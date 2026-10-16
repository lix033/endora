// Contrat d'exécution des scripts entre le process principal et le sandbox.

export type ScriptEvent = 'prerequest' | 'test'

export interface ScriptKeyValue {
  key: string
  value: string
  disabled?: boolean
  type?: 'text' | 'file'
}

export interface ScriptRequest {
  id?: string
  name?: string
  method: string
  url: string
  headers: ScriptKeyValue[]
  body:
    | { mode: 'none' }
    | { mode: 'raw'; raw: string; language?: string }
    | { mode: 'urlencoded'; urlencoded: ScriptKeyValue[] }
    | { mode: 'formdata'; formdata: ScriptKeyValue[] }
}

export interface ScriptResponse {
  code: number
  status: string
  headers: Array<{ key: string; value: string }>
  bodyBase64: string
  responseTime: number
  responseSize: number
}

export type VariableScopeName = 'environment' | 'globals' | 'collectionVariables' | 'local' | 'data'

export interface ScriptVariable {
  key: string
  value: string
}

export interface ScriptVariables {
  environment: ScriptVariable[]
  environmentName?: string
  globals: ScriptVariable[]
  collectionVariables: ScriptVariable[]
  local: ScriptVariable[]
  data: ScriptVariable[]
}

/** Modification de variable demandée par un script, rejouée ensuite sur les données persistées. */
export type VariableMutation =
  | { scope: Exclude<VariableScopeName, 'data'>; op: 'set'; key: string; value: string }
  | { scope: Exclude<VariableScopeName, 'data'>; op: 'unset'; key: string }
  | { scope: Exclude<VariableScopeName, 'data'>; op: 'clear' }

export interface ScriptSource {
  code: string
  /** Origine affichée en cas d'erreur (« Collection X », « Dossier Y », « Requête »). */
  source: string
}

export interface ScriptExecution {
  /** Langue des messages (le sandbox a son propre contexte JavaScript). */
  locale?: 'en' | 'fr'
  id: string
  event: ScriptEvent
  scripts: ScriptSource[]
  request: ScriptRequest
  response?: ScriptResponse
  variables: ScriptVariables
  info: { requestName: string; requestId: string; iteration: number; iterationCount: number; location?: string[] }
}

export interface TestResult {
  name: string
  passed: boolean
  skipped?: boolean
  error?: string
}

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

export interface ScriptLog {
  level: LogLevel
  message: string
  source: string
}

export interface ScriptOutcome {
  ok: boolean
  /** Erreur qui a interrompu un script (les scripts suivants ne sont pas exécutés). */
  error?: { message: string; source: string }
  request: ScriptRequest
  mutations: VariableMutation[]
  tests: TestResult[]
  logs: ScriptLog[]
  skipRequest: boolean
  /**
   * Prochaine requête demandée par `pm.execution.setNextRequest` (nom ou identifiant) ; `null` arrête
   * l'itération ; absent si non appelé. Utilisé uniquement par le Collection Runner.
   */
  nextRequest?: string | null
  /** Requêtes envoyées par pm.sendRequest, pour la console. */
  sentRequests: Array<{ method: string; url: string; status?: number; error?: string }>
}

/** Requête lancée par pm.sendRequest, exécutée par le process principal. */
export interface SandboxHttpRequest {
  method: string
  url: string
  headers: ScriptKeyValue[]
  body?: ScriptRequest['body']
}

export type SandboxHttpResult = { ok: true; response: ScriptResponse } | { ok: false; error: string }
