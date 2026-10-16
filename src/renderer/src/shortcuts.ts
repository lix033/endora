// Raccourcis clavier : une seule source de vérité (réglages), appliquée par un écouteur clavier
// en phase de capture ; les clics du menu natif arrivent par la même fonction `dispatch`.

import { createRef } from 'react'
import { create } from 'zustand'
import { isFormatLanguage } from '@shared/format'
import { comboFromEvent, effectiveShortcuts, type ShortcutAction } from '@shared/shortcuts'
import { beautifyText, beautifyView, focusedFormattableEditor } from './beautify'
import { useConsole } from './stores/console'
import { isMac, useSettings } from './stores/settings'
import { useTabs } from './stores/tabs'
import { openImportDialog, useUi } from './stores/ui'

export const urlInputRef = createRef<HTMLInputElement>()
export const sidebarSearchRef = createRef<HTMLInputElement>()

/** Tailles réglables à la souris (séparateurs), mémorisées d'une session à l'autre. */
export interface PaneSizes {
  /** Largeur de la barre latérale (px). */
  sidebarWidth: number
  /** Part de la hauteur donnée à la requête, le reste à la réponse (0–1). */
  requestRatio: number
  /** Largeur du panneau de code (px). */
  codeWidth: number
}

export const DEFAULT_SIZES: PaneSizes = { sidebarWidth: 270, requestRatio: 0.45, codeWidth: 420 }
const SIZES_KEY = 'endora.layout'

function readSizes(): PaneSizes {
  try {
    const raw = JSON.parse(localStorage.getItem(SIZES_KEY) ?? '{}') as Partial<Record<keyof PaneSizes, unknown>>
    const num = (v: unknown, d: number, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d)
    return {
      sidebarWidth: num(raw.sidebarWidth, DEFAULT_SIZES.sidebarWidth, 180, 600),
      requestRatio: num(raw.requestRatio, DEFAULT_SIZES.requestRatio, 0.1, 0.9),
      codeWidth: num(raw.codeWidth, DEFAULT_SIZES.codeWidth, 260, 1200)
    }
  } catch {
    return DEFAULT_SIZES
  }
}

interface LayoutState extends PaneSizes {
  sidebarVisible: boolean
  codePanel: boolean
  toggleSidebar: () => void
  toggleCodePanel: () => void
  resize: (patch: Partial<PaneSizes>) => void
}

export const useLayout = create<LayoutState>((set, get) => ({
  sidebarVisible: true,
  codePanel: false,
  ...readSizes(),
  toggleSidebar: () => set({ sidebarVisible: !get().sidebarVisible }),
  toggleCodePanel: () => set({ codePanel: !get().codePanel }),
  resize: (patch) => set(patch)
}))

let sizesTimer: ReturnType<typeof setTimeout> | null = null
useLayout.subscribe((s, prev) => {
  if (s.sidebarWidth === prev.sidebarWidth && s.requestRatio === prev.requestRatio && s.codeWidth === prev.codeWidth) return
  if (sizesTimer) clearTimeout(sizesTimer)
  sizesTimer = setTimeout(() => {
    const { sidebarWidth, requestRatio, codeWidth } = useLayout.getState()
    try {
      localStorage.setItem(SIZES_KEY, JSON.stringify({ sidebarWidth, requestRatio, codeWidth }))
    } catch {
      // Stockage indisponible : les tailles valent pour cette session seulement.
    }
  }, 300)
})

/**
 * Enregistrement propre à une vue (ex. le script d'un mock dans Services) : le raccourci « Enregistrer »
 * et le menu Fichier › Enregistrer l'appellent quand cet onglet est actif.
 */
const viewSavers = new Map<string, () => void>()

export function registerViewSave(tabId: string, save: () => void): () => void {
  viewSavers.set(tabId, save)
  return () => {
    if (viewSavers.get(tabId) === save) viewSavers.delete(tabId)
  }
}

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
      else if (active) viewSavers.get(active.id)?.()
      break
    case 'saveAs':
      if (active && !active.view) void tabs.save(active.id, { saveAs: true })
      break
    case 'beautify': {
      const view = focusedFormattableEditor()
      const body = active && !active.view ? active.draft.body : null
      if (view) void beautifyView(view)
      else if (active && body?.mode === 'raw' && isFormatLanguage(body.language)) {
        // Hors éditeur (ex. focus dans l'URL) : le body brut de la requête active.
        const before = body.raw
        void beautifyText(before, body.language).then((raw) => {
          if (raw !== null) tabs.updateDraft(active.id, (d) => (d.body.raw === before ? { ...d, body: { ...d.body, raw } } : d))
        })
      }
      break
    }
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
