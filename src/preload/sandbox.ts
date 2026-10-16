// Preload de la fenêtre sandbox : expose uniquement le canal d'exécution des scripts.

import { contextBridge, ipcRenderer } from 'electron'
import type { MockScriptInput, MockScriptOutput } from '@shared/scripting/mock-runtime'
import type { SandboxHttpRequest, SandboxHttpResult, ScriptExecution, ScriptOutcome } from '@shared/scripting/types'

contextBridge.exposeInMainWorld('endoraSandbox', {
  onRun: (listener: (exec: ScriptExecution) => void) => {
    ipcRenderer.on('sandbox:run', (_event, exec: ScriptExecution) => listener(exec))
  },
  done: (id: string, outcome: ScriptOutcome) => ipcRenderer.send('sandbox:done', id, outcome),
  http: (id: string, req: SandboxHttpRequest): Promise<SandboxHttpResult> => ipcRenderer.invoke('sandbox:http', id, req),
  onMock: (listener: (input: MockScriptInput) => void) => {
    ipcRenderer.on('sandbox:mock-run', (_event, input: MockScriptInput) => listener(input))
  },
  mockDone: (id: string, output: MockScriptOutput) => ipcRenderer.send('sandbox:mock-done', id, output),
  ready: () => ipcRenderer.send('sandbox:ready')
})
