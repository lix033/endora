// Contrat IPC entre le renderer et le process principal, exposé sous `window.endora`.

import type { AuthConfig } from './auth'
import type { ExecutionInput, ExecutionOutput } from './execution'
import type { HttpRequestSpec, HttpResult } from './http'
import type { Environment, HistoryEntry, PersistedSession } from './model'
import type { Settings } from './settings'
import type { ShortcutAction } from './shortcuts'
import type { Variable } from './variables'

/** Contenu brut du stockage local ; les collections sont au format v2.1 et converties côté renderer. */
export interface WorkspaceSnapshot {
  collections: unknown[]
  history: HistoryEntry[]
  session: PersistedSession | null
  environments: Environment[]
  globals: Variable[]
  settings: Settings
  /** Fichiers illisibles ignorés au chargement (ils restent sur disque). */
  warnings: string[]
}

export type StorageResult = { ok: true } | { ok: false; message: string }

export type OpenTextResult =
  | { ok: true; files: Array<{ name: string; text: string }> }
  | { ok: false; canceled: true }
  | { ok: false; canceled: false; message: string }

export type SaveTextResult = { ok: true; path: string } | { ok: false; canceled: true } | { ok: false; canceled: false; message: string }

/** Résultat de conversion cURL : une requête au format v2.1, convertie ensuite par le renderer. */
export type CurlParseResult = { ok: true; request: unknown; name: string } | { ok: false; message: string }

export type MenuAction = ShortcutAction

/** Options d'import des spécifications d'API (OpenAPI, Swagger). */
export interface ImportOptions {
  /** Organisation des requêtes en dossiers : par chemin ou par tag. */
  folderStrategy: 'Paths' | 'Tags'
  /** Valeurs générées pour les paramètres et bodies : depuis le schéma ou depuis les exemples. */
  parametersResolution: 'Schema' | 'Example'
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = { folderStrategy: 'Paths', parametersResolution: 'Schema' }

export type ImportFormat =
  | 'curl'
  | 'collection-v1'
  | 'collection-v2'
  | 'environment'
  | 'globals'
  | 'dump'
  | 'openapi3'
  | 'openapi31'
  | 'swagger2'
  | 'swagger1'
  | 'raml08'
  | 'raml10'
  | 'graphql'
  | 'har'
  | 'wsdl1'
  | 'wsdl2'
  | 'wadl'

/** Résultat d'une conversion d'import : collections au format v2.1, environnements, requêtes isolées. */
export type ImportConversion =
  | {
      ok: true
      format: ImportFormat
      formatLabel: string
      collections: unknown[]
      environments: unknown[]
      globals: unknown[]
      requests: Array<{ name: string; request: unknown }>
    }
  | { ok: false; message: string }

export interface CodegenLanguage {
  key: string
  label: string
  syntax: string
  variants: string[]
}

export interface CodegenOption {
  id: string
  name: string
  type: 'boolean' | 'positiveInteger' | 'enum' | 'string'
  default: unknown
  availableOptions?: unknown[]
  description: string
}

export type CodegenResult = { ok: true; snippet: string } | { ok: false; message: string }

export type OAuth2TokenResult =
  | { ok: true; accessToken: string; tokenType?: string; refreshToken?: string; expiresIn?: number; scope?: string }
  | { ok: false; message: string }

export type UpdateCheckResult =
  | { ok: true; current: string; latest: string; updateAvailable: boolean; url?: string; notes?: string; publishedAt?: string }
  | { ok: false; message: string; notConfigured?: boolean }

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  /** Les secrets sont chiffrés par le trousseau du système. */
  secretsEncrypted: boolean
}

export interface EndoraApi {
  sendHttp(requestId: string, spec: HttpRequestSpec): Promise<HttpResult>
  cancelHttp(requestId: string): Promise<void>
  /** Exécution complète : scripts, variables, auth, envoi. */
  execute(input: ExecutionInput): Promise<ExecutionOutput>

  loadWorkspace(): Promise<WorkspaceSnapshot>
  saveCollection(id: string, collection: unknown): Promise<StorageResult>
  deleteCollection(id: string): Promise<StorageResult>
  saveHistory(entries: HistoryEntry[]): Promise<StorageResult>
  saveSession(session: PersistedSession): Promise<StorageResult>
  saveEnvironment(env: Environment): Promise<StorageResult>
  deleteEnvironment(id: string): Promise<StorageResult>
  saveGlobals(values: Variable[]): Promise<StorageResult>
  saveSettings(settings: Settings): Promise<StorageResult>

  openTextFiles(): Promise<OpenTextResult>
  saveTextFile(defaultName: string, text: string): Promise<SaveTextResult>
  pickFile(): Promise<string | null>
  writeClipboard(text: string): Promise<void>
  parseCurl(text: string): Promise<CurlParseResult>
  getOAuth2Token(auth: AuthConfig): Promise<OAuth2TokenResult>
  convertImport(name: string, text: string, options: ImportOptions): Promise<ImportConversion>
  fetchImport(url: string, options: ImportOptions): Promise<ImportConversion>
  codegenLanguages(): Promise<CodegenLanguage[]>
  codegenOptions(language: string, variant: string): Promise<CodegenOption[]>
  generateCode(input: ExecutionInput, language: string, variant: string, options: Record<string, unknown>, resolveVariables: boolean): Promise<CodegenResult>
  checkForUpdates(source: string): Promise<UpdateCheckResult>
  openExternal(url: string): Promise<void>
  appInfo(): Promise<AppInfo>

  onMenuAction(listener: (action: MenuAction) => void): () => void
}

export const IPC = {
  httpSend: 'http:send',
  httpCancel: 'http:cancel',
  workspaceLoad: 'workspace:load',
  collectionSave: 'collection:save',
  collectionDelete: 'collection:delete',
  historySave: 'history:save',
  sessionSave: 'session:save',
  fileOpenText: 'file:open-text',
  fileSaveText: 'file:save-text',
  filePick: 'file:pick',
  clipboardWrite: 'clipboard:write',
  curlParse: 'curl:parse',
  menuAction: 'menu:action',
  execute: 'request:execute',
  environmentSave: 'environment:save',
  environmentDelete: 'environment:delete',
  globalsSave: 'globals:save',
  settingsSave: 'settings:save',
  oauth2Token: 'oauth2:token',
  updatesCheck: 'updates:check',
  openExternal: 'shell:open-external',
  appInfo: 'app:info',
  importConvert: 'import:convert',
  importFetch: 'import:fetch',
  codegenLanguages: 'codegen:languages',
  codegenOptions: 'codegen:options',
  codegenGenerate: 'codegen:generate'
} as const
