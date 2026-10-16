import { describe, expect, it } from 'vitest'
import { activeTheme, THEME_IDS, THEMES, themeCssVariables } from './themes'
import { DEFAULT_SETTINGS, normalizeSettings } from './settings'
import { comboAccelerator, comboFromEvent, comboLabel, effectiveShortcuts, findConflicts, isValidCombo, normalizeCombo } from './shortcuts'
import { authFromV21, authToV21, effectiveAuth } from './auth'
import {
  exportEnvironmentFile,
  findVariableTokens,
  lookupVariable,
  newVariable,
  parseEnvironmentFile,
  resolveDeep,
  resolveString,
  visibleVariables,
  type Scope
} from './variables'

const scopes = (): Scope[] => [
  { name: 'globals', values: [newVariable('host', 'global-host'), newVariable('g', 'G'), newVariable('loop', '{{loop}}')] },
  { name: 'environment', label: 'Dev', values: [newVariable('host', 'dev-host'), { ...newVariable('token', 'init', 'secret'), current: 'courant' }] },
  { name: 'collection', values: [newVariable('host', 'col-host'), newVariable('path', '/v1/{{g}}'), { ...newVariable('off', 'x'), enabled: false }] }
]

describe('résolution des variables', () => {
  it('applique la priorité environnement > collection > globales et la valeur courante', () => {
    expect(resolveString('{{host}}{{path}}?t={{token}}', scopes())).toBe('dev-host/v1/G?t=courant')
    expect(lookupVariable(scopes(), 'host')).toMatchObject({ scope: 'environment', label: 'Dev' })
    expect(lookupVariable(scopes(), 'token')).toMatchObject({ value: 'courant', initial: 'init', type: 'secret' })
  })

  it('laisse intactes les variables inconnues, désactivées ou récursives', () => {
    expect(resolveString('{{inconnue}} {{off}}', scopes())).toBe('{{inconnue}} {{off}}')
    expect(resolveString('{{loop}}', scopes())).toBe('{{loop}}')
    expect(resolveString('sans variable', scopes())).toBe('sans variable')
  })

  it('génère les variables dynamiques', () => {
    expect(resolveString('{{$guid}}', [])).toMatch(/^[0-9a-f-]{36}$/)
    expect(Number(resolveString('{{$timestamp}}', []))).toBeGreaterThan(1_600_000_000)
    expect(resolveString('{{$randomInt}}', [])).toMatch(/^\d+$/)
  })

  it('résout en profondeur et repère les jetons', () => {
    expect(resolveDeep({ a: ['{{g}}', 1, true], b: { c: '{{host}}' } }, scopes())).toEqual({ a: ['G', 1, true], b: { c: 'dev-host' } })
    expect(findVariableTokens('a {{ x }} b {{y}}')).toEqual([
      { name: 'x', start: 2, end: 9 },
      { name: 'y', start: 12, end: 17 }
    ])
    expect(visibleVariables(scopes()).map((v) => `${v.key}:${v.scope}`).sort()).toEqual([
      'g:globals',
      'host:environment',
      'loop:globals',
      'path:collection',
      'token:environment'
    ])
  })
})

describe('fichiers d’environnement', () => {
  it('importe un environnement et des globales, exporte la valeur initiale seulement', () => {
    const env = parseEnvironmentFile({
      name: 'Prod',
      values: [
        { key: 'url', value: 'https://p', enabled: true },
        { key: 'pwd', value: 's', type: 'secret', enabled: false }
      ]
    })
    expect(env).toMatchObject({ kind: 'environment', name: 'Prod' })
    expect(env!.values.map((v) => [v.key, v.type, v.enabled])).toEqual([
      ['url', 'default', true],
      ['pwd', 'secret', false]
    ])
    expect(parseEnvironmentFile({ name: 'x', values: [], _postman_variable_scope: 'globals' })).toMatchObject({ kind: 'globals' })
    expect(parseEnvironmentFile({ info: {}, item: [] })).toBeNull()

    const exported = exportEnvironmentFile('Prod', [{ ...newVariable('a', '1'), current: '2' }], 'environment', 'id-1')
    expect(exported['values']).toEqual([{ key: 'a', value: '1', type: 'default', enabled: true }])
    expect(exported['_postman_variable_scope']).toBe('environment')
  })
})

describe('auth', () => {
  it('convertit v2.1 ↔ interne et résout l’héritage', () => {
    const raw = { type: 'basic', basic: [{ key: 'username', value: 'u', type: 'string' }] }
    const a = authFromV21(raw)!
    expect(a).toEqual({ type: 'basic', params: { username: 'u' } })
    expect(authToV21(a)).toEqual(raw)
    expect(authFromV21(undefined)).toBeNull()
    expect(authFromV21({ type: 'inherit' })).toBeNull()
    expect(authToV21(authFromV21({ type: 'futur', futur: [] })!)).toEqual({ type: 'futur', futur: [] })

    const chain = [
      { auth: null, name: 'F', kind: 'folder' as const },
      { auth: a, name: 'C', kind: 'collection' as const }
    ]
    expect(effectiveAuth(null, chain)).toEqual({ auth: a, inheritedFrom: { name: 'C', kind: 'collection' } })
    expect(effectiveAuth({ type: 'noauth', params: {} }, chain)).toEqual({ auth: null })
    expect(effectiveAuth(null, [{ auth: { type: 'noauth', params: {} }, name: 'F', kind: 'folder' }, chain[1]!])).toMatchObject({ auth: null })
  })
})

describe('réglages, thèmes et raccourcis', () => {
  it('normalise les réglages et garde les valeurs par défaut', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({ general: { responseFormat: 'xml', maxRedirects: 1000 } }).general).toMatchObject({ responseFormat: 'xml', maxRedirects: 100 })
  })

  it('propose six thèmes et suit le système', () => {
    expect(THEME_IDS).toHaveLength(6)
    expect(Object.keys(THEMES)).toEqual(expect.arrayContaining(['vantablack', 'night-owl', 'solarized-light', 'solarized-dark']))
    const setting = { mode: 'system' as const, fixed: 'endora-dark' as const, light: 'solarized-light' as const, dark: 'night-owl' as const }
    expect(activeTheme(setting, true).id).toBe('night-owl')
    expect(activeTheme(setting, false).id).toBe('solarized-light')
    expect(activeTheme({ ...setting, mode: 'fixed' }, false).id).toBe('endora-dark')
    expect(themeCssVariables(THEMES['solarized-dark'])['--bg']).toBe('#002b36')
    expect(themeCssVariables(THEMES.vantablack)).toMatchObject({ '--bg': '#000000', '--bg-2': '#000000', 'color-scheme': 'dark' })
  })

  it('normalise, affiche et détecte les conflits de raccourcis', () => {
    expect(normalizeCombo('shift+MOD+t')).toBe('mod+shift+t')
    expect(comboLabel('mod+shift+t', true)).toBe('⇧⌘T')
    expect(comboLabel('mod+enter', false)).toBe('Ctrl+Entrée')
    expect(comboAccelerator('mod+alt+w')).toBe('CmdOrCtrl+Alt+W')
    expect(isValidCombo('t')).toBe(false)
    expect(isValidCombo('f5')).toBe(true)
    // ⌥C donne « ç » sur macOS : le code physique de la touche est utilisé.
    expect(comboFromEvent({ key: 'ç', code: 'KeyC', metaKey: true, altKey: true, ctrlKey: false, shiftKey: false }, true)).toBe('mod+alt+c')
    expect(comboFromEvent({ key: 'Enter', code: 'Enter', metaKey: false, altKey: false, ctrlKey: true, shiftKey: false }, false)).toBe('mod+enter')
    expect(comboFromEvent({ key: 'Shift', code: 'ShiftLeft', metaKey: false, altKey: false, ctrlKey: false, shiftKey: true }, true)).toBeNull()

    const shortcuts = effectiveShortcuts({ send: ['mod+s'] })
    expect(shortcuts.newTab).toEqual(['mod+t'])
    expect(findConflicts(shortcuts).get('mod+s')?.sort()).toEqual(['save', 'send'])
  })
})
