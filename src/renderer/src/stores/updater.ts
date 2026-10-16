// État des mises à jour automatiques (géré par le process principal) et notifications associées.

import { create } from 'zustand'
import { t } from '@shared/i18n'
import type { UpdaterState } from '@shared/updates'
import { useNotifications } from './notifications'

interface UpdaterStore {
  state: UpdaterState
  check: () => Promise<void>
  install: () => Promise<void>
}

export const useUpdater = create<UpdaterStore>((set) => ({
  state: { status: 'idle' },
  check: async () => set({ state: await window.endora.updaterCheck() }),
  install: async () => window.endora.updaterInstall()
}))

/** Notifications : mise à jour prête (petite, téléchargée seule) ou disponible (à installer). */
function notify(state: UpdaterState): void {
  const { version } = state
  if (!version) return
  const store = useNotifications.getState()
  const install = () => void useUpdater.getState().install()
  if (state.status === 'downloaded') {
    store.upsert({
      id: `update-${version}`,
      title: t('update.readyTitle', { version }),
      body: t('update.readyBody'),
      actions: [{ label: t('update.restart'), run: install, primary: true }]
    })
  } else if (state.status === 'available' && !state.auto) {
    store.upsert({
      id: `update-${version}`,
      title: t('notify.updateTitle', { version }),
      body: state.size === 'major' ? t('update.majorBody') : t('update.smallBody'),
      actions: [{ label: t('update.install'), run: install, primary: true }]
    })
  }
}

/** Suit l'updater du process principal (à appeler une fois au démarrage). */
export function startUpdaterEvents(): () => void {
  void window.endora.updaterState().then((state) => {
    useUpdater.setState({ state })
    notify(state)
  })
  return window.endora.onUpdaterState((state) => {
    const previous = useUpdater.getState().state
    useUpdater.setState({ state })
    if (state.status !== previous.status || state.version !== previous.version) notify(state)
  })
}

/** L'app empaquetée gère ses mises à jour ; sinon (développement…) repli sur la simple vérification. */
export const updaterSupported = (): boolean => useUpdater.getState().state.status !== 'unsupported'
