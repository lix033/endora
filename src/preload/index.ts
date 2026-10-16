import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type EndoraApi, type MenuAction } from '@shared/api'
import type { MockEvent } from '@shared/mock'
import type { UpdaterState } from '@shared/updates'

const api: EndoraApi = {
  sendHttp: (requestId, spec) => ipcRenderer.invoke(IPC.httpSend, requestId, spec),
  cancelHttp: (requestId) => ipcRenderer.invoke(IPC.httpCancel, requestId),
  execute: (input) => ipcRenderer.invoke(IPC.execute, input),

  loadWorkspace: () => ipcRenderer.invoke(IPC.workspaceLoad),
  saveCollection: (id, collection) => ipcRenderer.invoke(IPC.collectionSave, id, collection),
  deleteCollection: (id) => ipcRenderer.invoke(IPC.collectionDelete, id),
  saveHistory: (entries) => ipcRenderer.invoke(IPC.historySave, entries),
  saveSession: (session) => ipcRenderer.invoke(IPC.sessionSave, session),
  saveEnvironment: (env) => ipcRenderer.invoke(IPC.environmentSave, env),
  deleteEnvironment: (id) => ipcRenderer.invoke(IPC.environmentDelete, id),
  saveGlobals: (values) => ipcRenderer.invoke(IPC.globalsSave, values),
  saveSettings: (settings) => ipcRenderer.invoke(IPC.settingsSave, settings),

  openTextFiles: () => ipcRenderer.invoke(IPC.fileOpenText),
  saveTextFile: (defaultName, text) => ipcRenderer.invoke(IPC.fileSaveText, defaultName, text),
  pickFile: () => ipcRenderer.invoke(IPC.filePick),
  writeClipboard: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text),
  parseCurl: (text) => ipcRenderer.invoke(IPC.curlParse, text),
  getOAuth2Token: (auth) => ipcRenderer.invoke(IPC.oauth2Token, auth),
  convertImport: (name, text, options) => ipcRenderer.invoke(IPC.importConvert, name, text, options),
  fetchImport: (url, options) => ipcRenderer.invoke(IPC.importFetch, url, options),
  codegenLanguages: () => ipcRenderer.invoke(IPC.codegenLanguages),
  codegenOptions: (language, variant) => ipcRenderer.invoke(IPC.codegenOptions, language, variant),
  generateCode: (input, language, variant, options, resolveVariables) => ipcRenderer.invoke(IPC.codegenGenerate, input, language, variant, options, resolveVariables),
  checkForUpdates: (source) => ipcRenderer.invoke(IPC.updatesCheck, source),
  openExternal: (url) => ipcRenderer.invoke(IPC.openExternal, url),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),

  mockList: () => ipcRenderer.invoke(IPC.mockList),
  mockCreate: (input) => ipcRenderer.invoke(IPC.mockCreate, input),
  mockUpdate: (id, patch) => ipcRenderer.invoke(IPC.mockUpdate, id, patch),
  mockDelete: (id) => ipcRenderer.invoke(IPC.mockDelete, id),
  mockStart: (id) => ipcRenderer.invoke(IPC.mockStart, id),
  mockStop: (id) => ipcRenderer.invoke(IPC.mockStop, id),
  mockDeploy: (id) => ipcRenderer.invoke(IPC.mockDeploy, id),
  mockLogs: (id) => ipcRenderer.invoke(IPC.mockLogs, id),
  mockClearLogs: (id) => ipcRenderer.invoke(IPC.mockClearLogs, id),
  mockResetState: (id) => ipcRenderer.invoke(IPC.mockResetState, id),
  onMockEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, e: MockEvent) => listener(e)
    ipcRenderer.on(IPC.mockEvent, handler)
    return () => ipcRenderer.removeListener(IPC.mockEvent, handler)
  },

  updaterState: () => ipcRenderer.invoke(IPC.updaterState),
  updaterCheck: () => ipcRenderer.invoke(IPC.updaterCheck),
  updaterInstall: () => ipcRenderer.invoke(IPC.updaterInstall),
  onUpdaterState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: UpdaterState) => listener(state)
    ipcRenderer.on(IPC.updaterEvent, handler)
    return () => ipcRenderer.removeListener(IPC.updaterEvent, handler)
  },

  onMenuAction: (listener) => {
    const handler = (_event: IpcRendererEvent, action: MenuAction) => listener(action)
    ipcRenderer.on(IPC.menuAction, handler)
    return () => ipcRenderer.removeListener(IPC.menuAction, handler)
  }
}

contextBridge.exposeInMainWorld('endora', api)
