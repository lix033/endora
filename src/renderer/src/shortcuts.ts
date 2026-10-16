// Raccourcis clavier : une seule source de vérité (réglages), appliquée par un écouteur clavier
// en phase de capture ; les clics du menu natif arrivent par la même fonction `dispatch`.

import { createRef } from 'react'
import { create } from 'zustand'
import { comboFromEvent, effectiveShortcuts, type ShortcutAction } from '@shared/shortcuts'
import { useConsole } from './stores/console'
import { isMac, useSettings } from './stores/settings'
import { useTabs } from './stores/tabs'
import { openImportDialog, useUi } from './stores/ui'

export const urlInputRef = createRef<HTMLInputElement>()
export const sidebarSearchRef = createRef<HTMLInputElement>()

interface LayoutState {
  sidebarVisible: boolean
  codePanel: boolean
  toggleSidebar: () => void
  toggleCodePanel: () => void
}

export const useLayout = create<LayoutState>((set, get) => ({
  sidebarVisible: true,
  codePanel: false,
  toggleSidebar: () => set({ sidebarVisible: !get().sidebarVisible }),
  toggleCodePanel: () => set({ codePanel: !get().codePanel })
}))

/** Vrai pendant la capture d'un nouveau raccourci dans les réglages. */
export const shortcutCapture = { active: false }

export function dispatch(action: ShortcutAction): void {
  // Les raccourcis d'onglets sont inactifs tant qu'une boîte de dialogue est ouverte.
  if (useUi.getState().dialog && action !== 'import') return
  const tabs = useTabs.getState()
  const active = tabs.tabs.find((t) => t.id === tabs.activeId)
  switch (action) {
    case 'newTab':
      tabs.openNew()
      break
    case 'closeTab':
      if (active) void tabs.close(active.id)
      break
    case 'forceCloseTab':
      if (active) void tabs.close(active.id, { force: true })
      break
    case 'reopenTab':
      tabs.reopenClosed()
      break
    case 'nextTab':
      tabs.activateRelative(1)
      break
    case 'previousTab':
      tabs.activateRelative(-1)
      break
    case 'switchToLastTab':
      tabs.activateIndex(-1)
      break
    case 'focusUrl':
      urlInputRef.current?.focus()
      urlInputRef.current?.select()
      break
    case 'send':
      if (active && !active.view) {
        if (active.sending) tabs.cancel(active.id)
        else void tabs.send(active.id)
      }
      break
    case 'save':
      if (active && !active.view) void tabs.save(active.id)
      break
    case 'saveAs':
      if (active && !active.view) void tabs.save(active.id, { saveAs: true })
      break
    case 'toggleSidebar':
      useLayout.getState().toggleSidebar()
      break
    case 'searchSidebar':
      if (!useLayout.getState().sidebarVisible) useLayout.getState().toggleSidebar()
      requestAnimationFrame(() => sidebarSearchRef.current?.focus())
      break
    case 'import':
      openImportDialog()
      break
    case 'openSettings':
      tabs.openSettings()
      break
    case 'toggleConsole':
      useConsole.getState().toggle()
      break
    default: {
      const m = /^switchToTab(\d)$/.exec(action)
      if (m) tabs.activateIndex(Number(m[1]) - 1)
    }
  }
}

export function installKeyboardShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    if (shortcutCapture.active || e.repeat) return
    const combo = comboFromEvent(e, isMac)
    if (!combo) return
    const shortcuts = effectiveShortcuts(useSettings.getState().settings.shortcuts)
    const action = (Object.keys(shortcuts) as ShortcutAction[]).find((a) => shortcuts[a].includes(combo))
    if (!action) return
    e.preventDefault()
    e.stopPropagation()
    dispatch(action)
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
