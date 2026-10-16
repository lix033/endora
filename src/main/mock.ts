// Mock servers locaux : un serveur HTTP par mock, réponses tirées des exemples de la collection,
// script de mock exécuté dans le sandbox. Voir @shared/mock pour le comportement de référence.

import { randomBytes, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces } from 'node:os'
import type { StorageResult } from '@shared/api'
import { importCollection } from '@shared/collection-v21'
import {
  buildRoutes,
  MOCK_BASE_PORT,
  MOCK_HEADERS,
  mockInfo,
  matchRoute,
  pickExample,
  sessionFromHeader,
  SHARED_SESSION,
  type MockActionResult,
  type MockConfig,
  type MockEvent,
  type MockLogEntry,
  type MockPatch,
  type MockRoute,
  type MockState,
  type NewMockInput
} from '@shared/mock'
import type { MockResponseData, MockScriptInput, MockScriptOutput } from '@shared/scripting/mock-runtime'

const MAX_BODY_BYTES = 1024 * 1024
const LOG_LIMIT = 200
const SCRIPT_TIMEOUT_MS = 5_000

export interface MockDeps {
  /** Collection v2.1 telle qu'enregistrée, ou `null` si elle n'existe plus. */
  readCollection(id: string): Promise<unknown>
  runScript(input: MockScriptInput, timeoutMs: number): Promise<MockScriptOutput>
  save(configs: MockConfig[]): Promise<void>
  emit(event: MockEvent): void
}

interface Runtime {
  server: Server
  routes: MockRoute[]
  collectionName?: string
  /** État `pm.state` par session. */
  state: Map<string, Record<string, unknown>>
}

const fail = (message: string): MockActionResult => ({ ok: false, message })
const json = (value: unknown): string => JSON.stringify(value, null, 2)

/** Adresse IPv4 du réseau local, pour l'URL d'un mock public. */
function lanAddress(): string | null {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return null
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('listening', onListening)
      reject(err)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
}

async function portFree(port: number, host: string): Promise<boolean> {
  const probe = createServer()
  try {
    await listen(probe, port, host)
    await new Promise((r) => probe.close(r))
    return true
  } catch {
    return false
  }
}

export class MockManager {
  private readonly configs = new Map<string, MockConfig>()
  private readonly runtimes = new Map<string, Runtime>()
  private readonly errors = new Map<string, string>()
  private readonly logs = new Map<string, MockLogEntry[]>()

  constructor(private readonly deps: MockDeps) {}

  /** Charge les mocks enregistrés et relance ceux qui tournaient. */
  async init(configs: MockConfig[]): Promise<void> {
    for (const c of configs) this.configs.set(c.id, c)
    for (const c of configs) if (c.enabled) await this.startRuntime(c)
    this.deps.emit({ type: 'changed' })
  }

  list(): MockState[] {
    return [...this.configs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((c) => this.state(c))
  }

  private state(c: MockConfig): MockState {
    const rt = this.runtimes.get(c.id)
    const lan = c.publicAccess ? lanAddress() : null
    return {
      config: mockInfo(c),
      running: rt !== undefined,
      url: `http://localhost:${c.port}`,
      ...(lan ? { networkUrl: `http://${lan}:${c.port}` } : {}),
      ...(rt?.collectionName ? { collectionName: rt.collectionName } : {}),
      routes: rt?.routes.length ?? 0,
      examples: rt?.routes.reduce((n, r) => n + r.examples.length, 0) ?? 0,
      ...(this.errors.has(c.id) ? { error: this.errors.get(c.id)! } : {})
    }
  }

  private result(id: string): MockActionResult {
    const c = this.configs.get(id)
    return c ? { ok: true, mock: this.state(c) } : fail('Mock introuvable.')
  }

  private async persist(): Promise<void> {
    await this.deps.save([...this.configs.values()])
    this.deps.emit({ type: 'changed' })
  }

  /** Premier port libre à partir de 4010, hors ports déjà attribués à d'autres mocks. */
  private async allocatePort(host: string, exclude?: string): Promise<number> {
    const taken = new Set([...this.configs.values()].filter((c) => c.id !== exclude).map((c) => c.port))
    for (let port = MOCK_BASE_PORT; port < MOCK_BASE_PORT + 1000; port++) {
      if (!taken.has(port) && (await portFree(port, host))) return port
    }
    throw new Error('Aucun port libre trouvé.')
  }

  async create(input: NewMockInput): Promise<MockActionResult> {
    const raw = await this.deps.readCollection(input.collectionId)
    if (raw == null) return fail('Collection introuvable.')
    const host = input.publicAccess ? '0.0.0.0' : '127.0.0.1'
    let port: number
    try {
      port = await this.allocatePort(host)
    } catch (err) {
      return fail((err as Error).message)
    }
    const now = new Date().toISOString()
    const config: MockConfig = {
      id: randomUUID(),
      name: input.name.trim() || 'Mock',
      collectionId: input.collectionId,
      port,
      publicAccess: input.publicAccess,
      apiKey: randomBytes(18).toString('base64url'),
      autoDeploy: input.autoDeploy,
      enableSession: input.enableSession,
      script: '',
      enabled: true,
      createdAt: now,
      deployedAt: now,
      snapshot: input.autoDeploy ? null : raw
    }
    this.configs.set(config.id, config)
    await this.startRuntime(config)
    await this.persist()
    return this.result(config.id)
  }

  async update(id: string, patch: MockPatch): Promise<MockActionResult> {
    const c = this.configs.get(id)
    if (!c) return fail('Mock introuvable.')
    const next: MockConfig = { ...c, ...patch, name: patch.name !== undefined ? patch.name.trim() || c.name : c.name }
    // Passage en déploiement manuel : on fige la version courante.
    if (c.autoDeploy && !next.autoDeploy) {
      next.snapshot = await this.deps.readCollection(c.collectionId)
      next.deployedAt = new Date().toISOString()
    }
    if (!c.autoDeploy && next.autoDeploy) next.snapshot = null
    this.configs.set(id, next)
    const rt = this.runtimes.get(id)
    if (rt && next.publicAccess !== c.publicAccess) {
      await this.stopRuntime(id)
      await this.startRuntime(next)
    } else if (rt && next.autoDeploy !== c.autoDeploy) await this.reload(next)
    await this.persist()
    return this.result(id)
  }

  async remove(id: string): Promise<StorageResult> {
    if (!this.configs.has(id)) return { ok: false, message: 'Mock introuvable.' }
    await this.stopRuntime(id)
    this.configs.delete(id)
    this.logs.delete(id)
    this.errors.delete(id)
    await this.persist()
    return { ok: true }
  }

  async start(id: string): Promise<MockActionResult> {
    const c = this.configs.get(id)
    if (!c) return fail('Mock introuvable.')
    c.enabled = true
    if (!this.runtimes.has(id)) await this.startRuntime(c)
    await this.persist()
    return this.errors.has(id) ? fail(this.errors.get(id)!) : this.result(id)
  }

  async stop(id: string): Promise<MockActionResult> {
    const c = this.configs.get(id)
    if (!c) return fail('Mock introuvable.')
    c.enabled = false
    await this.stopRuntime(id)
    this.errors.delete(id)
    await this.persist()
    return this.result(id)
  }

  /** Déploiement manuel : sert la version enregistrée de la collection. */
  async deploy(id: string): Promise<MockActionResult> {
    const c = this.configs.get(id)
    if (!c) return fail('Mock introuvable.')
    const raw = await this.deps.readCollection(c.collectionId)
    if (raw == null) return fail('Collection introuvable.')
    c.deployedAt = new Date().toISOString()
    if (!c.autoDeploy) c.snapshot = raw
    if (this.runtimes.has(id)) await this.reload(c)
    await this.persist()
    return this.result(id)
  }

  getLogs(id: string): MockLogEntry[] {
    return this.logs.get(id) ?? []
  }

  clearLogs(id: string): void {
    this.logs.delete(id)
  }

  /** Vide l'état `pm.state` de toutes les sessions. */
  resetState(id: string): void {
    this.runtimes.get(id)?.state.clear()
  }

  /** Une collection vient d'être enregistrée : les mocks en déploiement automatique la servent. */
  async collectionSaved(collectionId: string): Promise<void> {
    let changed = false
    for (const c of this.configs.values()) {
      if (c.collectionId !== collectionId || !c.autoDeploy || !this.runtimes.has(c.id)) continue
      c.deployedAt = new Date().toISOString()
      await this.reload(c)
      changed = true
    }
    if (changed) await this.persist()
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.runtimes.keys()].map((id) => this.stopRuntime(id)))
  }

  // --- Exécution -------------------------------------------------------------------------------

  private async collectionOf(c: MockConfig): Promise<{ routes: MockRoute[]; name: string } | null> {
    const raw = c.autoDeploy || c.snapshot == null ? await this.deps.readCollection(c.collectionId) : c.snapshot
    if (raw == null) return null
    const imported = importCollection(raw, { keepIds: true })
    return imported.ok ? { routes: buildRoutes(imported.collection), name: imported.collection.name } : null
  }

  private async reload(c: MockConfig): Promise<void> {
    const rt = this.runtimes.get(c.id)
    if (!rt) return
    const col = await this.collectionOf(c)
    if (!col) {
      this.errors.set(c.id, 'Collection introuvable : le mock ne répond plus qu’avec des erreurs 404.')
      rt.routes = []
      delete rt.collectionName
      return
    }
    this.errors.delete(c.id)
    rt.routes = col.routes
    rt.collectionName = col.name
  }

  private async startRuntime(c: MockConfig): Promise<void> {
    this.errors.delete(c.id)
    const server = createServer((req, res) => void this.handle(c.id, req, res))
    try {
      await listen(server, c.port, c.publicAccess ? '0.0.0.0' : '127.0.0.1')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      this.errors.set(c.id, code === 'EADDRINUSE' ? `Le port ${c.port} est déjà utilisé par une autre application.` : (err as Error).message)
      return
    }
    this.runtimes.set(c.id, { server, routes: [], state: new Map() })
    await this.reload(c)
  }

  private async stopRuntime(id: string): Promise<void> {
    const rt = this.runtimes.get(id)
    if (!rt) return
    this.runtimes.delete(id)
    rt.server.closeAllConnections()
    await new Promise((r) => rt.server.close(r))
  }

  private async handle(id: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = performance.now()
    const c = this.configs.get(id)
    const rt = this.runtimes.get(id)
    const url = new URL(req.url ?? '/', 'http://mock.local')
    const method = (req.method ?? 'GET').toUpperCase()
    const entry: MockLogEntry = { id: randomUUID(), mockId: id, time: new Date().toISOString(), method, path: url.pathname, status: 500, durationMs: 0, session: SHARED_SESSION }
    let scriptLogs: MockScriptOutput['logs'] = []

    const finish = (r: MockResponseData) => {
      // Les mocks servent souvent un front-end local : réponses lisibles depuis un navigateur.
      const headers: Record<string, string> = { 'Access-Control-Allow-Origin': '*', ...r.headers }
      if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type') && r.body !== '') headers['Content-Type'] = 'text/plain; charset=utf-8'
      try {
        res.writeHead(r.status, headers)
        res.end(method === 'HEAD' ? undefined : r.body)
      } catch (err) {
        if (!res.headersSent) res.writeHead(500).end()
        entry.error = (err as Error).message
      }
      entry.status = r.status
      entry.durationMs = Math.round(performance.now() - started)
      this.record(id, entry, scriptLogs)
    }
    const error = (status: number, body: Record<string, unknown>) =>
      finish({ status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: json(body) })

    if (!c || !rt) return error(503, { error: 'Mock arrêté.' })

    if (method === 'OPTIONS' && req.headers['access-control-request-method']) {
      return finish({
        status: 204,
        headers: {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': String(req.headers['access-control-request-headers'] ?? '*'),
          'Access-Control-Max-Age': '600'
        },
        body: ''
      })
    }

    if (!c.publicAccess && req.headers[MOCK_HEADERS.key] !== c.apiKey) {
      return error(401, { error: 'Mock privé : clé absente ou invalide.', hint: `Ajoutez l’en-tête ${MOCK_HEADERS.key}.` })
    }

    let body: string
    try {
      body = await readBody(req)
    } catch {
      return error(413, { error: 'Body trop volumineux (1 Mo maximum).' })
    }

    const session = sessionFromHeader(req.headers[MOCK_HEADERS.session], c.enableSession)
    entry.session = session
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v

    const match = matchRoute(rt.routes, method, url.pathname)
    const example = match ? pickExample(match.route, headers, url.searchParams) : null
    let response: MockResponseData
    if (example) {
      response = { status: example.code, headers: Object.fromEntries(example.headers.map((h) => [h.key, h.value])), body: example.body }
      entry.route = match!.route.name
      entry.example = example.name
    } else if (match) {
      entry.route = match.route.name
      response = {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: json({ error: `Aucun exemple enregistré pour « ${match.route.name} ».`, hint: 'Envoyez la requête puis « Enregistrer comme exemple ».' })
      }
    } else {
      response = {
        status: 404,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: json({ error: 'Aucune requête de la collection ne correspond.', method, path: url.pathname })
      }
    }

    if (c.script.trim() !== '') {
      const query: Record<string, string> = {}
      for (const [k, v] of url.searchParams) query[k] = v
      const out = await this.deps.runScript(
        {
          id: entry.id,
          script: c.script,
          request: { method, path: url.pathname, url: req.url ?? '/', query, headers, params: match?.params ?? {}, body },
          session,
          route: match ? { name: match.route.name, example: example?.name ?? null } : null,
          state: rt.state.get(session) ?? {},
          response
        },
        SCRIPT_TIMEOUT_MS
      )
      scriptLogs = out.logs
      if (!out.ok) {
        entry.error = out.error
        return error(500, { error: 'Erreur dans le script du mock.', message: out.error })
      }
      rt.state.set(session, out.state)
      response = out.response
    }
    finish(response)
  }

  private record(id: string, entry: MockLogEntry, scriptLogs: MockScriptOutput['logs']): void {
    if (scriptLogs.length > 0) entry.logs = scriptLogs.slice(0, 50).map((l) => ({ level: l.level, message: l.message.slice(0, 2000) }))
    const list = this.logs.get(id) ?? []
    list.unshift(entry)
    if (list.length > LOG_LIMIT) list.length = LOG_LIMIT
    this.logs.set(id, list)
    this.deps.emit({ type: 'log', entry })
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
