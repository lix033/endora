// Exécution complète d'une requête, dans l'ordre de référence :
//   scripts pre-request (collection → dossiers → requête) → variables → auth → envoi →
//   scripts de test (collection → dossiers → requête).
// Les scripts sont confiés à un exécuteur injecté (fenêtre sandbox en production, runtime direct
// dans les tests). Les modifications de variables sont renvoyées au renderer, qui les persiste.

import { effectiveAuth, type AuthConfig } from '@shared/auth'
import type { ExecutionInput, ExecutionOutput } from '@shared/execution'
import type { HttpRequestSpec, HttpResult, KeyValue } from '@shared/http'
import type { ProtocolVersion } from '@shared/model'
import type {
  SandboxHttpRequest,
  SandboxHttpResult,
  ScriptExecution,
  ScriptOutcome,
  ScriptRequest,
  ScriptVariable,
  ScriptVariables,
  VariableMutation
} from '@shared/scripting/types'
import { effectiveValue, resolveDeep, resolveString, type Scope, type Variable } from '@shared/variables'
import { sendWithAuth } from './auth'
import { executeHttp, prepareRequest, type SendOptions } from './http'
import { t } from '@shared/i18n'

export type ScriptRunner = (
  exec: ScriptExecution,
  sendRequest: (req: SandboxHttpRequest) => Promise<SandboxHttpResult>,
  timeoutMs: number
) => Promise<ScriptOutcome>

export const toScriptVars = (values: Variable[]): ScriptVariable[] =>
  values.filter((v) => v.enabled && v.key !== '').map((v) => ({ key: v.key, value: effectiveValue(v) }))

/** Applique des modifications de variables sur les valeurs vues par les scripts suivants. */
export function applyMutations(vars: ScriptVariables, mutations: VariableMutation[]): ScriptVariables {
  const next: ScriptVariables = {
    ...vars,
    environment: [...vars.environment],
    globals: [...vars.globals],
    collectionVariables: [...vars.collectionVariables],
    local: [...vars.local]
  }
  for (const m of mutations) {
    const list = next[m.scope]
    if (m.op === 'clear') list.length = 0
    else if (m.op === 'unset') next[m.scope] = list.filter((v) => v.key !== m.key)
    else {
      const existing = list.find((v) => v.key === m.key)
      if (existing) existing.value = m.value
      else list.push({ key: m.key, value: m.value })
    }
  }
  return next
}

export function scopesFrom(vars: ScriptVariables): Scope[] {
  const asVars = (list: ScriptVariable[]): Variable[] => list.map((v) => ({ id: v.key, key: v.key, value: v.value, type: 'default', enabled: true }))
  return [
    { name: 'local', values: asVars(vars.local) },
    { name: 'data', values: asVars(vars.data) },
    { name: 'environment', values: asVars(vars.environment) },
    { name: 'collection', values: asVars(vars.collectionVariables) },
    { name: 'globals', values: asVars(vars.globals) }
  ]
}

export function draftToScriptRequest(input: ExecutionInput): ScriptRequest {
  const d = input.draft
  const rows = (rs: KeyValue[]) =>
    rs.filter((r) => r.key !== '' || r.value !== '').map((r) => ({ key: r.key, value: r.value, ...(r.enabled ? {} : { disabled: true }), ...(r.kind === 'file' ? { type: 'file' as const } : {}) }))
  let body: ScriptRequest['body'] = { mode: 'none' }
  if (d.body.mode === 'raw') body = { mode: 'raw', raw: d.body.raw, language: d.body.language }
  else if (d.body.mode === 'urlencoded') body = { mode: 'urlencoded', urlencoded: rows(d.body.urlencoded) }
  else if (d.body.mode === 'formdata') body = { mode: 'formdata', formdata: rows(d.body.formdata) }
  return { id: input.itemId, name: input.name, method: d.method, url: d.url, headers: rows(d.headers), body }
}

/** Requête (éventuellement modifiée par les scripts) → spécification HTTP avec variables résolues. */
export function toSpec(req: ScriptRequest, scopes: Scope[], language: string): HttpRequestSpec {
  const r = (s: string) => resolveString(s, scopes)
  const rows = (list: ScriptRequest['headers']): KeyValue[] =>
    list.map((i, n) => ({ id: String(n), key: r(i.key), value: r(i.value), enabled: !i.disabled, ...(i.type === 'file' ? { kind: 'file' as const } : {}) }))
  let body: HttpRequestSpec['body'] = { mode: 'none' }
  if (req.body.mode === 'raw') {
    const lang = (req.body.language ?? language) as Extract<HttpRequestSpec['body'], { mode: 'raw' }>['language']
    body = { mode: 'raw', language: ['json', 'xml', 'html', 'text', 'javascript'].includes(lang) ? lang : 'text', text: r(req.body.raw) }
  } else if (req.body.mode === 'urlencoded') body = { mode: 'urlencoded', fields: rows(req.body.urlencoded) }
  else if (req.body.mode === 'formdata') body = { mode: 'formdata', fields: rows(req.body.formdata) }
  return { method: r(req.method), url: r(req.url), params: [], headers: rows(req.headers), body }
}

export function sendOptionsFrom(settings: ExecutionInput['settings'], override?: ProtocolVersion, signal?: AbortSignal): SendOptions {
  return {
    httpVersion: override ?? settings.httpVersion,
    timeoutMs: settings.requestTimeoutMs,
    followRedirects: settings.followRedirects,
    maxRedirects: settings.maxRedirects,
    maxResponseBytes: settings.maxResponseSizeMb * 1024 * 1024,
    signal
  }
}

function toScriptResponse(result: Extract<HttpResult, { ok: true }>) {
  return {
    code: result.status,
    status: result.statusText,
    headers: result.headers.map(([key, value]) => ({ key, value })),
    bodyBase64: result.bodyBase64,
    responseTime: result.timeMs,
    responseSize: result.sizeBytes
  }
}

export async function executeRequest(input: ExecutionInput, runScripts: ScriptRunner, signal?: AbortSignal): Promise<ExecutionOutput> {
  const out: ExecutionOutput = { result: null, skipped: false, tests: [], logs: [], mutations: [], sentRequests: [] }
  const outward = [...input.chain].reverse()
  const scriptsFor = (event: 'prerequest' | 'test') => [
    ...outward.map((p) => ({ code: p.scripts[event], source: p.kind === 'collection' ? t('exec.sourceCollection', { name: p.name }) : t('exec.sourceFolder', { name: p.name }) })),
    { code: input.draft.scripts[event], source: t('exec.sourceRequest') }
  ].filter((s) => s.code.trim() !== '')

  let vars: ScriptVariables = {
    environment: toScriptVars(input.variables.environment),
    environmentName: input.variables.environmentName,
    globals: toScriptVars(input.variables.globals),
    collectionVariables: toScriptVars(input.variables.collection),
    local: [],
    data: Object.entries(input.variables.data ?? {}).map(([key, value]) => ({ key, value }))
  }
  const info = {
    requestName: input.name,
    requestId: input.itemId ?? input.requestId,
    iteration: input.iteration?.index ?? 0,
    iterationCount: input.iteration?.count ?? 1,
    location: input.iteration?.location
  }

  // pm.sendRequest : sans auth ni script, avec les réglages réseau courants.
  const scriptHttp = async (req: SandboxHttpRequest): Promise<SandboxHttpResult> => {
    const spec = toSpec({ method: req.method, url: req.url, headers: req.headers, body: req.body ?? { mode: 'none' } }, scopesFrom(vars), 'text')
    const res = await executeHttp(spec, signal, sendOptionsFrom(input.settings))
    return res.ok ? { ok: true, response: toScriptResponse(res) } : { ok: false, error: res.message }
  }
  const absorb = (o: ScriptOutcome) => {
    if (o.nextRequest !== undefined) out.nextRequest = o.nextRequest
    out.logs.push(...o.logs)
    out.mutations.push(...o.mutations)
    out.sentRequests.push(...o.sentRequests)
    vars = applyMutations(vars, o.mutations)
  }

  let request = draftToScriptRequest(input)
  const pre = scriptsFor('prerequest')
  if (pre.length > 0) {
    const o = await runScripts({ id: input.requestId, event: 'prerequest', scripts: pre, request, variables: vars, info }, scriptHttp, input.settings.scriptTimeoutMs)
    absorb(o)
    out.tests.push(...o.tests)
    if (o.error) {
      out.prerequestError = o.error
      return out
    }
    if (o.skipRequest) {
      out.skipped = true
      return out
    }
    request = o.request
  }

  const scopes = scopesFrom(vars)
  const spec = toSpec(request, scopes, input.draft.body.language)
  out.resolvedUrl = spec.url
  const { auth } = effectiveAuth(input.draft.auth, input.chain.map((p) => ({ auth: p.auth, name: p.name, kind: p.kind })))
  const resolvedAuth: AuthConfig | null = auth ? { type: auth.type, params: resolveDeep(auth.params, scopes) } : null

  const prepared = await prepareRequest(spec)
  if (!prepared.ok) {
    out.result = prepared
    return out
  }
  out.result = await sendWithAuth(resolvedAuth, prepared.prepared, sendOptionsFrom(input.settings, input.draft.protocolVersion, signal))
  if (!out.result.ok) return out

  const post = scriptsFor('test')
  if (post.length > 0) {
    const o = await runScripts(
      { id: input.requestId, event: 'test', scripts: post, request, response: toScriptResponse(out.result), variables: vars, info },
      scriptHttp,
      input.settings.scriptTimeoutMs
    )
    absorb(o)
    out.tests.push(...o.tests)
    if (o.error) out.testError = o.error
  }
  return out
}
