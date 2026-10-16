import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { UpdaterState } from '@shared/updates'
import { AutoUpdate, type UpdaterLike } from './autoupdate'

/** Faux electron-updater : la version publiée et le comportement réseau sont pilotés par le test. */
class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = true
  autoInstallOnAppQuit = false
  latest: string | null = null
  offline = false
  downloads = 0
  installed = false

  async checkForUpdates() {
    this.emit('checking-for-update')
    if (this.offline) {
      const err = new Error('net::ERR_INTERNET_DISCONNECTED')
      this.emit('error', err)
      throw err
    }
    if (this.latest) this.emit('update-available', { version: this.latest, releaseNotes: '<p>Correctif</p>' })
    else this.emit('update-not-available', {})
  }

  async downloadUpdate() {
    this.downloads++
    this.emit('download-progress', { percent: 50 })
    this.emit('update-downloaded', { version: this.latest })
  }

  quitAndInstall() {
    this.installed = true
  }
}

function setup(autoInstall = true) {
  const updater = new FakeUpdater()
  const states: UpdaterState[] = []
  const service = new AutoUpdate({ updater, currentVersion: '0.2.2', settings: () => ({ autoCheck: true, autoInstall }), emit: (s) => states.push(s) })
  return { updater, states, service }
}

describe('AutoUpdate', () => {
  it('configure electron-updater : pas de téléchargement implicite, installation à la fermeture', () => {
    const { updater } = setup()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })

  it('petite mise à jour en arrière-plan : téléchargée toute seule', async () => {
    const { updater, service } = setup()
    updater.latest = '0.2.3'
    await service.check(false)
    expect(updater.downloads).toBe(1)
    expect(service.current).toMatchObject({ status: 'downloaded', version: '0.2.3', size: 'small', auto: true, notes: 'Correctif' })
    expect(updater.installed).toBe(false)
  })

  it('petite mise à jour, réglage désactivé : seulement signalée', async () => {
    const { updater, service } = setup(false)
    updater.latest = '0.2.3'
    await service.check(false)
    expect(updater.downloads).toBe(0)
    expect(service.current).toMatchObject({ status: 'available', size: 'small', auto: false })
  })

  it('grosse mise à jour : jamais installée sans action de l’utilisateur', async () => {
    const { updater, service } = setup()
    updater.latest = '0.3.0'
    await service.check(false)
    expect(updater.downloads).toBe(0)
    expect(service.current).toMatchObject({ status: 'available', version: '0.3.0', size: 'major' })
    await service.install()
    expect(updater.downloads).toBe(1)
    expect(updater.installed).toBe(true)
  })

  it('vérification manuelle : rien n’est téléchargé tout seul, même une petite mise à jour', async () => {
    const { updater, service } = setup()
    updater.latest = '0.2.3'
    await service.check(true)
    expect(updater.downloads).toBe(0)
    expect(service.current.status).toBe('available')
  })

  it('hors ligne : silencieux en arrière-plan, erreur affichée pour une vérification manuelle', async () => {
    const { updater, service } = setup()
    updater.offline = true
    await service.check(false)
    expect(service.current.status).not.toBe('error')
    await service.check(true)
    expect(service.current).toMatchObject({ status: 'error', message: 'net::ERR_INTERNET_DISCONNECTED' })
  })

  it('à jour : état « none »', async () => {
    const { service } = setup()
    await service.check(true)
    expect(service.current.status).toBe('none')
  })

  it('sans updater (développement, format non pris en charge) : « unsupported »', async () => {
    const service = new AutoUpdate({ updater: null, currentVersion: '0.2.2', settings: () => ({ autoCheck: true, autoInstall: true }), emit: () => {} })
    expect((await service.check(true)).status).toBe('unsupported')
  })
})
