// Thèmes de l'interface : six palettes propres à Endora. Night Owl (S. Drasner) et Solarized
// (E. Schoonover) reprennent des palettes publiques sous licence MIT, pas des assets du client
// de référence.

export const THEME_IDS = ['endora-dark', 'vantablack', 'endora-light', 'night-owl', 'solarized-dark', 'solarized-light'] as const
export type ThemeId = (typeof THEME_IDS)[number]

export const DEFAULT_THEME_DARK: ThemeId = 'endora-dark'
export const DEFAULT_THEME_LIGHT: ThemeId = 'endora-light'

export const isThemeId = (v: unknown): v is ThemeId => typeof v === 'string' && (THEME_IDS as readonly string[]).includes(v)

export interface ThemeColors {
  bg: string
  bg2: string
  bg3: string
  border: string
  text: string
  muted: string
  accent: string
  accentText: string
  ok: string
  warn: string
  fail: string
  info: string
  purple: string
  selection: string
  /** Coloration syntaxique et variables. */
  string: string
  number: string
  keyword: string
  property: string
  comment: string
  variable: string
  variableUnresolved: string
}

export interface Theme {
  id: ThemeId
  name: string
  dark: boolean
  colors: ThemeColors
}

export const THEMES: Record<ThemeId, Theme> = {
  'endora-dark': {
    id: 'endora-dark',
    name: 'Endora bleu nuit',
    dark: true,
    // Bleu nuit inspiré du mode « Dim » de l'ex-Twitter, accent bleu vif.
    colors: {
      bg: '#15202b', bg2: '#192734', bg3: '#22303c', border: '#38444d', text: '#f7f9f9', muted: '#8b98a5',
      accent: '#1d9bf0', accentText: '#ffffff', ok: '#00ba7c', warn: '#ffd400', fail: '#f4212e', info: '#7ecbff', purple: '#a78bfa',
      selection: 'rgba(29, 155, 240, 0.24)',
      string: '#7ee2a8', number: '#ffb86b', keyword: '#c4a5ff', property: '#7ecbff', comment: '#6e7f8d',
      variable: '#1d9bf0', variableUnresolved: '#f4212e'
    }
  },
  vantablack: {
    id: 'vantablack',
    name: 'Vantablack',
    dark: true,
    // Noir absolu pour les écrans OLED : fond et panneaux à #000, séparés par des bordures fines ;
    // seuls le survol et les états actifs se détachent. Texte légèrement adouci pour éviter le
    // halo du blanc pur sur fond noir.
    colors: {
      bg: '#000000', bg2: '#000000', bg3: '#141414', border: '#262626', text: '#e8e8e8', muted: '#8c8c8c',
      accent: '#1d9bf0', accentText: '#ffffff', ok: '#00ba7c', warn: '#ffd400', fail: '#f4212e', info: '#7ecbff', purple: '#a78bfa',
      selection: 'rgba(29, 155, 240, 0.3)',
      string: '#7ee2a8', number: '#ffb86b', keyword: '#c4a5ff', property: '#7ecbff', comment: '#6b6b6b',
      variable: '#1d9bf0', variableUnresolved: '#f4212e'
    }
  },
  'endora-light': {
    id: 'endora-light',
    name: 'Endora clair',
    dark: false,
    colors: {
      bg: '#ffffff', bg2: '#f7f9f9', bg3: '#eff3f4', border: '#cfd9de', text: '#0f1419', muted: '#536471',
      accent: '#1d9bf0', accentText: '#ffffff', ok: '#00875a', warn: '#b07d00', fail: '#e0245e', info: '#0a6ea8', purple: '#7856ff',
      selection: 'rgba(29, 155, 240, 0.16)',
      string: '#0a7d3e', number: '#b35900', keyword: '#7856ff', property: '#0a6ea8', comment: '#6e7781',
      variable: '#1d9bf0', variableUnresolved: '#e0245e'
    }
  },
  'night-owl': {
    id: 'night-owl',
    name: 'Night Owl (sombre)',
    dark: true,
    colors: {
      bg: '#011627', bg2: '#0b2236', bg3: '#122d42', border: '#1d3b53', text: '#d6deeb', muted: '#7e93a8',
      accent: '#82aaff', accentText: '#011627', ok: '#addb67', warn: '#ecc48d', fail: '#ef5350', info: '#7fdbca', purple: '#c792ea',
      selection: 'rgba(130, 170, 255, 0.22)',
      string: '#ecc48d', number: '#f78c6c', keyword: '#c792ea', property: '#7fdbca', comment: '#637777',
      variable: '#82aaff', variableUnresolved: '#ef5350'
    }
  },
  'solarized-dark': {
    id: 'solarized-dark',
    name: 'Solarized sombre',
    dark: true,
    colors: {
      bg: '#002b36', bg2: '#073642', bg3: '#0d4251', border: '#1c4b57', text: '#93a1a1', muted: '#657b83',
      accent: '#268bd2', accentText: '#fdf6e3', ok: '#859900', warn: '#b58900', fail: '#dc322f', info: '#2aa198', purple: '#6c71c4',
      selection: 'rgba(38, 139, 210, 0.25)',
      string: '#2aa198', number: '#d33682', keyword: '#859900', property: '#268bd2', comment: '#586e75',
      variable: '#268bd2', variableUnresolved: '#dc322f'
    }
  },
  'solarized-light': {
    id: 'solarized-light',
    name: 'Solarized clair',
    dark: false,
    colors: {
      bg: '#fdf6e3', bg2: '#eee8d5', bg3: '#e4ddc8', border: '#d3cbb4', text: '#586e75', muted: '#839496',
      accent: '#268bd2', accentText: '#fdf6e3', ok: '#859900', warn: '#b58900', fail: '#dc322f', info: '#2aa198', purple: '#6c71c4',
      selection: 'rgba(38, 139, 210, 0.18)',
      string: '#2aa198', number: '#d33682', keyword: '#859900', property: '#268bd2', comment: '#93a1a1',
      variable: '#268bd2', variableUnresolved: '#dc322f'
    }
  }
}

/** Thème à appliquer selon le réglage et le mode clair/sombre du système. */
export function activeTheme(setting: { mode: 'system' | 'fixed'; fixed: ThemeId; light: ThemeId; dark: ThemeId }, systemDark: boolean): Theme {
  if (setting.mode === 'fixed') return THEMES[setting.fixed]
  return THEMES[systemDark ? setting.dark : setting.light]
}

/** Variables CSS correspondant à un thème. */
export function themeCssVariables(theme: Theme): Record<string, string> {
  const c = theme.colors
  return {
    '--bg': c.bg, '--bg-2': c.bg2, '--bg-3': c.bg3, '--border': c.border, '--text': c.text, '--muted': c.muted,
    '--accent': c.accent, '--accent-text': c.accentText, '--ok': c.ok, '--warn': c.warn, '--fail': c.fail, '--info': c.info,
    '--purple': c.purple, '--selection': c.selection, '--syn-string': c.string, '--syn-number': c.number,
    '--syn-keyword': c.keyword, '--syn-property': c.property, '--syn-comment': c.comment, '--var': c.variable,
    '--var-unresolved': c.variableUnresolved, 'color-scheme': theme.dark ? 'dark' : 'light'
  }
}
