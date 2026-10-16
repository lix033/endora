// Script d'un mock server, exécuté à chaque requête reçue (dans la fenêtre sandbox, sans réseau).
// API exposée : pm.request (lecture), pm.response (réponse modifiable, préremplie avec l'exemple
// choisi), pm.state (état de la session), pm.session, pm.route, console.

import type { LogLevel } from './types'

export interface MockResponseData {
  status: number
  headers: Record<string, string>
  body: string
}

export interface MockScriptInput {
  id: string
  script: string
  request: {
    method: string
    path: string
    url: string
    query: Record<string, string>
    /** Noms en minuscules. */
    headers: Record<string, string>
    params: Record<string, string>
    body: string
  }
  session: string
  /** Requête de la collection qui correspond, si une correspond. */
  route: { name: string; example: string | null } | null
  state: Record<string, unknown>
  response: MockResponseData
}

export interface MockScriptOutput {
  ok: boolean
  error?: string
  response: MockResponseData
  state: Record<string, unknown>
  logs: Array<{ level: LogLevel; message: string }>
}

type Compile = (params: string[], body: string) => (...args: unknown[]) => unknown

function format(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Valeur stockable dans l'état : uniquement du JSON (copie). */
function toJson(value: unknown): unknown {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown)
}

export async function runMockScript(input: MockScriptInput, compile: Compile): Promise<MockScriptOutput> {
  const response: MockResponseData = { status: input.response.status, headers: { ...input.response.headers }, body: input.response.body }
  const state: Record<string, unknown> = toJson(input.state) as Record<string, unknown>
  const logs: MockScriptOutput['logs'] = []
  const req = input.request

  const setHeader = (key: string, value: unknown) => {
    for (const k of Object.keys(response.headers)) if (k.toLowerCase() === key.toLowerCase()) delete response.headers[k]
    response.headers[key] = String(value)
  }

  const res = {
    get code() {
      return response.status
    },
    get body() {
      return response.body
    },
    get headers() {
      return { ...response.headers }
    },
    status(code: number) {
      const n = Number(code)
      if (!Number.isInteger(n) || n < 100 || n > 599) throw new Error(`Code de statut invalide : ${code}`)
      response.status = n
      return res
    },
    header(key: string, value: unknown) {
      setHeader(String(key), value)
      return res
    },
    json(value: unknown) {
      setHeader('Content-Type', 'application/json')
      response.body = JSON.stringify(value, null, 2) ?? ''
      return res
    },
    send(text: unknown) {
      response.body = text == null ? '' : String(text)
      return res
    }
  }

  const pm = Object.freeze({
    request: Object.freeze({
      method: req.method,
      path: req.path,
      url: req.url,
      query: Object.freeze({ ...req.query }),
      headers: Object.freeze({ ...req.headers }),
      params: Object.freeze({ ...req.params }),
      body: req.body,
      header: (name: string) => req.headers[String(name).toLowerCase()],
      json: () => JSON.parse(req.body) as unknown
    }),
    response: res,
    session: input.session,
    route: input.route ? Object.freeze({ ...input.route }) : null,
    state: Object.freeze({
      get: (key: string) => toJson(state[key]),
      set: (key: string, value: unknown) => {
        state[String(key)] = toJson(value)
      },
      has: (key: string) => Object.prototype.hasOwnProperty.call(state, key),
      unset: (key: string) => {
        delete state[key]
      },
      clear: () => {
        for (const k of Object.keys(state)) delete state[k]
      },
      toObject: () => toJson(state)
    })
  })

  const log =
    (level: LogLevel) =>
    (...args: unknown[]) => {
      logs.push({ level, message: args.map(format).join(' ') })
    }
  const console = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') }

  try {
    const fn = compile(['pm', 'console'], `"use strict";\nreturn (async () => {\n${input.script}\n})()`)
    await fn(pm, console)
    return { ok: true, response, state, logs }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), response, state: toJson(input.state) as Record<string, unknown>, logs }
  }
}
