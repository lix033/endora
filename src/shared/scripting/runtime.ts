// Runtime des scripts : API `pm.*` (sous-ensemble compatible avec le client de référence),
// assertions chai, console et compatibilité avec l'ancienne API (`tests[...]`, `postman.*`).
//
// Comportements observés dans la référence :
// - le code utilisateur est enveloppé dans une fonction async : `await` de premier niveau permis ;
// - `pm.execution.skipRequest()` n'existe que dans les scripts pre-request ;
// - une erreur de script pre-request empêche l'envoi et s'affiche à la place de la réponse.
//
// Ce module s'exécute dans la fenêtre sandbox (sans Node ni réseau) ; il est aussi importable
// sous Node pour les tests. Le réseau (`pm.sendRequest`) passe par un hook fourni par l'hôte.

import * as chai from 'chai'
import type {
  LogLevel,
  SandboxHttpRequest,
  SandboxHttpResult,
  ScriptExecution,
  ScriptKeyValue,
  ScriptLog,
  ScriptOutcome,
  ScriptRequest,
  ScriptResponse,
  ScriptVariable,
  TestResult,
  VariableMutation
} from './types'

export interface RuntimeHooks {
  sendRequest: (req: SandboxHttpRequest) => Promise<SandboxHttpResult>
  /** Compile le code dans un domaine global neuf (iframe du sandbox) ; `Function` par défaut. */
  compile?: (params: string[], body: string) => (...args: unknown[]) => unknown
  /** Bibliothèques exposées via `require` et en globales (lodash, crypto-js…). */
  libraries?: Record<string, unknown>
}

// --- Utilitaires --------------------------------------------------------------------------------

/** Les scripts s'exécutent dans un autre domaine global (iframe) : `instanceof Error` n'y suffit pas. */
const isErrorLike = (v: unknown): v is { name?: string; message: string } =>
  typeof v === 'object' && v !== null && typeof (v as { message?: unknown }).message === 'string'

const errorText = (v: unknown): string => (isErrorLike(v) ? `${v.name || 'Error'}: ${v.message}` : stringify(v))

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  if (isErrorLike(value) && (value instanceof Error || Object.prototype.toString.call(value) === '[object Error]')) return `${value.name}: ${value.message}`
  if (value === undefined) return 'undefined'
  if (typeof value === 'function') return `[Function ${value.name || 'anonyme'}]`
  const seen = new WeakSet()
  try {
    return JSON.stringify(value, (_k, v: unknown) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]'
        seen.add(v)
      }
      return typeof v === 'bigint' ? `${v}n` : v
    })
  } catch {
    return String(value)
  }
}

/** Valeur de variable : chaîne telle quelle, objets sérialisés en JSON. */
const toVarValue = (v: unknown): string => (typeof v === 'string' ? v : v === undefined ? '' : typeof v === 'object' ? stringify(v) : String(v))

const decodeBase64 = (b64: string): string => {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// --- Listes clé/valeur (en-têtes, query, formulaires) -------------------------------------------

type KvInput = ScriptKeyValue | { key: string; value?: unknown; disabled?: boolean } | string

export class KeyValueList {
  members: ScriptKeyValue[]

  constructor(
    items: ScriptKeyValue[],
    private readonly caseInsensitive: boolean,
    private readonly onChange?: () => void
  ) {
    this.members = items.map((i) => ({ ...i }))
  }

  private match(key: string): (i: ScriptKeyValue) => boolean {
    return this.caseInsensitive ? (i) => i.key.toLowerCase() === key.toLowerCase() : (i) => i.key === key
  }

  private parse(input: KvInput): ScriptKeyValue {
    if (typeof input === 'string') {
      const i = input.indexOf(':')
      return i === -1 ? { key: input.trim(), value: '' } : { key: input.slice(0, i).trim(), value: input.slice(i + 1).trim() }
    }
    return { key: String(input.key), value: toVarValue(input.value), ...(input.disabled ? { disabled: true } : {}) }
  }

  get(key: string): string | undefined {
    const found = [...this.members].reverse().find((i) => !i.disabled && this.match(key)(i))
    return found?.value
  }
  one(key: string): ScriptKeyValue | undefined {
    return this.members.find((i) => !i.disabled && this.match(key)(i))
  }
  has(key: string, value?: string): boolean {
    return this.members.some((i) => !i.disabled && this.match(key)(i) && (value === undefined || i.value === value))
  }
  add(input: KvInput): void {
    this.members.push(this.parse(input))
    this.onChange?.()
  }
  append(input: KvInput): void {
    this.add(input)
  }
  upsert(input: KvInput): void {
    const item = this.parse(input)
    const existing = this.members.find(this.match(item.key))
    if (existing) existing.value = item.value
    else this.members.push(item)
    this.onChange?.()
  }
  remove(predicate: string | ((i: ScriptKeyValue) => boolean)): void {
    const test = typeof predicate === 'string' ? this.match(predicate) : predicate
    this.members = this.members.filter((i) => !test(i))
    this.onChange?.()
  }
  clear(): void {
    this.members = []
    this.onChange?.()
  }
  all(): ScriptKeyValue[] {
    return this.members.filter((i) => !i.disabled)
  }
  count(): number {
    return this.all().length
  }
  idx(index: number): ScriptKeyValue | undefined {
    return this.members[index]
  }
  each(fn: (i: ScriptKeyValue) => void): void {
    this.all().forEach(fn)
  }
  map<T>(fn: (i: ScriptKeyValue) => T): T[] {
    return this.all().map(fn)
  }
  filter(fn: (i: ScriptKeyValue) => boolean): ScriptKeyValue[] {
    return this.all().filter(fn)
  }
  find(fn: (i: ScriptKeyValue) => boolean): ScriptKeyValue | undefined {
    return this.all().find(fn)
  }
  toObject(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const i of this.all()) out[this.caseInsensitive ? i.key.toLowerCase() : i.key] = i.value
    return out
  }
  toJSON(): ScriptKeyValue[] {
    return this.members
  }
  toString(): string {
    return this.all()
      .map((i) => `${i.key}: ${i.value}`)
      .join('\n')
  }
}

// --- URL ----------------------------------------------------------------------------------------

export class ScriptUrl {
  private base = ''
  private hash: string | null = null
  query: KeyValueList

  constructor(raw: string) {
    this.query = new KeyValueList([], false)
    this.update(raw)
  }

  update(raw: string): void {
    let rest = String(raw)
    const h = rest.indexOf('#')
    this.hash = h === -1 ? null : rest.slice(h + 1)
    if (h !== -1) rest = rest.slice(0, h)
    const q = rest.indexOf('?')
    this.base = q === -1 ? rest : rest.slice(0, q)
    const query = q === -1 ? '' : rest.slice(q + 1)
    this.query = new KeyValueList(
      query === ''
        ? []
        : query.split('&').map((pair) => {
            const eq = pair.indexOf('=')
            return eq === -1 ? { key: pair, value: '' } : { key: pair.slice(0, eq), value: pair.slice(eq + 1) }
          }),
      false
    )
  }

  get protocol(): string | undefined {
    return /^([a-z][a-z0-9+.-]*):\/\//i.exec(this.base)?.[1]
  }
  private get authority(): string {
    const withoutProto = this.base.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    const slash = withoutProto.indexOf('/')
    return slash === -1 ? withoutProto : withoutProto.slice(0, slash)
  }
  get host(): string[] {
    return this.getHost().split('.')
  }
  get port(): string | undefined {
    return /:(\d+)$/.exec(this.authority)?.[1]
  }
  get path(): string[] {
    return this.getPath().split('/').filter((p, i) => i > 0 || p !== '')
  }
  getHost(): string {
    return this.authority.replace(/:\d+$/, '')
  }
  getPath(): string {
    const withoutProto = this.base.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    const slash = withoutProto.indexOf('/')
    return slash === -1 ? '/' : withoutProto.slice(slash)
  }
  getQueryString(): string {
    return this.query
      .all()
      .map((i) => (i.value === '' ? i.key : `${i.key}=${i.value}`))
      .join('&')
  }
  getPathWithQuery(): string {
    const q = this.getQueryString()
    return `${this.getPath()}${q ? `?${q}` : ''}`
  }
  addQueryParams(params: KvInput[] | KvInput): void {
    for (const p of Array.isArray(params) ? params : [params]) this.query.add(p)
  }
  removeQueryParams(keys: string[] | string): void {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.query.remove(k)
  }
  toString(): string {
    const q = this.getQueryString()
    return `${this.base}${q ? `?${q}` : ''}${this.hash !== null ? `#${this.hash}` : ''}`
  }
  toJSON(): string {
    return this.toString()
  }
}

// --- Requête et réponse --------------------------------------------------------------------------

export class ScriptRequestObject {
  id?: string
  name?: string
  method: string
  url: ScriptUrl
  headers: KeyValueList
  body: {
    mode: string
    raw?: string
    urlencoded?: KeyValueList
    formdata?: KeyValueList
    update: (input: string | { mode: string; raw?: string }) => void
    toString: () => string
  }

  constructor(req: ScriptRequest) {
    this.id = req.id
    this.name = req.name
    this.method = req.method
    this.url = new ScriptUrl(req.url)
    this.headers = new KeyValueList(req.headers, true)
    const body = req.body
    const self = this
    this.body = {
      mode: body.mode,
      raw: body.mode === 'raw' ? body.raw : undefined,
      urlencoded: body.mode === 'urlencoded' ? new KeyValueList(body.urlencoded, false) : undefined,
      formdata: body.mode === 'formdata' ? new KeyValueList(body.formdata, false) : undefined,
      update(input) {
        if (typeof input === 'string') {
          self.body.mode = 'raw'
          self.body.raw = input
        } else {
          self.body.mode = input.mode
          if (input.raw !== undefined) self.body.raw = input.raw
        }
      },
      toString() {
        if (self.body.mode === 'raw') return self.body.raw ?? ''
        if (self.body.mode === 'urlencoded') return self.body.urlencoded?.map((i) => `${i.key}=${i.value}`).join('&') ?? ''
        return ''
      }
    }
  }

  addHeader(h: KvInput): void {
    this.headers.add(h)
  }
  upsertHeader(h: KvInput): void {
    this.headers.upsert(h)
  }
  removeHeader(key: string): void {
    this.headers.remove(key)
  }
  addQueryParams(p: KvInput[] | KvInput): void {
    this.url.addQueryParams(p)
  }
  removeQueryParams(keys: string[] | string): void {
    this.url.removeQueryParams(keys)
  }
  get to(): Chai.Assertion {
    return chai.expect(this).to
  }

  toJSON(): ScriptRequest {
    const b = this.body
    let body: ScriptRequest['body'] = { mode: 'none' }
    if (b.mode === 'raw') body = { mode: 'raw', raw: b.raw ?? '' }
    else if (b.mode === 'urlencoded') body = { mode: 'urlencoded', urlencoded: b.urlencoded?.toJSON() ?? [] }
    else if (b.mode === 'formdata') body = { mode: 'formdata', formdata: b.formdata?.toJSON() ?? [] }
    return { id: this.id, name: this.name, method: String(this.method).toUpperCase(), url: this.url.toString(), headers: this.headers.toJSON(), body }
  }
}

export class ScriptResponseObject {
  readonly code: number
  readonly status: string
  readonly headers: KeyValueList
  readonly responseTime: number
  readonly responseSize: number
  private readonly bodyBase64: string
  private textCache?: string

  constructor(res: ScriptResponse) {
    this.code = res.code
    this.status = res.status
    this.headers = new KeyValueList(res.headers, true)
    this.responseTime = res.responseTime
    this.responseSize = res.responseSize
    this.bodyBase64 = res.bodyBase64
  }

  text(): string {
    return (this.textCache ??= decodeBase64(this.bodyBase64))
  }
  json(reviver?: (key: string, value: unknown) => unknown): unknown {
    return JSON.parse(this.text(), reviver)
  }
  reason(): string {
    return this.status
  }
  dataURI(): string {
    return `data:${this.headers.get('content-type') ?? 'application/octet-stream'};base64,${this.bodyBase64}`
  }
  get to(): Chai.Assertion {
    return chai.expect(this).to
  }
  toJSON() {
    return { code: this.code, status: this.status, headers: this.headers.toJSON(), responseTime: this.responseTime, responseSize: this.responseSize }
  }
}

// --- Assertions sur les réponses -----------------------------------------------------------------

let pluginInstalled = false

/** Assertions de réponse (`pm.response.to.have.status(200)`, `.to.be.ok`…). */
function installChaiPlugin(): void {
  if (pluginInstalled) return
  pluginInstalled = true
  chai.use((_chai, utils) => {
    const { Assertion } = _chai
    const isResponse = (o: unknown): o is ScriptResponseObject => o instanceof ScriptResponseObject
    const families: Array<[string, (c: number) => boolean, string]> = [
      ['info', (c) => c >= 100 && c < 200, '1xx'],
      ['success', (c) => c >= 200 && c < 300, '2xx'],
      ['redirection', (c) => c >= 300 && c < 400, '3xx'],
      ['clientError', (c) => c >= 400 && c < 500, '4xx'],
      ['serverError', (c) => c >= 500 && c < 600, '5xx'],
      ['error', (c) => c >= 400 && c < 600, '4xx ou 5xx'],
      ['accepted', (c) => c === 202, '202'],
      ['badRequest', (c) => c === 400, '400'],
      ['unauthorized', (c) => c === 401, '401'],
      ['forbidden', (c) => c === 403, '403'],
      ['notFound', (c) => c === 404, '404'],
      ['rateLimited', (c) => c === 429, '429']
    ]
    for (const [name, test, label] of families) {
      Assertion.addProperty(name, function (this: Chai.AssertionStatic) {
        const obj = utils.flag(this, 'object') as ScriptResponseObject
        this.assert(test(obj.code), `expected response code to be ${label} but found ${obj.code}`, `expected response code not to be ${label}`, label, obj.code)
      })
    }
    // `ok` est déjà une assertion chai (valeur vraie) : on la spécialise pour les réponses (code 200).
    Assertion.overwriteProperty('ok', (_super: (this: unknown) => void) =>
      function (this: Chai.AssertionStatic) {
        const obj = utils.flag(this, 'object') as unknown
        if (!isResponse(obj)) return _super.call(this)
        this.assert(obj.code === 200, `expected response code to be 200 but found ${obj.code}`, 'expected response code not to be 200', 200, obj.code)
      }
    )
    Assertion.addMethod('status', function (this: Chai.AssertionStatic, expected: number | string) {
      const obj = utils.flag(this, 'object') as ScriptResponseObject
      if (typeof expected === 'number') {
        this.assert(obj.code === expected, `expected response to have status code ${expected} but got ${obj.code}`, `expected response to not have status code ${expected}`, expected, obj.code)
      } else {
        this.assert(obj.status === expected, `expected response to have status reason '${expected}' but got '${obj.status}'`, `expected response to not have status reason '${expected}'`, expected, obj.status)
      }
    })
    Assertion.addMethod('header', function (this: Chai.AssertionStatic, key: string, value?: string) {
      const obj = utils.flag(this, 'object') as ScriptResponseObject | ScriptRequestObject
      const has = obj.headers.has(key)
      if (value === undefined) {
        this.assert(has, `expected response to have header with key '${key}'`, `expected response to not have header with key '${key}'`, key)
      } else {
        const actual = obj.headers.get(key)
        this.assert(actual === value, `expected '${key}' response header to be '${value}' but got '${actual}'`, `expected '${key}' response header to not be '${value}'`, value, actual)
      }
    })
    Assertion.addMethod('body', function (this: Chai.AssertionStatic, expected?: string | RegExp | object) {
      const obj = utils.flag(this, 'object') as ScriptResponseObject
      const text = obj.text()
      if (expected === undefined) {
        this.assert(text.length > 0, 'expected response to have content in body', 'expected response to not have content in body')
      } else if (expected instanceof RegExp) {
        this.assert(expected.test(text), `expected response body text to match ${expected}`, `expected response body text not to match ${expected}`)
      } else if (typeof expected === 'string') {
        this.assert(text === expected, 'expected response body to equal the given string', 'expected response body to not equal the given string', expected, text)
      } else {
        let json: unknown
        try {
          json = obj.json()
        } catch {
          json = undefined
        }
        this.assert(utils.eql(json, expected), 'expected response body json to equal the given object', 'expected response body json to not equal the given object', expected, json)
      }
    })
    Assertion.addProperty('json', function (this: Chai.AssertionStatic) {
      const obj = utils.flag(this, 'object') as ScriptResponseObject
      let ok = true
      try {
        obj.json()
      } catch {
        ok = false
      }
      this.assert(ok, 'expected response body to be a valid json', 'expected response body not to be a valid json')
    })
    Assertion.addMethod('jsonBody', function (this: Chai.AssertionStatic, path?: string, value?: unknown) {
      const obj = utils.flag(this, 'object') as ScriptResponseObject
      let json: unknown
      try {
        json = obj.json()
      } catch {
        this.assert(false, 'expected response body to be a valid json', '')
        return
      }
      if (path === undefined) return
      let current: unknown = json
      for (const part of path.split('.')) current = current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined
      if (arguments.length < 2) {
        this.assert(current !== undefined, `expected response body json to have path '${path}'`, `expected response body json to not have path '${path}'`)
      } else {
        this.assert(utils.eql(current, value), `expected response body json at '${path}' to contain '${stringify(value)}' but got '${stringify(current)}'`, `expected response body json at '${path}' not to contain '${stringify(value)}'`, value, current)
      }
    })
    Assertion.addMethod('responseTime', function (this: Chai.AssertionStatic, max: number) {
      const obj = utils.flag(this, 'object') as ScriptResponseObject
      this.assert(obj.responseTime <= max, `expected response time to be at most ${max}ms but got ${obj.responseTime}ms`, `expected response time to exceed ${max}ms`)
    })
  })
}

// --- Variables -----------------------------------------------------------------------------------

class VariableScope {
  private values: Map<string, string>

  constructor(
    initial: ScriptVariable[],
    private readonly scope: Exclude<VariableMutation['scope'], never> | 'data',
    private readonly mutations: VariableMutation[],
    private readonly resolve: (s: string) => string,
    readonly name?: string
  ) {
    this.values = new Map(initial.map((v) => [v.key, v.value]))
  }

  get(key: string): string | undefined {
    return this.values.get(key)
  }
  has(key: string): boolean {
    return this.values.has(key)
  }
  set(key: string, value: unknown): void {
    if (this.scope === 'data') throw new TypeError('Les données d’itération sont en lecture seule.')
    const v = toVarValue(value)
    this.values.set(String(key), v)
    this.mutations.push({ scope: this.scope, op: 'set', key: String(key), value: v })
  }
  unset(key: string): void {
    if (this.scope === 'data') throw new TypeError('Les données d’itération sont en lecture seule.')
    this.values.delete(key)
    this.mutations.push({ scope: this.scope, op: 'unset', key })
  }
  clear(): void {
    if (this.scope === 'data') throw new TypeError('Les données d’itération sont en lecture seule.')
    this.values.clear()
    this.mutations.push({ scope: this.scope, op: 'clear' })
  }
  toObject(): Record<string, string> {
    return Object.fromEntries(this.values)
  }
  replaceIn(template: string): string {
    return this.resolve(String(template))
  }
  entries(): Array<[string, string]> {
    return [...this.values]
  }
}

const VAR_PATTERN = /\{\{([^{}]+?)\}\}/g

// --- Exécution -----------------------------------------------------------------------------------

export async function runScripts(exec: ScriptExecution, hooks: RuntimeHooks): Promise<ScriptOutcome> {
  installChaiPlugin()
  const mutations: VariableMutation[] = []
  const tests: TestResult[] = []
  const logs: ScriptLog[] = []
  const sentRequests: ScriptOutcome['sentRequests'] = []
  let skipRequest = false
  let nextRequest: string | null | undefined
  let source = ''
  const setNextRequest = (target: unknown) => {
    nextRequest = target === null ? null : String(target)
  }

  // Priorité : locale > données > environnement > collection > globales.
  const resolveIn = (text: string): string => {
    let current = text
    for (let depth = 0; depth < 10 && current.includes('{{'); depth++) {
      let changed = false
      current = current.replace(VAR_PATTERN, (m, name: string) => {
        const key = name.trim()
        for (const s of scopeOrder) {
          if (s.has(key)) {
            changed = true
            return s.get(key) ?? ''
          }
        }
        return m
      })
      if (!changed) break
    }
    return current
  }

  const v = exec.variables
  const local = new VariableScope(v.local, 'local', mutations, resolveIn)
  const data = new VariableScope(v.data, 'data', mutations, resolveIn)
  const environment = new VariableScope(v.environment, 'environment', mutations, resolveIn, v.environmentName)
  const collectionVariables = new VariableScope(v.collectionVariables, 'collectionVariables', mutations, resolveIn)
  const globals = new VariableScope(v.globals, 'globals', mutations, resolveIn)
  const scopeOrder = [local, data, environment, collectionVariables, globals]

  const variables = {
    get: (key: string) => {
      for (const s of scopeOrder) if (s.has(key)) return s.get(key)
      return undefined
    },
    has: (key: string) => scopeOrder.some((s) => s.has(key)),
    set: (key: string, value: unknown) => local.set(key, value),
    unset: (key: string) => local.unset(key),
    toObject: () => Object.assign({}, ...[...scopeOrder].reverse().map((s) => s.toObject())) as Record<string, string>,
    replaceIn: (template: string) => resolveIn(String(template))
  }

  const request = new ScriptRequestObject(exec.request)
  const response = exec.response ? new ScriptResponseObject(exec.response) : undefined

  // Suivi des tâches asynchrones (minuteries, pm.sendRequest, tests asynchrones).
  let pending = 0
  let idleResolvers: Array<() => void> = []
  const begin = () => {
    pending++
  }
  const end = () => {
    pending--
    if (pending === 0) {
      const r = idleResolvers
      idleResolvers = []
      r.forEach((fn) => fn())
    }
  }
  const whenIdle = () => (pending === 0 ? Promise.resolve() : new Promise<void>((r) => idleResolvers.push(r)))
  let asyncError: unknown = null

  const timers = new Map<unknown, { interval: boolean }>()
  const wrapCallback = (fn: unknown) => () => {
    try {
      if (typeof fn === 'function') (fn as () => void)()
    } catch (err) {
      asyncError ??= err
    }
  }
  const sandboxSetTimeout = (fn: unknown, ms?: number) => {
    begin()
    const handle = setTimeout(() => {
      timers.delete(handle)
      wrapCallback(fn)()
      end()
    }, ms)
    timers.set(handle, { interval: false })
    return handle
  }
  const sandboxClearTimeout = (handle: unknown) => {
    if (timers.has(handle)) {
      clearTimeout(handle as ReturnType<typeof setTimeout>)
      timers.delete(handle)
      end()
    }
  }
  const sandboxSetInterval = (fn: unknown, ms?: number) => {
    begin()
    const handle = setInterval(wrapCallback(fn), Math.max(1, ms ?? 0))
    timers.set(handle, { interval: true })
    return handle
  }
  const sandboxClearInterval = (handle: unknown) => {
    if (timers.has(handle)) {
      clearInterval(handle as ReturnType<typeof setInterval>)
      timers.delete(handle)
      end()
    }
  }

  const log = (level: LogLevel) => (...args: unknown[]) => {
    logs.push({ level, message: args.map(stringify).join(' '), source })
  }
  const console = { log: log('log'), info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') }

  function toSandboxRequest(input: unknown): SandboxHttpRequest {
    if (typeof input === 'string') return { method: 'GET', url: input, headers: [] }
    if (input instanceof ScriptRequestObject) {
      const j = input.toJSON()
      return { method: j.method, url: j.url, headers: j.headers, body: j.body }
    }
    const o = (input ?? {}) as Record<string, unknown>
    let headers: ScriptKeyValue[] = []
    const h = o['header'] ?? o['headers']
    if (Array.isArray(h)) headers = h.map((x: { key: string; value: unknown }) => ({ key: String(x.key), value: toVarValue(x.value) }))
    else if (h && typeof h === 'object') headers = Object.entries(h).map(([key, value]) => ({ key, value: toVarValue(value) }))
    let body: ScriptRequest['body'] | undefined
    const b = o['body'] as Record<string, unknown> | undefined
    if (b && typeof b === 'object') {
      if (b['mode'] === 'raw') body = { mode: 'raw', raw: toVarValue(b['raw']) }
      else if (b['mode'] === 'urlencoded' && Array.isArray(b['urlencoded'])) body = { mode: 'urlencoded', urlencoded: b['urlencoded'] as ScriptKeyValue[] }
      else if (b['mode'] === 'formdata' && Array.isArray(b['formdata'])) body = { mode: 'formdata', formdata: b['formdata'] as ScriptKeyValue[] }
    }
    const url = o['url']
    return {
      method: String(o['method'] ?? 'GET').toUpperCase(),
      url: typeof url === 'string' ? url : url && typeof url === 'object' && 'raw' in url ? String((url as { raw: unknown }).raw) : String(url ?? ''),
      headers,
      body
    }
  }

  const sendRequest = (input: unknown, callback?: (err: unknown, res?: ScriptResponseObject) => void): Promise<ScriptResponseObject> => {
    const req = toSandboxRequest(input)
    req.url = resolveIn(req.url)
    begin()
    const entry: ScriptOutcome['sentRequests'][number] = { method: req.method, url: req.url }
    sentRequests.push(entry)
    const p = hooks.sendRequest(req).then((r) => {
      if (!r.ok) {
        entry.error = r.error
        throw new Error(r.error)
      }
      entry.status = r.response.code
      return new ScriptResponseObject(r.response)
    })
    p.then(
      (res) => {
        if (callback) wrapCallback(() => callback(null, res))()
        end()
      },
      (err) => {
        if (callback) wrapCallback(() => callback(err))()
        end()
      }
    )
    // Avec un callback, la promesse rejetée ne doit pas remonter comme erreur non gérée.
    if (callback) p.catch(() => undefined)
    return p
  }

  const testFn = (name: string, fn?: (done?: (err?: unknown) => void) => unknown): void => {
    const result: TestResult = { name: String(name), passed: true }
    tests.push(result)
    if (typeof fn !== 'function') return
    const fail = (err: unknown) => {
      result.passed = false
      result.error = errorText(err)
    }
    try {
      if (fn.length > 0) {
        // Test asynchrone à callback `done`.
        begin()
        let finished = false
        fn((err?: unknown) => {
          if (finished) return
          finished = true
          if (err) fail(err)
          end()
        })
        return
      }
      const r = fn()
      if (r && typeof (r as Promise<unknown>).then === 'function') {
        begin()
        ;(r as Promise<unknown>).then(
          () => end(),
          (err) => {
            fail(err)
            end()
          }
        )
      }
    } catch (err) {
      fail(err)
    }
  }
  testFn.skip = (name: string) => {
    tests.push({ name: String(name), passed: true, skipped: true })
  }

  const libraries = hooks.libraries ?? {}
  const modules: Record<string, unknown> = {
    chai,
    uuid: { v4: () => crypto.randomUUID() },
    ...libraries
  }
  const requireFn = (name: string) => {
    if (name in modules) return modules[name]
    throw new Error(`Le module « ${name} » n'est pas disponible dans le sandbox Endora.`)
  }

  const pm = {
    info: {
      eventName: exec.event,
      iteration: exec.info.iteration,
      iterationCount: exec.info.iterationCount,
      requestName: exec.info.requestName,
      requestId: exec.info.requestId
    },
    variables,
    environment: Object.assign(environment, { name: v.environmentName }),
    globals,
    collectionVariables,
    iterationData: data,
    request,
    response,
    test: testFn,
    expect: chai.expect,
    sendRequest,
    execution: {
      location: exec.info.location ?? [exec.info.requestName],
      ...(exec.event === 'prerequest'
        ? {
            skipRequest: () => {
              skipRequest = true
            }
          }
        : {}),
      setNextRequest
    },
    visualizer: { set: () => undefined, clear: () => undefined },
    cookies: new KeyValueList([], false)
  }

  // Ancienne API, encore présente dans de nombreuses collections.
  const legacyTests: Record<string, unknown> = {}
  const postman = {
    setEnvironmentVariable: (k: string, val: unknown) => environment.set(k, val),
    getEnvironmentVariable: (k: string) => environment.get(k),
    clearEnvironmentVariable: (k: string) => environment.unset(k),
    clearEnvironmentVariables: () => environment.clear(),
    setGlobalVariable: (k: string, val: unknown) => globals.set(k, val),
    getGlobalVariable: (k: string) => globals.get(k),
    clearGlobalVariable: (k: string) => globals.unset(k),
    clearGlobalVariables: () => globals.clear(),
    getResponseHeader: (k: string) => response?.headers.get(k),
    setNextRequest
  }

  const globalsForScript: Record<string, unknown> = {
    pm,
    postman,
    console,
    require: requireFn,
    tests: legacyTests,
    request: request.toJSON(),
    environment: environment.toObject(),
    globals: globals.toObject(),
    data: data.toObject(),
    iteration: exec.info.iteration,
    responseBody: response ? response.text() : undefined,
    responseCode: response ? { code: response.code, name: response.status } : undefined,
    responseHeaders: response ? response.headers.toObject() : undefined,
    responseTime: response?.responseTime,
    setTimeout: sandboxSetTimeout,
    clearTimeout: sandboxClearTimeout,
    setInterval: sandboxSetInterval,
    clearInterval: sandboxClearInterval,
    _: libraries['lodash'],
    CryptoJS: libraries['crypto-js'],
    atob: (s: string) => atob(s),
    btoa: (s: string) => btoa(s)
  }
  const names = Object.keys(globalsForScript)
  const compile = hooks.compile ?? ((params: string[], body: string) => new Function(...params, body) as (...args: unknown[]) => unknown)

  let error: ScriptOutcome['error']
  for (const script of exec.scripts) {
    if (script.code.trim() === '') continue
    source = script.source
    try {
      const fn = compile(names, `return (async () => {\n${script.code}\n})()`)
      await fn(...names.map((n) => globalsForScript[n]))
      await whenIdle()
      if (asyncError) throw asyncError
    } catch (err) {
      error = { message: errorText(err), source: script.source }
      break
    } finally {
      // Les intervalles oubliés ne doivent pas bloquer la fin de l'exécution.
      for (const [handle, t] of timers) (t.interval ? clearInterval : clearTimeout)(handle as ReturnType<typeof setTimeout>)
      timers.clear()
      pending = 0
      idleResolvers = []
      asyncError = null
    }
  }

  for (const [name, value] of Object.entries(legacyTests)) tests.push({ name, passed: Boolean(value), ...(value ? {} : { error: 'échec' }) })

  return {
    ok: !error,
    ...(error ? { error } : {}),
    request: request.toJSON(),
    mutations,
    tests,
    logs,
    skipRequest,
    ...(nextRequest !== undefined ? { nextRequest } : {}),
    sentRequests
  }
}
