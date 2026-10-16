import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  shell,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from 'electron'
import { DEFAULT_IMPORT_OPTIONS, IPC, type AppInfo, type ImportOptions, type MenuAction, type OpenTextResult, type SaveTextResult } from '@shared/api'
import type { AuthConfig } from '@shared/auth'
import type { ExecutionInput } from '@shared/execution'
import type { HttpRequestSpec } from '@shared/http'
import { normalizeSettings, type Settings } from '@shared/settings'
import { comboAccelerator, effectiveShortcuts, type ShortcutAction } from '@shared/shortcuts'
import { THEMES } from '@shared/themes'
import { parseCurl } from './curl'
import { executeRequest } from './executor'
import { executeHttp } from './http'
import { getOAuth2Token } from './oauth2'
import { ScriptSandbox } from './sandbox'
import { WorkspaceStorage, type SecretCipher } from './storage'
import { checkForUpdates } from './updates'
import { codegenLanguages, codegenOptions, generateCode } from './codegen'
import { convertImport, fetchImport } from './importers'

const inFlight = new Map<string, AbortController>()
const MAX_IMPORT_BYTES = 50 * 1024 * 1024

let storage: WorkspaceStorage
let sandbox: ScriptSandbox
let settings: Settings = normalizeSettings(null)
const appWindows = new Set<number>()

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Endora',
    backgroundColor: THEMES[nativeTheme.shouldUseDarkColors ? settings.theme.dark : settings.theme.light].colors.bg,
    // Icône de fenêtre en développement (dans l'app empaquetée, l'icône vient de l'exécutable).
    ...(app.isPackaged ? {} : { icon: join(import.meta.dirname, '../../build/icon-512.png') }),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const id = win.webContents.id
  appWindows.add(id)
  win.on('closed', () => {
    appWindows.delete(id)
    // La fenêtre cachée des scripts ne doit pas garder l'app ouverte.
    if (appWindows.size === 0) {
      sandbox?.dispose()
      if (process.platform !== 'darwin') app.quit()
    }
  })

  // Les liens externes s'ouvrent dans le navigateur, jamais dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Aucune navigation de la fenêtre principale hors de l'UI de l'app.
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

function sendMenuAction(action: MenuAction): void {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows().find((w) => appWindows.has(w.webContents.id))
  target?.webContents.send(IPC.menuAction, action)
}

/**
 * Menu natif. Les raccourcis (personnalisables) sont gérés par le renderer : le menu affiche le
 * premier raccourci de chaque action sans l'enregistrer, pour qu'une seule source fasse foi.
 */
function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const shortcuts = effectiveShortcuts(settings.shortcuts)
  const item = (label: string, action: ShortcutAction): MenuItemConstructorOptions => {
    const first = shortcuts[action][0]
    return {
      label,
      ...(first ? { accelerator: comboAccelerator(first), registerAccelerator: false } : {}),
      click: () => sendMenuAction(action)
    }
  }
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              item('Paramètres…', 'openSettings'),
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'Fichier',
      submenu: [
        item('Nouvel onglet', 'newTab'),
        item('Importer…', 'import'),
        { type: 'separator' },
        item('Enregistrer', 'save'),
        item('Enregistrer sous…', 'saveAs'),
        { type: 'separator' },
        item("Fermer l'onglet", 'closeTab'),
        item("Rouvrir l'onglet fermé", 'reopenTab'),
        ...(isMac ? [] : [{ type: 'separator' as const }, item('Paramètres', 'openSettings')]),
        { type: 'separator' },
        isMac ? { role: 'close', accelerator: 'CmdOrCtrl+Shift+W' } : { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Affichage',
      submenu: [
        item('Onglet suivant', 'nextTab'),
        item('Onglet précédent', 'previousTab'),
        item('Barre latérale', 'toggleSidebar'),
        item('Console', 'toggleConsole'),
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** Thème natif (menus, dialogues) : suit le système ou le mode du thème choisi. */
function applyNativeTheme(): void {
  nativeTheme.themeSource = settings.theme.mode === 'system' ? 'system' : THEMES[settings.theme.fixed].dark ? 'dark' : 'light'
}

/** Seules les fenêtres de l'interface peuvent appeler l'API de l'app (pas la fenêtre des scripts). */
function handle<A extends unknown[], R>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: A) => R): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!appWindows.has(event.sender.id)) throw new Error('Expéditeur non autorisé')
    return fn(event, ...(args as A))
  })
}

function registerIpc(): void {
  handle(IPC.httpSend, async (_event, requestId: string, spec: HttpRequestSpec) => {
    const controller = new AbortController()
    inFlight.set(requestId, controller)
    try {
      return await executeHttp(spec, controller.signal)
    } finally {
      inFlight.delete(requestId)
    }
  })
  handle(IPC.httpCancel, (_event, requestId: string) => {
    inFlight.get(requestId)?.abort()
  })
  handle(IPC.execute, async (_event, input: ExecutionInput) => {
    const controller = new AbortController()
    inFlight.set(input.requestId, controller)
    try {
      return await executeRequest(input, (exec, send, timeout) => sandbox.run(exec, send, timeout), controller.signal)
    } finally {
      inFlight.delete(input.requestId)
    }
  })

  handle(IPC.workspaceLoad, async () => {
    const snapshot = await storage.load()
    settings = snapshot.settings
    applyNativeTheme()
    buildMenu()
    return snapshot
  })
  handle(IPC.collectionSave, (_event, id: unknown, collection: unknown) => storage.saveCollection(id, collection))
  handle(IPC.collectionDelete, (_event, id: unknown) => storage.deleteCollection(id))
  handle(IPC.historySave, (_event, entries: unknown) => storage.saveHistory(entries))
  handle(IPC.sessionSave, (_event, session: unknown) => storage.saveSession(session))
  handle(IPC.environmentSave, (_event, env: unknown) => storage.saveEnvironment(env))
  handle(IPC.environmentDelete, (_event, id: unknown) => storage.deleteEnvironment(id))
  handle(IPC.globalsSave, (_event, values: unknown) => storage.saveGlobals(values))
  handle(IPC.settingsSave, async (_event, next: unknown) => {
    settings = normalizeSettings(next)
    applyNativeTheme()
    buildMenu()
    return storage.saveSettings(settings)
  })

  handle(IPC.fileOpenText, async (event): Promise<OpenTextResult> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Importer',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Collections, environnements et textes', extensions: ['json', 'txt', 'sh', 'curl'] },
        { name: 'Tous les fichiers', extensions: ['*'] }
      ]
    }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, canceled: true }
    try {
      const files = []
      for (const path of picked.filePaths) {
        const buf = await readFile(path)
        if (buf.byteLength > MAX_IMPORT_BYTES) throw new Error(`${basename(path)} dépasse 50 Mo`)
        files.push({ name: basename(path), text: buf.toString('utf8') })
      }
      return { ok: true, files }
    } catch (err) {
      return { ok: false, canceled: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  handle(IPC.fileSaveText, async (event, defaultName: unknown, text: unknown): Promise<SaveTextResult> => {
    if (typeof defaultName !== 'string' || typeof text !== 'string') {
      return { ok: false, canceled: false, message: 'Paramètres invalides' }
    }
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      title: 'Exporter',
      defaultPath: basename(defaultName),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const picked = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true }
    try {
      await writeFile(picked.filePath, text, 'utf8')
      return { ok: true, path: picked.filePath }
    } catch (err) {
      return { ok: false, canceled: false, message: err instanceof Error ? err.message : String(err) }
    }
  })

  handle(IPC.filePick, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = { title: 'Choisir un fichier', properties: ['openFile'] }
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return picked.canceled ? null : (picked.filePaths[0] ?? null)
  })

  handle(IPC.clipboardWrite, (_event, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text)
  })
  handle(IPC.curlParse, (_event, text: unknown) => parseCurl(text))
  handle(IPC.oauth2Token, (event, auth: AuthConfig) => getOAuth2Token(auth, BrowserWindow.fromWebContents(event.sender)))
  handle(IPC.importConvert, (_event, name: unknown, text: unknown, options: ImportOptions) => convertImport(name, text, { ...DEFAULT_IMPORT_OPTIONS, ...options }))
  handle(IPC.importFetch, (_event, url: unknown, options: ImportOptions) => fetchImport(url, { ...DEFAULT_IMPORT_OPTIONS, ...options }))
  handle(IPC.codegenLanguages, () => codegenLanguages())
  handle(IPC.codegenOptions, (_event, language: unknown, variant: unknown) => codegenOptions(language, variant))
  handle(IPC.codegenGenerate, (_event, input: ExecutionInput, language: unknown, variant: unknown, options: unknown, resolve: unknown) =>
    generateCode(input, language, variant, options, resolve)
  )
  handle(IPC.updatesCheck, (_event, source: unknown) => checkForUpdates(typeof source === 'string' ? source : settings.updates.source, app.getVersion()))
  handle(IPC.openExternal, (_event, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
  })
  handle(
    IPC.appInfo,
    (): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: `${process.platform} ${process.arch}`,
      secretsEncrypted: safeStorage.isEncryptionAvailable()
    })
  )
}

/** Chiffrement des secrets par le trousseau du système, quand il est disponible. */
function systemCipher(): SecretCipher | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  return {
    encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
    decrypt: (data) => safeStorage.decryptString(Buffer.from(data, 'base64'))
  }
}

void app.whenReady().then(async () => {
  storage = new WorkspaceStorage(join(app.getPath('userData'), 'workspace'), systemCipher())
  settings = await storage.readSettings()
  sandbox = new ScriptSandbox()
  if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(join(import.meta.dirname, '../../build/icon-512.png'))
  applyNativeTheme()
  registerIpc()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().filter((w) => appWindows.has(w.webContents.id)).length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Termine les écritures en cours avant de quitter.
let flushed = false
app.on('before-quit', (event) => {
  sandbox?.dispose()
  if (flushed || !storage) return
  event.preventDefault()
  void storage.flush().finally(() => {
    flushed = true
    app.quit()
  })
})
