import { afterEach, describe, expect, it } from 'vitest'
import { authLabel } from '../auth'
import { shortcutLabel } from '../shortcuts'
import { getLocale, MESSAGE_KEYS, setLocale, t } from './index'

afterEach(() => setLocale('en'))

describe('i18n', () => {
  it('anglais par défaut', () => {
    expect(getLocale()).toBe('en')
    expect(t('req.send')).toBe('Send')
    expect(t('tabs.untitled')).toBe('New Request')
  })

  it('bascule en français', () => {
    setLocale('fr')
    expect(t('req.send')).toBe('Envoyer')
    expect(t('common.cancel')).toBe('Annuler')
  })

  it('paramètres : texte et fonctions (pluriels)', () => {
    expect(t('history.status', { status: 404 })).toBe('Status 404')
    expect(t('run.start', { count: 1 })).toBe('Run 1 request')
    expect(t('run.start', { count: 3 })).toBe('Run 3 requests')
    setLocale('fr')
    expect(t('run.start', { count: 3 })).toBe('Lancer 3 requêtes')
  })

  it('termes familiers identiques dans les deux langues', () => {
    expect(authLabel('bearer')).toBe('Bearer Token')
    setLocale('fr')
    expect(authLabel('bearer')).toBe('Bearer Token')
    expect(t('auth.f.token')).toBe('Token')
    expect(t('req.headers')).toBe('Headers')
  })

  it('libellés des raccourcis, y compris les onglets numérotés', () => {
    expect(shortcutLabel('switchToTab3')).toBe('Switch to tab 3')
    setLocale('fr')
    expect(shortcutLabel('newTab')).toBe('Nouvel onglet')
  })

  it('aucun message vide', () => {
    for (const locale of ['en', 'fr'] as const) {
      setLocale(locale)
      for (const key of MESSAGE_KEYS) expect(t(key, { count: 2, n: 2, name: 'x', status: 200 }).trim(), `${locale} ${key}`).not.toBe('')
    }
  })
})
