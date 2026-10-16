// Preload de la fenêtre sandbox : expose uniquement le canal d'exécution des scripts.

import { contextBridge, ipcRenderer } from 'electron'
import type { SandboxHttpRequest, SandboxHttpResult, ScriptExecution, ScriptOutcome } from '@shared/scripting/types'

contextBridge.exposeInMainWorld('endoraSandbox', {
  onRun: (listener: (exec: ScriptExecution) => void) => {
    ipcRenderer.on('sandbox:run', (_event, exec: ScriptExecution) => listener(exec))
  },
  done: (id: string, outcome: ScriptOutcome) => ipcRenderer.send('sandbox:done', id, outcome),
  http: (id: string, req: SandboxHttpRequest): Promise<SandboxHttpResult> => ipcRenderer.invoke('sandbox:http', id, req),
  ready: () => ipcRenderer.send('sandbox:ready')
})
