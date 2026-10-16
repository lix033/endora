// Réglages côté interface : édition, persistance et application du thème.

import { create } from 'zustand'
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '@shared/settings'
import { activeTheme, isThemeId, THEMES, themeCssVariables, type Theme } from '@shared/themes'
import { t } from '@shared/i18n'
import { toast } from './ui'

export const isMac = navigator.platform.toLowerCase().includes('mac')

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

/** Thème choisi, transmis par le process principal dans l'URL de la fenêtre (voir createWindow). */
const bootTheme = new URLSearchParams(location.search).get('theme')

interface SettingsState {
  settings: Settings
  systemDark: boolean
  theme: Theme
  init: (s: Settings) => void
  update: (fn: (s: Settings) => Settings) => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

function applyTheme(theme: Theme): void {
  const root = document.documentElement
  for (const [k, v] of Object.entries(themeCssVariables(theme))) root.style.setProperty(k, v)
  root.dataset['theme'] = theme.id
  root.dataset['mode'] = theme.dark ? 'dark' : 'light'
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  systemDark: darkQuery.matches,
  theme: isThemeId(bootTheme) ? THEMES[bootTheme] : activeTheme(DEFAULT_SETTINGS.theme, darkQuery.matches),

  init: (s) => {
    const settings = normalizeSettings(s)
    const theme = activeTheme(settings.theme, get().systemDark)
    applyTheme(theme)
    set({ settings, theme })
  },

  update: (fn) => {
    const settings = normalizeSettings(fn(get().settings))
    const theme = activeTheme(settings.theme, get().systemDark)
    applyTheme(theme)
    set({ settings, theme })
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void window.endora.saveSettings(useSettings.getState().settings).then((r) => {
        if (!r.ok) toast(t('store.settingsFailed', { message: r.message }), 'error')
      })
    }, 250)
  }
}))

// Mode « système » : le thème suit le passage clair/sombre de l'OS en direct.
darkQuery.addEventListener('change', (e) => {
  const { settings } = useSettings.getState()
  const theme = activeTheme(settings.theme, e.matches)
  applyTheme(theme)
  useSettings.setState({ systemDark: e.matches, theme })
})

applyTheme(useSettings.getState().theme)
