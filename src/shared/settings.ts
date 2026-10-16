// Réglages de l'application, persistés par le process principal (settings.json).
// Clés inspirées des réglages observés dans le client de référence : version HTTP
// (`auto` / `http1` / `http2`), délai d'attente, taille maximale de réponse, détection du format
// de réponse (`auto` = d'après le type MIME, ou forcé), ouverture dans un nouvel onglet,
// confirmation à la fermeture, autocomplétion des variables.

import type { ProtocolVersion } from './model'
import { DEFAULT_THEME_DARK, DEFAULT_THEME_LIGHT, isThemeId, type ThemeId } from './themes'

export type ResponseFormat = 'auto' | 'json' | 'xml' | 'html' | 'text'

export interface Settings {
  general: {
    httpVersion: ProtocolVersion
    /** 0 = aucun délai. */
    requestTimeoutMs: number
    followRedirects: boolean
    maxRedirects: number
    /** 0 = pas de limite. */
    maxResponseSizeMb: number
    responseFormat: ResponseFormat
    openInNewTab: boolean
    confirmCloseUnsaved: boolean
    variableAutocomplete: boolean
    /** Délai maximal d'exécution d'un script (ms). */
    scriptTimeoutMs: number
  }
  theme: {
    /** `system` suit le mode clair/sombre du système avec les thèmes choisis pour chaque mode. */
    mode: 'system' | 'fixed'
    fixed: ThemeId
    light: ThemeId
    dark: ThemeId
  }
  /** Raccourcis modifiés par l'utilisateur ; une action absente garde ses raccourcis par défaut. */
  shortcuts: Record<string, string[]>
  /** Génération de code : langage préféré et options par langage (mémorisés, comme dans la référence). */
  codegen: {
    language: string
    variant: string
    resolveVariables: boolean
    options: Record<string, Record<string, unknown>>
  }
  updates: {
    autoCheck: boolean
    /** Dépôt GitHub `propriétaire/nom` ou URL d'un flux JSON `{ version, url, notes }`. */
    source: string
  }
}

export const DEFAULT_SETTINGS: Settings = {
  general: {
    httpVersion: 'auto',
    requestTimeoutMs: 0,
    followRedirects: true,
    maxRedirects: 10,
    maxResponseSizeMb: 50,
    responseFormat: 'auto',
    openInNewTab: false,
    confirmCloseUnsaved: true,
    variableAutocomplete: true,
    scriptTimeoutMs: 30_000
  },
  theme: { mode: 'system', fixed: DEFAULT_THEME_DARK, light: DEFAULT_THEME_LIGHT, dark: DEFAULT_THEME_DARK },
  shortcuts: {},
  codegen: { language: 'curl', variant: 'cURL', resolveVariables: true, options: {} },
  updates: { autoCheck: true, source: 'lix033/endora' }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function num(v: unknown, fallback: number, min: number, max: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback
}
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T => (values.includes(v as T) ? (v as T) : fallback)

/** Valide et complète des réglages lus sur disque ou reçus du renderer. Ne lève jamais. */
export function normalizeSettings(input: unknown): Settings {
  const d = DEFAULT_SETTINGS
  const i = isObject(input) ? input : {}
  const g = isObject(i['general']) ? i['general'] : {}
  const t = isObject(i['theme']) ? i['theme'] : {}
  const u = isObject(i['updates']) ? i['updates'] : {}
  const cg = isObject(i['codegen']) ? i['codegen'] : {}
  const cgOptions: Record<string, Record<string, unknown>> = {}
  if (isObject(cg['options'])) for (const [k, v] of Object.entries(cg['options'])) if (isObject(v)) cgOptions[k] = v
  const shortcuts: Record<string, string[]> = {}
  if (isObject(i['shortcuts'])) {
    for (const [action, combos] of Object.entries(i['shortcuts'])) {
      if (Array.isArray(combos)) shortcuts[action] = combos.filter((c): c is string => typeof c === 'string' && c.length < 64).slice(0, 4)
    }
  }
  const theme = (v: unknown, fallback: ThemeId): ThemeId => (isThemeId(v) ? v : fallback)
  return {
    general: {
      httpVersion: oneOf(g['httpVersion'], ['auto', 'http1', 'http2'] as const, d.general.httpVersion),
      requestTimeoutMs: num(g['requestTimeoutMs'], d.general.requestTimeoutMs, 0, 3_600_000),
      followRedirects: bool(g['followRedirects'], d.general.followRedirects),
      maxRedirects: num(g['maxRedirects'], d.general.maxRedirects, 0, 100),
      maxResponseSizeMb: num(g['maxResponseSizeMb'], d.general.maxResponseSizeMb, 0, 2048),
      responseFormat: oneOf(g['responseFormat'], ['auto', 'json', 'xml', 'html', 'text'] as const, d.general.responseFormat),
      openInNewTab: bool(g['openInNewTab'], d.general.openInNewTab),
      confirmCloseUnsaved: bool(g['confirmCloseUnsaved'], d.general.confirmCloseUnsaved),
      variableAutocomplete: bool(g['variableAutocomplete'], d.general.variableAutocomplete),
      scriptTimeoutMs: num(g['scriptTimeoutMs'], d.general.scriptTimeoutMs, 1000, 600_000)
    },
    theme: {
      mode: oneOf(t['mode'], ['system', 'fixed'] as const, d.theme.mode),
      fixed: theme(t['fixed'], d.theme.fixed),
      light: theme(t['light'], d.theme.light),
      dark: theme(t['dark'], d.theme.dark)
    },
    shortcuts,
    codegen: {
      language: typeof cg['language'] === 'string' && cg['language'] ? cg['language'] : d.codegen.language,
      variant: typeof cg['variant'] === 'string' && cg['variant'] ? cg['variant'] : d.codegen.variant,
      resolveVariables: bool(cg['resolveVariables'], d.codegen.resolveVariables),
      options: cgOptions
    },
    updates: {
      autoCheck: bool(u['autoCheck'], d.updates.autoCheck),
      source: typeof u['source'] === 'string' ? u['source'].trim().slice(0, 500) : d.updates.source
    }
  }
}
