// Raccourcis clavier modifiables. Catalogue et combinaisons par défaut repris du comportement
// observé dans le client de référence (table de raccourcis : `mod+t`, `mod+w`, `mod+alt+w`,
// `mod+shift+t`, `mod+1`…`mod+8`, `mod+9`, `mod+l`, `mod+s`, `mod+shift+s`, `mod+enter`, `mod+\`,
// `mod+e`, `mod+f`, `mod+shift+[` / `ctrl+tab`…). Notation : `mod` = ⌘ sur macOS, Ctrl ailleurs.

export type ShortcutAction =
  | 'newTab'
  | 'closeTab'
  | 'forceCloseTab'
  | 'reopenTab'
  | 'nextTab'
  | 'previousTab'
  | 'switchToTab1'
  | 'switchToTab2'
  | 'switchToTab3'
  | 'switchToTab4'
  | 'switchToTab5'
  | 'switchToTab6'
  | 'switchToTab7'
  | 'switchToTab8'
  | 'switchToLastTab'
  | 'focusUrl'
  | 'save'
  | 'saveAs'
  | 'send'
  | 'toggleSidebar'
  | 'searchSidebar'
  | 'import'
  | 'openSettings'
  | 'toggleConsole'

export interface ShortcutDefinition {
  action: ShortcutAction
  label: string
  group: 'Onglets' | 'Requête' | 'Interface'
  defaults: string[]
}

export const SHORTCUTS: ShortcutDefinition[] = [
  { action: 'newTab', label: 'Nouvel onglet', group: 'Onglets', defaults: ['mod+t'] },
  { action: 'closeTab', label: 'Fermer l’onglet', group: 'Onglets', defaults: ['mod+w'] },
  { action: 'forceCloseTab', label: 'Fermer l’onglet sans enregistrer', group: 'Onglets', defaults: ['mod+alt+w'] },
  { action: 'reopenTab', label: 'Rouvrir le dernier onglet fermé', group: 'Onglets', defaults: ['mod+shift+t'] },
  { action: 'nextTab', label: 'Onglet suivant', group: 'Onglets', defaults: ['mod+shift+]', 'ctrl+tab'] },
  { action: 'previousTab', label: 'Onglet précédent', group: 'Onglets', defaults: ['mod+shift+[', 'ctrl+shift+tab'] },
  ...([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => ({
    action: `switchToTab${n}` as ShortcutAction,
    label: `Aller à l’onglet ${n}`,
    group: 'Onglets' as const,
    defaults: [`mod+${n}`]
  })),
  { action: 'switchToLastTab', label: 'Aller au dernier onglet', group: 'Onglets', defaults: ['mod+9'] },
  { action: 'focusUrl', label: 'Aller à l’URL', group: 'Requête', defaults: ['mod+l'] },
  { action: 'send', label: 'Envoyer la requête', group: 'Requête', defaults: ['mod+enter'] },
  { action: 'save', label: 'Enregistrer', group: 'Requête', defaults: ['mod+s'] },
  { action: 'saveAs', label: 'Enregistrer sous…', group: 'Requête', defaults: ['mod+shift+s'] },
  { action: 'toggleSidebar', label: 'Afficher/masquer la barre latérale', group: 'Interface', defaults: ['mod+\\'] },
  { action: 'searchSidebar', label: 'Rechercher dans la barre latérale', group: 'Interface', defaults: ['mod+f'] },
  { action: 'import', label: 'Importer', group: 'Interface', defaults: ['mod+o'] },
  { action: 'openSettings', label: 'Paramètres', group: 'Interface', defaults: ['mod+,'] },
  { action: 'toggleConsole', label: 'Afficher/masquer la console', group: 'Interface', defaults: ['mod+alt+c'] }
]

export const isShortcutAction = (v: unknown): v is ShortcutAction => SHORTCUTS.some((s) => s.action === v)

const MODIFIERS = ['mod', 'ctrl', 'alt', 'shift', 'meta'] as const

/** Forme canonique : modificateurs dans un ordre fixe puis la touche, en minuscules. */
export function normalizeCombo(combo: string): string {
  const parts = combo.toLowerCase().split('+')
  // « mod++ » : la touche est « + ».
  const key = combo.endsWith('++') ? '+' : (parts[parts.length - 1] ?? '')
  const mods = new Set(parts.slice(0, combo.endsWith('++') ? -2 : -1))
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join('+')
}

export function effectiveShortcuts(overrides: Record<string, string[]>): Record<ShortcutAction, string[]> {
  const out = {} as Record<ShortcutAction, string[]>
  for (const s of SHORTCUTS) out[s.action] = (overrides[s.action] ?? s.defaults).map(normalizeCombo)
  return out
}

const KEY_ALIASES: Record<string, string> = {
  ' ': 'space',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  escape: 'esc',
  return: 'enter'
}

interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/** Combinaison canonique d'un événement clavier ; `null` pour une touche de modificateur seule. */
export function comboFromEvent(e: KeyLike, isMac: boolean): string | null {
  const raw = e.key.toLowerCase()
  if (['control', 'meta', 'alt', 'shift', 'os'].includes(raw)) return null
  // Avec Alt/Maj, `key` donne un caractère composé (ex. ⌥C = « ç ») : on préfère le code physique.
  let key = KEY_ALIASES[raw] ?? raw
  if (e.code) {
    if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase()
    else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
    else if (e.code === 'BracketLeft') key = '['
    else if (e.code === 'BracketRight') key = ']'
    else if (e.code === 'Backslash') key = '\\'
    else if (e.code === 'Comma') key = ','
    else if (e.code === 'Period') key = '.'
    else if (e.code === 'Slash') key = '/'
    else if (e.code === 'Equal') key = '='
    else if (e.code === 'Minus') key = '-'
  }
  const mods: string[] = []
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('mod')
  if (isMac && e.ctrlKey) mods.push('ctrl')
  if (e.altKey) mods.push('alt')
  if (e.shiftKey) mods.push('shift')
  if (!isMac && e.metaKey) mods.push('meta')
  return normalizeCombo([...mods, key].join('+'))
}

/** Une combinaison doit comporter un modificateur, sauf les touches de fonction. */
export function isValidCombo(combo: string): boolean {
  const parts = normalizeCombo(combo).split('+')
  const key = parts[parts.length - 1] ?? ''
  if (key === '') return false
  return parts.length > 1 || /^f\d{1,2}$/.test(key)
}

/** Libellé lisible : « ⇧⌘T » sur macOS, « Ctrl+Shift+T » ailleurs. */
export function comboLabel(combo: string, isMac: boolean): string {
  const parts = normalizeCombo(combo).split('+')
  const key = parts.pop() ?? ''
  const keyLabel =
    { enter: isMac ? '↵' : 'Entrée', tab: 'Tab', space: 'Espace', esc: 'Échap', up: '↑', down: '↓', left: '←', right: '→' }[key] ??
    key.toUpperCase()
  if (isMac) {
    const sym: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', mod: '⌘', meta: '⌘' }
    const order = ['ctrl', 'alt', 'shift', 'mod']
    return order.filter((m) => parts.includes(m)).map((m) => sym[m]).join('') + keyLabel
  }
  const names: Record<string, string> = { mod: 'Ctrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Maj', meta: 'Win' }
  return [...parts.map((m) => names[m] ?? m), keyLabel].join('+')
}

/** Accélérateur Electron (affiché dans les menus natifs). */
export function comboAccelerator(combo: string): string {
  const parts = normalizeCombo(combo).split('+')
  const key = parts.pop() ?? ''
  const names: Record<string, string> = { mod: 'CmdOrCtrl', ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Super' }
  const keyName = { enter: 'Enter', tab: 'Tab', space: 'Space', esc: 'Escape', up: 'Up', down: 'Down', left: 'Left', right: 'Right' }[key] ?? key.toUpperCase()
  return [...parts.map((m) => names[m] ?? m), keyName].join('+')
}

/** Actions qui partagent une même combinaison. */
export function findConflicts(shortcuts: Record<ShortcutAction, string[]>): Map<string, ShortcutAction[]> {
  const byCombo = new Map<string, ShortcutAction[]>()
  for (const [action, combos] of Object.entries(shortcuts) as Array<[ShortcutAction, string[]]>) {
    for (const c of combos) byCombo.set(c, [...(byCombo.get(c) ?? []), action])
  }
  return new Map([...byCombo].filter(([, actions]) => actions.length > 1))
}
