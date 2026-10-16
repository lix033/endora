// Exécution des scripts utilisateur dans une fenêtre cachée isolée (même principe que la page
// sandbox du client de référence) :
// - renderer Chromium sandboxé, sans Node, isolation de contexte, session dédiée ;
// - aucun accès réseau : CSP `connect-src 'none'` et requêtes bloquées au niveau de la session
//   (le réseau de `pm.sendRequest` passe par le process principal) ;
// - chaque exécution dans un iframe neuf (globales propres) ;
// - délai dépassé (boucle infinie…) : la fenêtre est détruite puis recréée à la demande.

import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, session, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import type { MockScriptInput, MockScriptOutput } from '@shared/scripting/mock-runtime'
import type { SandboxHttpRequest, SandboxHttpResult, ScriptExecution, ScriptOutcome } from '@shared/scripting/types'
import { getLocale, t } from '@shared/i18n'

export const SANDBOX_IPC = {
  run: 'sandbox:run',
  done: 'sandbox:done',
  http: 'sandbox:http',
  ready: 'sandbox:ready',
  mockRun: 'sandbox:mock-run',
  mockDone: 'sandbox:mock-done'
} as const

interface PendingMock {
  resolve: (o: MockScriptOutput) => void
  input: MockScriptInput
  timer: ReturnType<typeof setTimeout>
}

const mockFailure = (input: MockScriptInput, error: string): MockScriptOutput => ({ ok: false, error, response: input.response, state: input.state, logs: [] })

interface Pending {
  resolve: (o: ScriptOutcome) => void
  sendRequest: (req: SandboxHttpRequest) => Promise<SandboxHttpResult>
  timer: ReturnType<typeof setTimeout>
}

function failure(exec: ScriptExecution, message: string): ScriptOutcome {
  return {
    ok: false,
    error: { message, source: exec.scripts[0]?.source ?? 'Script' },
    request: exec.request,
    mutations: [],
    tests: [],
    logs: [],
    skipRequest: false,
    sentRequests: []
  }
}

export class ScriptSandbox {
  private win: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private markReady: (() => void) | null = null
  private readonly pending = new Map<string, Pending>()
  private readonly pendingMock = new Map<string, PendingMock>()

  constructor() {
    ipcMain.on(SANDBOX_IPC.ready, (event) => {
      if (this.isSandbox(event)) this.markReady?.()
    })
    ipcMain.on(SANDBOX_IPC.done, (event: IpcMainEvent, id: string, outcome: ScriptOutcome) => {
      if (!this.isSandbox(event)) return
      const p = this.pending.get(id)
      if (!p) return
      clearTimeout(p.timer)
      this.pending.delete(id)
      p.resolve(outcome)
    })
    ipcMain.on(SANDBOX_IPC.mockDone, (event: IpcMainEvent, id: string, output: MockScriptOutput) => {
      if (!this.isSandbox(event)) return
      const p = this.pendingMock.get(id)
      if (!p) return
      clearTimeout(p.timer)
      this.pendingMock.delete(id)
      p.resolve(output)
    })
    ipcMain.handle(SANDBOX_IPC.http, async (event: IpcMainInvokeEvent, id: string, req: SandboxHttpRequest): Promise<SandboxHttpResult> => {
      const p = this.isSandbox(event) ? this.pending.get(id) : undefined
      if (!p) return { ok: false, error: t('sandbox.unknown') }
      return p.sendRequest(req)
    })
  }

  /** Identifie les messages venant de la fenêtre sandbox (et d'elle seule). */
  isSandbox(event: { sender: Electron.WebContents }): boolean {
    return this.win !== null && !this.win.isDestroyed() && event.sender.id === this.win.webContents.id
  }

  get webContentsId(): number | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents.id : null
  }

  private ensure(): Promise<void> {
    if (this.win && !this.win.isDestroyed() && this.ready) return this.ready
    const ses = session.fromPartition('endora-sandbox')
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    // Seuls les fichiers de l'app (ou le serveur de dev) peuvent être chargés.
    ses.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url.startsWith('file://') || (devUrl !== undefined && details.url.startsWith(devUrl)) || details.url === 'about:blank'
      callback({ cancel: !allowed })
    })
    ses.setPermissionRequestHandler((_wc, _perm, callback) => callback(false))

    this.win = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/sandbox.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        session: ses,
        backgroundThrottling: false,
        devTools: !app.isPackaged,
        spellcheck: false
      }
    })
    this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    this.win.webContents.on('will-navigate', (e) => e.preventDefault())
    this.win.webContents.on('render-process-gone', () => this.reset(t('sandbox.crashed')))
    this.ready = new Promise((resolve) => {
      this.markReady = resolve
    })
    if (devUrl) void this.win.loadURL(`${devUrl}/sandbox.html`)
    else void this.win.loadFile(join(import.meta.dirname, '../renderer/sandbox.html'))
    return this.ready
  }

  /** Détruit la fenêtre (délai dépassé ou plantage) ; les exécutions en cours échouent. */
  private reset(message: string): void {
    const win = this.win
    this.win = null
    this.ready = null
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      this.pending.delete(id)
      p.resolve({ ok: false, error: { message, source: 'Script' }, request: { method: 'GET', url: '', headers: [], body: { mode: 'none' } }, mutations: [], tests: [], logs: [], skipRequest: false, sentRequests: [] })
    }
    for (const [id, p] of this.pendingMock) {
      clearTimeout(p.timer)
      this.pendingMock.delete(id)
      p.resolve(mockFailure(p.input, message))
    }
    if (win && !win.isDestroyed()) win.destroy()
  }

  /** Script d'un mock server : même isolation que les scripts de requêtes, sans réseau. */
  async runMock(input: MockScriptInput, timeoutMs: number): Promise<MockScriptOutput> {
    await this.ensure()
    const win = this.win
    if (!win || win.isDestroyed()) return mockFailure(input, t('sandbox.unavailable'))
    return new Promise<MockScriptOutput>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingMock.delete(input.id)
        resolve(mockFailure(input, t('sandbox.timeout', { seconds: Math.round(timeoutMs / 1000) })))
        this.reset(t('sandbox.interrupted'))
      }, timeoutMs)
      this.pendingMock.set(input.id, { resolve, input, timer })
      win.webContents.send(SANDBOX_IPC.mockRun, { ...input, locale: getLocale() })
    })
  }

  async run(exec: ScriptExecution, sendRequest: Pending['sendRequest'], timeoutMs: number): Promise<ScriptOutcome> {
    await this.ensure()
    const win = this.win
    if (!win || win.isDestroyed()) return failure(exec, t('sandbox.unavailable'))
    return new Promise<ScriptOutcome>((resolve) => {
      const timer = setTimeout(() => {
        // Une boucle infinie bloque la fenêtre : seule sa destruction l'arrête.
        this.pending.delete(exec.id)
        resolve(failure(exec, t('sandbox.timeout', { seconds: Math.round(timeoutMs / 1000) })))
        this.reset(t('sandbox.interrupted'))
      }, timeoutMs)
      this.pending.set(exec.id, { resolve, sendRequest, timer })
      win.webContents.send(SANDBOX_IPC.run, { ...exec, locale: getLocale() })
    })
  }

  dispose(): void {
    this.reset(t('sandbox.closed'))
  }
}
