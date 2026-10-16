// Page sandbox : exécute les scripts reçus du process principal, chacun dans un iframe neuf.

import CryptoJS from 'crypto-js'
import lodash from 'lodash'
import { runMockScript, type MockScriptInput, type MockScriptOutput } from '@shared/scripting/mock-runtime'
import { runScripts } from '@shared/scripting/runtime'
import type { SandboxHttpRequest, SandboxHttpResult, ScriptExecution, ScriptOutcome } from '@shared/scripting/types'

interface SandboxBridge {
  onRun(listener: (exec: ScriptExecution) => void): void
  done(id: string, outcome: ScriptOutcome): void
  http(id: string, req: SandboxHttpRequest): Promise<SandboxHttpResult>
  onMock(listener: (input: MockScriptInput) => void): void
  mockDone(id: string, output: MockScriptOutput): void
  ready(): void
}

const bridge = (window as unknown as { endoraSandbox: SandboxBridge }).endoraSandbox

bridge.onRun((exec) => {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  const realm = frame.contentWindow as (Window & { Function: FunctionConstructor }) | null
  void runScripts(exec, {
    sendRequest: (req) => bridge.http(exec.id, req),
    compile: (params, body) => new (realm?.Function ?? Function)(...params, body) as (...args: unknown[]) => unknown,
    libraries: { lodash, 'crypto-js': CryptoJS }
  })
    .catch(
      (err: unknown): ScriptOutcome => ({
        ok: false,
        error: { message: err instanceof Error ? err.message : String(err), source: 'Sandbox' },
        request: exec.request,
        mutations: [],
        tests: [],
        logs: [],
        skipRequest: false,
        sentRequests: []
      })
    )
    .then((outcome) => {
      frame.remove()
      // Le résultat ne contient que des données sérialisables.
      bridge.done(exec.id, JSON.parse(JSON.stringify(outcome)) as ScriptOutcome)
    })
})

// Script d'un mock server : un iframe neuf par requête reçue, sans accès réseau.
bridge.onMock((input) => {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  const realm = frame.contentWindow as (Window & { Function: FunctionConstructor }) | null
  void runMockScript(input, (params, body) => new (realm?.Function ?? Function)(...params, body) as (...args: unknown[]) => unknown)
    .catch((err: unknown): MockScriptOutput => ({ ok: false, error: err instanceof Error ? err.message : String(err), response: input.response, state: input.state, logs: [] }))
    .then((output) => {
      frame.remove()
      bridge.mockDone(input.id, JSON.parse(JSON.stringify(output)) as MockScriptOutput)
    })
})

bridge.ready()
