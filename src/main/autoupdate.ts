// Mises à jour automatiques (electron-updater, release GitHub publiée par la CI).
// - au démarrage puis toutes les 6 heures, si la vérification automatique est active ;
// - petite mise à jour (correctif) + réglage « installer automatiquement » : téléchargée en
//   silence, installée à la fermeture de l'app ;
// - grosse mise à jour : seulement signalée, l'utilisateur l'installe lui-même.
// Sans connexion, une vérification échoue en silence et sera retentée plus tard.

import { plainNotes, updateSize, type UpdaterState } from '@shared/updates'

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 10_000

/** Sous-ensemble d'`autoUpdater` (electron-updater) utilisé ici. */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
  // Signature d'EventEmitter : les arguments dépendent de l'événement.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown
}

interface UpdateInfoLike {
  version: string
  releaseNotes?: unknown
  releaseDate?: string
}

export interface AutoUpdateOptions {
  updater: UpdaterLike | null
  currentVersion: string
  /** Réglages lus à chaque vérification (ils peuvent changer pendant l'exécution). */
  settings: () => { autoCheck: boolean; autoInstall: boolean }
  emit: (state: UpdaterState) => void
}

export class AutoUpdate {
  private state: UpdaterState
  /** Vérification lancée par l'app (pas par l'utilisateur) : silencieuse. */
  private background = false
  private installWhenReady = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly opts: AutoUpdateOptions) {
    this.state = { status: opts.updater ? 'idle' : 'unsupported' }
    const u = opts.updater
    if (!u) return
    u.autoDownload = false
    u.autoInstallOnAppQuit = true
    u.on('checking-for-update', () => this.set({ status: 'checking' }))
    u.on('update-not-available', () => this.set({ status: 'none', checkedAt: new Date().toISOString() }))
    u.on('update-available', (info: UpdateInfoLike) => this.available(info))
    u.on('download-progress', (p: { percent?: number }) =>
      this.set({ ...this.state, status: 'downloading', percent: Math.max(0, Math.min(100, Math.round(p.percent ?? 0))) })
    )
    u.on('update-downloaded', (info: UpdateInfoLike) => {
      this.set({ ...this.state, status: 'downloaded', version: info.version, percent: 100 })
      if (this.installWhenReady) this.install()
    })
    u.on('error', (err: Error) => {
      // Vérification de fond hors ligne : on garde l'état précédent, nouvel essai plus tard.
      if (this.background && this.state.status !== 'downloading') return this.set({ ...this.state, status: this.state.version ? this.state.status : 'idle' })
      this.set({ ...this.state, status: 'error', message: err?.message ?? String(err) })
    })
  }

  get current(): UpdaterState {
    return this.state
  }

  private set(state: UpdaterState): void {
    this.state = state
    this.opts.emit(state)
  }

  private available(info: UpdateInfoLike): void {
    const size = updateSize(this.opts.currentVersion, info.version)
    const notes = plainNotes(info.releaseNotes)
    const auto = size === 'small' && this.background && this.opts.settings().autoInstall
    this.set({
      status: 'available',
      version: info.version,
      size,
      auto,
      checkedAt: new Date().toISOString(),
      ...(notes ? { notes } : {}),
      ...(info.releaseDate ? { releaseDate: info.releaseDate } : {})
    })
    if (auto) void this.download()
  }

  /** Démarre les vérifications périodiques (si activées dans les réglages). */
  start(): void {
    if (!this.opts.updater || this.timer) return
    const tick = () => {
      if (this.opts.settings().autoCheck) void this.check(false)
    }
    setTimeout(tick, FIRST_CHECK_DELAY_MS)
    this.timer = setInterval(tick, CHECK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async check(manual: boolean): Promise<UpdaterState> {
    const u = this.opts.updater
    if (!u) return this.state
    // Une mise à jour déjà prête ou en cours n'est pas revérifiée.
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return this.state
    this.background = !manual
    try {
      await u.checkForUpdates()
    } catch (err) {
      if (manual) this.set({ ...this.state, status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return this.state
  }

  private async download(): Promise<void> {
    const u = this.opts.updater
    if (!u) return
    this.set({ ...this.state, status: 'downloading', percent: 0 })
    try {
      await u.downloadUpdate()
    } catch (err) {
      this.set({ ...this.state, status: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  /** Installe maintenant : télécharge si besoin, puis redémarre l'app sur la nouvelle version. */
  async install(): Promise<void> {
    const u = this.opts.updater
    if (!u) return
    if (this.state.status === 'downloaded') {
      u.quitAndInstall(false, true)
      return
    }
    this.installWhenReady = true
    if (this.state.status !== 'downloading') await this.download()
  }
}
