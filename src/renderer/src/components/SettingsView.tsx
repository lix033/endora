import { useEffect, useState } from 'react'
import type { AppInfo, UpdateCheckResult } from '@shared/api'
import { dateLocale, LOCALES, t, type MessageKey } from '@shared/i18n'
import type { SettingsSection } from '@shared/model'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import {
  comboFromEvent,
  comboLabel,
  effectiveShortcuts,
  findConflicts,
  isValidCombo,
  SHORTCUTS,
  shortcutLabel,
  type ShortcutAction,
  type ShortcutGroup
} from '@shared/shortcuts'
import { THEME_IDS, THEMES, type ThemeId } from '@shared/themes'
import { shortcutCapture } from '../shortcuts'
import { notifyUpdate } from '../stores/notifications'
import { useUpdater } from '../stores/updater'
import { isMac, useSettings } from '../stores/settings'
import { useTabs, type Tab } from '../stores/tabs'
import { confirmDialog, toast } from '../stores/ui'

const SECTIONS: Array<{ id: SettingsSection; label: MessageKey }> = [
  { id: 'general', label: 'settings.general' },
  { id: 'themes', label: 'settings.themes' },
  { id: 'shortcuts', label: 'settings.shortcuts' },
  { id: 'update', label: 'settings.update' }
]

export function SettingsView({ tab }: { tab: Tab }) {
  const section = (tab.view?.kind === 'settings' && tab.view.section) || 'general'
  const go = (s: SettingsSection) => useTabs.getState().openSettings(s)
  return (
    <div className="settings">
      <nav className="settings-nav">
        <h2>{t('settings.title')}</h2>
        {SECTIONS.map((s) => (
          <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => go(s.id)}>
            {t(s.label)}
          </button>
        ))}
      </nav>
      <div className="settings-body">
        {section === 'general' && <GeneralSettings />}
        {section === 'themes' && <ThemeSettings />}
        {section === 'shortcuts' && <ShortcutSettings />}
        {section === 'update' && <UpdateSettings />}
      </div>
    </div>
  )
}

// --- Général -----------------------------------------------------------------------------------

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="setting">
      <div>
        <div>{label}</div>
        {hint && <div className="muted small">{hint}</div>}
      </div>
      <label className="switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </label>
    </div>
  )
}

function GeneralSettings() {
  const g = useSettings((s) => s.settings.general)
  const update = useSettings((s) => s.update)
  const set = (patch: Partial<Settings['general']>) => update((s) => ({ ...s, general: { ...s.general, ...patch } }))
  return (
    <>
      <div className="setting">
        <div>
          <div>{t('settings.language')}</div>
          <div className="muted small">{t('settings.languageHint')}</div>
        </div>
        <select value={g.language} onChange={(e) => set({ language: e.target.value as Settings['general']['language'] })} aria-label={t('settings.language')}>
          {LOCALES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <h3>{t('settings.requests')}</h3>
      <div className="setting">
        <div>
          <div>{t('settings.httpVersion')}</div>
          <div className="muted small">{t('settings.httpVersionHint')}</div>
        </div>
        <select value={g.httpVersion} onChange={(e) => set({ httpVersion: e.target.value as Settings['general']['httpVersion'] })}>
          <option value="auto">Auto</option>
          <option value="http1">HTTP/1.x</option>
          <option value="http2">HTTP/2</option>
        </select>
      </div>
      <div className="setting">
        <div>
          <div>{t('settings.timeout')}</div>
          <div className="muted small">{t('settings.timeoutHint')}</div>
        </div>
        <input type="number" min={0} step={1000} value={g.requestTimeoutMs} onChange={(e) => set({ requestTimeoutMs: Number(e.target.value) })} />
      </div>
      <div className="setting">
        <div>
          <div>{t('settings.maxSize')}</div>
          <div className="muted small">{t('settings.maxSizeHint')}</div>
        </div>
        <input type="number" min={0} value={g.maxResponseSizeMb} onChange={(e) => set({ maxResponseSizeMb: Number(e.target.value) })} />
      </div>
      <Toggle label={t('settings.followRedirects')} checked={g.followRedirects} onChange={(v) => set({ followRedirects: v })} />
      <div className="setting">
        <div>{t('settings.maxRedirects')}</div>
        <input type="number" min={0} max={100} value={g.maxRedirects} disabled={!g.followRedirects} onChange={(e) => set({ maxRedirects: Number(e.target.value) })} />
      </div>
      <div className="setting">
        <div>
          <div>{t('settings.scriptTimeout')}</div>
          <div className="muted small">{t('settings.scriptTimeoutHint')}</div>
        </div>
        <input type="number" min={1000} step={1000} value={g.scriptTimeoutMs} onChange={(e) => set({ scriptTimeoutMs: Number(e.target.value) })} />
      </div>

      <h3>{t('settings.responses')}</h3>
      <div className="setting">
        <div>
          <div>{t('settings.responseFormat')}</div>
          <div className="muted small">{t('settings.responseFormatHint')}</div>
        </div>
        <select value={g.responseFormat} onChange={(e) => set({ responseFormat: e.target.value as Settings['general']['responseFormat'] })}>
          <option value="auto">Auto</option>
          <option value="json">JSON</option>
          <option value="xml">XML</option>
          <option value="html">HTML</option>
          <option value="text">{t('settings.text')}</option>
        </select>
      </div>

      <h3>{t('settings.interface')}</h3>
      <Toggle
        label={t('settings.openInNewTab')}
        hint={t('settings.openInNewTabHint')}
        checked={g.openInNewTab}
        onChange={(v) => set({ openInNewTab: v })}
      />
      <Toggle
        label={t('settings.confirmClose')}
        checked={g.confirmCloseUnsaved}
        onChange={(v) => set({ confirmCloseUnsaved: v })}
      />
      <Toggle label={t('settings.autocomplete')} hint={t('settings.autocompleteHint')} checked={g.variableAutocomplete} onChange={(v) => set({ variableAutocomplete: v })} />

      <p>
        <button className="link" onClick={() => update((s) => ({ ...s, general: { ...DEFAULT_SETTINGS.general, language: s.general.language } }))}>
          {t('settings.resetGeneral')}
        </button>
      </p>
    </>
  )
}

// --- Thèmes ------------------------------------------------------------------------------------

function ThemeCard({ id, selected, onSelect }: { id: ThemeId; selected: boolean; onSelect: () => void }) {
  const theme = THEMES[id]
  const c = theme.colors
  return (
    <button className={`theme-card ${selected ? 'selected' : ''}`} onClick={onSelect} aria-pressed={selected}>
      <div className="theme-swatch" style={{ background: c.bg, borderColor: c.border }}>
        <div style={{ background: c.bg2, borderRight: `1px solid ${c.border}` }} className="sw-side" />
        <div className="sw-main">
          <span style={{ background: c.accent }} />
          <span style={{ background: c.ok }} />
          <span style={{ background: c.warn }} />
          <span style={{ background: c.fail }} />
          <code style={{ color: c.string }}>"ok"</code>
          <code style={{ color: c.keyword }}>pm</code>
        </div>
      </div>
      <span>{t(`theme.${id}`)}</span>
    </button>
  )
}

function ThemeSettings() {
  const theme = useSettings((s) => s.settings.theme)
  const systemDark = useSettings((s) => s.systemDark)
  const update = useSettings((s) => s.update)
  const set = (patch: Partial<Settings['theme']>) => update((s) => ({ ...s, theme: { ...s.theme, ...patch } }))
  const darks = THEME_IDS.filter((id) => THEMES[id].dark)
  const lights = THEME_IDS.filter((id) => !THEMES[id].dark)

  return (
    <>
      <h3>{t('settings.theme')}</h3>
      <Toggle
        label={t('settings.syncSystem')}
        hint={t('settings.syncSystemHint', { dark: systemDark ? 'yes' : 'no' })}
        checked={theme.mode === 'system'}
        onChange={(v) => set({ mode: v ? 'system' : 'fixed' })}
      />
      {theme.mode === 'system' ? (
        <>
          <h4>{t('settings.lightTheme')}</h4>
          <div className="theme-grid">
            {lights.map((id) => (
              <ThemeCard key={id} id={id} selected={theme.light === id} onSelect={() => set({ light: id })} />
            ))}
          </div>
          <h4>{t('settings.darkTheme')}</h4>
          <div className="theme-grid">
            {darks.map((id) => (
              <ThemeCard key={id} id={id} selected={theme.dark === id} onSelect={() => set({ dark: id })} />
            ))}
          </div>
        </>
      ) : (
        <div className="theme-grid">
          {THEME_IDS.map((id) => (
            <ThemeCard key={id} id={id} selected={theme.fixed === id} onSelect={() => set({ fixed: id })} />
          ))}
        </div>
      )}
      <p className="muted small">{t('settings.themesNote')}</p>
    </>
  )
}

// --- Raccourcis --------------------------------------------------------------------------------

function ShortcutSettings() {
  const overrides = useSettings((s) => s.settings.shortcuts)
  const update = useSettings((s) => s.update)
  const [recording, setRecording] = useState<{ action: ShortcutAction; replace?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const shortcuts = effectiveShortcuts(overrides)
  const conflicts = findConflicts(shortcuts)

  const setCombos = (action: ShortcutAction, combos: string[]) => {
    const def = SHORTCUTS.find((s) => s.action === action)!
    update((s) => {
      const next = { ...s.shortcuts }
      if (JSON.stringify(combos) === JSON.stringify(def.defaults)) delete next[action]
      else next[action] = combos
      return { ...s, shortcuts: next }
    })
  }

  useEffect(() => {
    if (!recording) return
    shortcutCapture.active = true
    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(null)
        return
      }
      const combo = comboFromEvent(e, isMac)
      if (!combo) return
      if (!isValidCombo(combo)) {
        setError(t('shortcuts.needModifier'))
        return
      }
      const { action, replace } = recording
      setRecording(null)
      setError(null)
      const owner = (Object.keys(shortcuts) as ShortcutAction[]).find((a) => a !== action && shortcuts[a].includes(combo))
      if (owner) {
        const choice = await confirmDialog(t('shortcuts.taken'), t('shortcuts.takenMessage', { combo: comboLabel(combo, isMac), label: shortcutLabel(owner) }), [
          { label: t('common.cancel'), value: 'cancel' },
          { label: t('shortcuts.reassign'), value: 'reassign', variant: 'primary' }
        ])
        if (choice !== 'reassign') return
        setCombos(
          owner,
          shortcuts[owner].filter((c) => c !== combo)
        )
      }
      const current = shortcuts[action].filter((c) => c !== replace && c !== combo)
      setCombos(action, [...current, combo])
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      shortcutCapture.active = false
      window.removeEventListener('keydown', onKey, true)
    }
  }, [recording, shortcuts])

  const groups: ShortcutGroup[] = ['tabs', 'request', 'interface']
  const f = filter.trim().toLowerCase()

  return (
    <>
      <div className="row space-between">
        <h3>{t('shortcuts.title')}</h3>
        <button
          onClick={() =>
            void confirmDialog(t('shortcuts.resetTitle'), t('shortcuts.resetMessage'), [
              { label: t('common.cancel'), value: 'cancel' },
              { label: t('shortcuts.reset'), value: 'ok', variant: 'danger' }
            ]).then((c) => c === 'ok' && update((s) => ({ ...s, shortcuts: {} })))
          }
          disabled={Object.keys(overrides).length === 0}
        >
          {t('shortcuts.resetAll')}
        </button>
      </div>
      <p className="muted small">{t('shortcuts.hint')}</p>
      <input className="filter" placeholder={t('shortcuts.search')} value={filter} onChange={(e) => setFilter(e.target.value)} />
      {error && <p className="error-text">{error}</p>}
      {groups.map((group) => {
        const rows = SHORTCUTS.filter((s) => s.group === group && (f === '' || shortcutLabel(s.action).toLowerCase().includes(f)))
        if (rows.length === 0) return null
        return (
          <div key={group}>
            <h4>{t(`shortcuts.group.${group}`)}</h4>
            <table className="shortcuts-table">
              <tbody>
                {rows.map((s) => (
                  <tr key={s.action}>
                    <td>{shortcutLabel(s.action)}</td>
                    <td>
                      <div className="combos">
                        {shortcuts[s.action].map((c) => (
                          <span key={c} className={`combo ${conflicts.has(c) ? 'conflict' : ''}`}>
                            <button className="kbd" onClick={() => setRecording({ action: s.action, replace: c })} title={t('shortcuts.edit')}>
                              {recording?.action === s.action && recording.replace === c ? t('shortcuts.press') : comboLabel(c, isMac)}
                            </button>
                            <button
                              className="ghost tiny"
                              aria-label={t('shortcuts.remove')}
                              onClick={() =>
                                setCombos(
                                  s.action,
                                  shortcuts[s.action].filter((x) => x !== c)
                                )
                              }
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        {recording?.action === s.action && !recording.replace && <span className="kbd recording">{t('shortcuts.press')}</span>}
                        <button className="ghost small" onClick={() => setRecording({ action: s.action })} title={t('shortcuts.add')}>
                          +
                        </button>
                        {overrides[s.action] && (
                          <button className="link small" onClick={() => setCombos(s.action, s.defaults)}>
                            {t('shortcuts.default')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}
    </>
  )
}

// --- Mises à jour ------------------------------------------------------------------------------

let checkedAt: Date | null = null
let lastResult: UpdateCheckResult | null = null

/** État de l'updater de l'app installée : version proposée, progression, boutons d'action. */
function UpdaterCard({ version }: { version: string }) {
  const { state, check, install } = useUpdater()
  const busy = state.status === 'checking' || state.status === 'downloading'
  return (
    <div className="update-card">
      <div>
        <div className="big">Endora {version}</div>
        {state.status === 'none' && <div className="ok-text">{t('update.upToDate')}</div>}
        {state.status === 'available' && state.version && (
          <div>
            <div className="warn-text">{t('update.available', { version: state.version })}</div>
            <div className="muted small">
              {state.size === 'major' ? t('update.kindMajor') : t('update.kindSmall')}
              {state.releaseDate ? ` · ${t('update.published', { date: new Date(state.releaseDate).toLocaleDateString(dateLocale()) })}` : ''}
            </div>
          </div>
        )}
        {state.status === 'downloading' && <div className="muted">{t('update.downloading', { version: state.version ?? '', percent: state.percent ?? 0 })}</div>}
        {state.status === 'downloaded' && state.version && (
          <div>
            <div className="ok-text">{t('update.readyTitle', { version: state.version })}</div>
            <div className="muted small">{t('update.readyBody')}</div>
          </div>
        )}
        {state.status === 'error' && <div className="error-text">{state.message}</div>}
        {state.checkedAt && <div className="muted small">{t('update.lastCheck', { time: new Date(state.checkedAt).toLocaleTimeString(dateLocale()) })}</div>}
      </div>
      <div className="row">
        {state.status === 'available' && (
          <button className="primary" onClick={() => void install()}>
            {t('update.install')}
          </button>
        )}
        {state.status === 'downloaded' && (
          <button className="primary" onClick={() => void install()}>
            {t('update.restart')}
          </button>
        )}
        <button onClick={() => void check()} disabled={busy || state.status === 'downloaded'}>
          {state.status === 'checking' ? t('update.checking') : t('update.check')}
        </button>
      </div>
    </div>
  )
}

/** Repli (développement, archives portables) : simple vérification de la dernière release. */
function ReleaseCheckCard({ version }: { version: string }) {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UpdateCheckResult | null>(lastResult)
  const check = async () => {
    setChecking(true)
    const r = await window.endora.checkForUpdates(useSettings.getState().settings.updates.source)
    checkedAt = new Date()
    lastResult = r
    notifyUpdate(r)
    setResult(r)
    setChecking(false)
  }
  return (
    <>
      <div className="update-card">
        <div>
          <div className="big">Endora {version}</div>
          {result?.ok && !result.updateAvailable && <div className="ok-text">{t('update.upToDate')}</div>}
          {result?.ok && result.updateAvailable && (
            <div>
              <div className="warn-text">{t('update.available', { version: result.latest })}</div>
              {result.publishedAt && <div className="muted small">{t('update.published', { date: new Date(result.publishedAt).toLocaleDateString(dateLocale()) })}</div>}
            </div>
          )}
          {result && !result.ok && <div className={result.notConfigured ? 'muted' : 'error-text'}>{result.message}</div>}
          {checkedAt && <div className="muted small">{t('update.lastCheck', { time: checkedAt.toLocaleTimeString(dateLocale()) })}</div>}
        </div>
        <div className="row">
          {result?.ok && result.updateAvailable && result.url && (
            <button className="primary" onClick={() => void window.endora.openExternal(result.url!)}>
              {t('update.download')}
            </button>
          )}
          <button onClick={() => void check()} disabled={checking}>
            {checking ? t('update.checking') : t('update.check')}
          </button>
        </div>
      </div>
      {result?.ok && result.notes && <pre className="release-notes">{result.notes}</pre>}
    </>
  )
}

function UpdateSettings() {
  const updates = useSettings((s) => s.settings.updates)
  const update = useSettings((s) => s.update)
  const updaterState = useUpdater((s) => s.state)
  const supported = updaterState.status !== 'unsupported'
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [source, setSource] = useState(updates.source)
  const set = (patch: Partial<Settings['updates']>) => update((s) => ({ ...s, updates: { ...s.updates, ...patch } }))

  useEffect(() => {
    void window.endora.appInfo().then(setInfo)
  }, [])

  const version = info?.version ?? '…'
  return (
    <>
      <h3>{t('update.title')}</h3>
      {supported ? <UpdaterCard version={version} /> : <ReleaseCheckCard version={version} />}
      {supported && updaterState.notes && (updaterState.status === 'available' || updaterState.status === 'downloaded') && (
        <pre className="release-notes">{updaterState.notes}</pre>
      )}

      <Toggle label={t('update.checkOnStart')} checked={updates.autoCheck} onChange={(v) => set({ autoCheck: v })} />
      {supported ? (
        <Toggle label={t('update.autoInstall')} hint={t('update.autoInstallHint')} checked={updates.autoInstall} onChange={(v) => set({ autoInstall: v })} />
      ) : (
        <>
          <p className="muted small">{t('update.unsupported')}</p>
          <div className="setting">
            <div>
              <div>{t('update.source')}</div>
              <div className="muted small">{t('update.sourceHint')}</div>
            </div>
            <div className="row">
              <input value={source} placeholder={t('update.sourcePlaceholder')} onChange={(e) => setSource(e.target.value)} />
              <button disabled={source === updates.source} onClick={() => set({ source })}>
                {t('common.save')}
              </button>
            </div>
          </div>
        </>
      )}

      {info && (
        <>
          <h3>{t('update.about')}</h3>
          <table className="about-table">
            <tbody>
              <tr>
                <th>{t('update.version')}</th>
                <td>{info.version}</td>
              </tr>
              <tr>
                <th>{t('update.secrets')}</th>
                <td>{info.secretsEncrypted ? t('update.secretsEncrypted') : t('update.secretsPlain')}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

/**
 * Vérification au démarrage, si activée. L'app installée est gérée par le process principal
 * (electron-updater) ; sinon, simple consultation de la dernière release.
 */
export async function autoCheckUpdates(): Promise<void> {
  const { updates } = useSettings.getState().settings
  if (!updates.autoCheck || updates.source === '') return
  if ((await window.endora.updaterState()).status !== 'unsupported') return
  const r = await window.endora.checkForUpdates(updates.source)
  checkedAt = new Date()
  lastResult = r
  if (notifyUpdate(r) && r.ok) toast(t('notify.updateToast', { version: r.latest }))
}
