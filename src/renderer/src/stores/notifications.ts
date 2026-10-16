// Notifications de l'application (cloche de la barre du haut). Pour l'instant : mises à jour
// disponibles. Non persistées : la vérification au démarrage les recrée.

import { create } from 'zustand'
import type { UpdateCheckResult } from '@shared/api'
import { t } from '@shared/i18n'

export interface AppNotification {
  /** Identifiant stable : une même notification n'est ajoutée qu'une fois. */
  id: string
  title: string
  body?: string
  /** Page de téléchargement ou de détails. */
  url?: string
  /** Boutons d'action (installer, redémarrer…), affichés avant « Détails ». */
  actions?: Array<{ label: string; run: () => void; primary?: boolean }>
  createdAt: string
  read: boolean
}

interface NotificationsState {
  items: AppNotification[]
  add: (n: Omit<AppNotification, 'createdAt' | 'read'>) => boolean
  /** Ajoute ou remplace (même identifiant), non lue. */
  upsert: (n: Omit<AppNotification, 'createdAt' | 'read'>) => void
  markAllRead: () => void
  dismiss: (id: string) => void
}

export const useNotifications = create<NotificationsState>((set, get) => ({
  items: [],

  add: (n) => {
    if (get().items.some((i) => i.id === n.id)) return false
    set({ items: [{ ...n, createdAt: new Date().toISOString(), read: false }, ...get().items] })
    return true
  },

  upsert: (n) => set({ items: [{ ...n, createdAt: new Date().toISOString(), read: false }, ...get().items.filter((i) => i.id !== n.id)] }),

  markAllRead: () => {
    if (get().items.every((i) => i.read)) return
    set({ items: get().items.map((i) => (i.read ? i : { ...i, read: true })) })
  },

  dismiss: (id) => set({ items: get().items.filter((i) => i.id !== id) })
}))

/** Ajoute la notification « mise à jour disponible » ; renvoie `true` si elle est nouvelle. */
export function notifyUpdate(result: UpdateCheckResult): boolean {
  if (!result.ok || !result.updateAvailable) return false
  return useNotifications.getState().add({
    id: `update-${result.latest}`,
    title: t('notify.updateTitle', { version: result.latest }),
    body: t('notify.updateBody', { current: result.current }),
    ...(result.url ? { url: result.url } : {})
  })
}
