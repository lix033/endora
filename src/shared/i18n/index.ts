// Traductions de l'interface. L'anglais est la langue par défaut et la référence : chaque jeu de
// messages français est typé sur l'anglais, une clé manquante ne compile pas.
// Terminologie : les termes familiers aux utilisateurs de clients d'API (Bearer Token, Headers,
// Body, Pre-request…) restent tels quels, y compris en français.

import * as common from './messages/common'
import * as dialogs from './messages/dialogs'
import * as mocks from './messages/mocks'
import * as entities from './messages/entities'
import * as main from './messages/main'
import * as request from './messages/request'
import * as response from './messages/response'
import * as runner from './messages/runner'
import * as scripts from './messages/scripts'
import * as settings from './messages/settings'
import * as shell from './messages/shell'
import * as variables from './messages/variables'
import type { Msg, Params } from './types'

export type { Params } from './types'

const en = {
  ...common.en,
  ...dialogs.en,
  ...entities.en,
  ...main.en,
  ...mocks.en,
  ...shell.en,
  ...request.en,
  ...response.en,
  ...runner.en,
  ...scripts.en,
  ...settings.en,
  ...variables.en
}

export type MessageKey = keyof typeof en

export const MESSAGE_KEYS = Object.keys(en) as MessageKey[]

const fr: Record<MessageKey, Msg> = {
  ...common.fr,
  ...dialogs.fr,
  ...entities.fr,
  ...main.fr,
  ...mocks.fr,
  ...shell.fr,
  ...request.fr,
  ...response.fr,
  ...runner.fr,
  ...scripts.fr,
  ...settings.fr,
  ...variables.fr
}

export type Locale = 'en' | 'fr'

export const LOCALES: Array<{ id: Locale; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' }
]

export const DEFAULT_LOCALE: Locale = 'en'

export const isLocale = (v: unknown): v is Locale => v === 'en' || v === 'fr'

const MESSAGES: Record<Locale, Record<MessageKey, Msg>> = { en, fr }

let current: Locale = DEFAULT_LOCALE

export function setLocale(locale: Locale): void {
  current = locale
}

export function getLocale(): Locale {
  return current
}

/** Locale des dates et nombres (`toLocaleString`). */
export function dateLocale(): string {
  return current === 'fr' ? 'fr-FR' : 'en-US'
}

/** Textes d'un message dans toutes les langues (titres par défaut enregistrés dans une autre langue). */
export function allTranslations(key: MessageKey): string[] {
  return Object.values(MESSAGES).map((m) => m[key]).filter((m): m is string => typeof m === 'string')
}

export function t(key: MessageKey, params: Params = {}): string {
  const msg = MESSAGES[current][key] ?? en[key]
  if (typeof msg === 'function') return msg(params)
  return msg.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}
