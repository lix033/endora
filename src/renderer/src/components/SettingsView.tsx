import { useEffect, useState } from 'react'
import type { AppInfo, UpdateCheckResult } from '@shared/api'
import type { SettingsSection } from '@shared/model'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import {
  comboFromEvent,
  comboLabel,
  effectiveShortcuts,
  findConflicts,
  isValidCombo,
  SHORTCUTS,
  type ShortcutAction
} from '@shared/shortcuts'
import { THEME_IDS, THEMES, type ThemeId } from '@shared/themes'
import { shortcutCapture } from '../shortcuts'
import { notifyUpdate } from '../stores/notifications'
import { isMac, useSettings } from '../stores/settings'
import { useTabs, type Tab } from '../stores/tabs'
import { confirmDialog, toast } from '../stores/ui'

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'general', label: 'Général' },
  { id: 'themes', label: 'Thèmes' },
  { id: 'shortcuts', label: 'Raccourcis' },
  { id: 'update', label: 'Mises à jour' }
]

export function SettingsView({ tab }: { tab: Tab }) {
  const section = (tab.view?.kind === 'settings' && tab.view.section) || 'general'
  const go = (s: SettingsSection) => useTabs.getState().openSettings(s)
  return (
    <div className="settings">
      <nav className="settings-nav">
        <h2>Paramètres</h2>
        {SECTIONS.map((s) => (
          <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => go(s.id)}>
            {s.label}
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
      <h3>Requêtes</h3>
      <div className="setting">
        <div>
          <div>Version HTTP</div>
          <div className="muted small">Auto laisse le serveur négocier (ALPN). Chaque requête peut remplacer ce réglage.</div>
        </div>
        <select value={g.httpVersion} onChange={(e) => set({ httpVersion: e.target.value as Settings['general']['httpVersion'] })}>
          <option value="auto">Auto</option>
          <option value="http1">HTTP/1.x</option>
          <option value="http2">HTTP/2</option>
        </select>
      </div>
      <div className="setting">
        <div>
          <div>Délai d’attente des requêtes (ms)</div>
          <div className="muted small">0 = aucun délai.</div>
        </div>
        <input type="number" min={0} step={1000} value={g.requestTimeoutMs} onChange={(e) => set({ requestTimeoutMs: Number(e.target.value) })} />
      </div>
      <div className="setting">
        <div>
          <div>Taille maximale de réponse (Mo)</div>
          <div className="muted small">0 = pas de limite.</div>
        </div>
        <input type="number" min={0} value={g.maxResponseSizeMb} onChange={(e) => set({ maxResponseSizeMb: Number(e.target.value) })} />
      </div>
      <Toggle label="Suivre les redirections" checked={g.followRedirects} onChange={(v) => set({ followRedirects: v })} />
      <div className="setting">
        <div>Nombre maximal de redirections</div>
        <input type="number" min={0} max={100} value={g.maxRedirects} disabled={!g.followRedirects} onChange={(e) => set({ maxRedirects: Number(e.target.value) })} />
      </div>
      <div className="setting">
        <div>
          <div>Délai maximal d’un script (ms)</div>
          <div className="muted small">Au-delà, le script est interrompu (boucle infinie…).</div>
        </div>
        <input type="number" min={1000} step={1000} value={g.scriptTimeoutMs} onChange={(e) => set({ scriptTimeoutMs: Number(e.target.value) })} />
      </div>

      <h3>Réponses</h3>
      <div className="setting">
        <div>
          <div>Détection du format de réponse</div>
          <div className="muted small">Auto utilise le type MIME de la réponse ; sinon le format choisi est imposé.</div>
        </div>
        <select value={g.responseFormat} onChange={(e) => set({ responseFormat: e.target.value as Settings['general']['responseFormat'] })}>
          <option value="auto">Auto</option>
          <option value="json">JSON</option>
          <option value="xml">XML</option>
          <option value="html">HTML</option>
          <option value="text">Texte</option>
        </select>
      </div>

      <h3>Interface</h3>
      <Toggle
        label="Toujours ouvrir dans un nouvel onglet"
        hint="Désactive l’onglet d’aperçu réutilisé au simple clic."
        checked={g.openInNewTab}
        onChange={(v) => set({ openInNewTab: v })}
      />
      <Toggle
        label="Confirmer la fermeture d’un onglet modifié"
        checked={g.confirmCloseUnsaved}
        onChange={(v) => set({ confirmCloseUnsaved: v })}
      />
      <Toggle label="Autocomplétion des variables" hint="Suggestions à la saisie de {{" checked={g.variableAutocomplete} onChange={(v) => set({ variableAutocomplete: v })} />

      <p>
        <button className="link" onClick={() => update((s) => ({ ...s, general: DEFAULT_SETTINGS.general }))}>
          Rétablir les réglages généraux par défaut
        </button>
      </p>
    </>
  )
}

// --- Thèmes ------------------------------------------------------------------------------------

function ThemeCard({ id, selected, onSelect }: { id: ThemeId; selected: boolean; onSelect: () => void }) {
  const t = THEMES[id]
  const c = t.colors
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
      <span>{t.name}</span>
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
      <h3>Thème</h3>
      <Toggle
        label="Synchroniser avec le système"
        hint={`Bascule automatiquement entre un thème clair et un thème sombre selon le réglage du système (actuellement ${systemDark ? 'sombre' : 'clair'}).`}
        checked={theme.mode === 'system'}
        onChange={(v) => set({ mode: v ? 'system' : 'fixed' })}
      />
      {theme.mode === 'system' ? (
        <>
          <h4>Thème clair</h4>
          <div className="theme-grid">
            {lights.map((id) => (
              <ThemeCard key={id} id={id} selected={theme.light === id} onSelect={() => set({ light: id })} />
            ))}
          </div>
          <h4>Thème sombre</h4>
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
      <p className="muted small">Cinq thèmes : Endora bleu nuit et clair, Night Owl, Solarized sombre et clair.</p>
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
        setError('Utilisez au moins une touche de modification (⌘, Ctrl, Alt, Maj), sauf pour les touches F1–F12.')
        return
      }
      const { action, replace } = recording
      setRecording(null)
      setError(null)
      const owner = (Object.keys(shortcuts) as ShortcutAction[]).find((a) => a !== action && shortcuts[a].includes(combo))
      if (owner) {
        const label = SHORTCUTS.find((s) => s.action === owner)!.label
        const choice = await confirmDialog('Raccourci déjà utilisé', `${comboLabel(combo, isMac)} est affecté à « ${label} ». Le réaffecter ?`, [
          { label: 'Annuler', value: 'cancel' },
          { label: 'Réaffecter', value: 'reassign', variant: 'primary' }
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

  const groups = ['Onglets', 'Requête', 'Interface'] as const
  const f = filter.trim().toLowerCase()

  return (
    <>
      <div className="row space-between">
        <h3>Raccourcis clavier</h3>
        <button
          onClick={() =>
            void confirmDialog('Réinitialiser les raccourcis', 'Tous les raccourcis reprendront leurs valeurs par défaut.', [
              { label: 'Annuler', value: 'cancel' },
              { label: 'Réinitialiser', value: 'ok', variant: 'danger' }
            ]).then((c) => c === 'ok' && update((s) => ({ ...s, shortcuts: {} })))
          }
          disabled={Object.keys(overrides).length === 0}
        >
          Tout réinitialiser
        </button>
      </div>
      <p className="muted small">Cliquez sur un raccourci pour le modifier, sur « + » pour en ajouter un. Échap annule la saisie.</p>
      <input className="filter" placeholder="Rechercher une action" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {error && <p className="error-text">{error}</p>}
      {groups.map((group) => {
        const rows = SHORTCUTS.filter((s) => s.group === group && (f === '' || s.label.toLowerCase().includes(f)))
        if (rows.length === 0) return null
        return (
          <div key={group}>
            <h4>{group}</h4>
            <table className="shortcuts-table">
              <tbody>
                {rows.map((s) => (
                  <tr key={s.action}>
                    <td>{s.label}</td>
                    <td>
                      <div className="combos">
                        {shortcuts[s.action].map((c) => (
                          <span key={c} className={`combo ${conflicts.has(c) ? 'conflict' : ''}`}>
                            <button className="kbd" onClick={() => setRecording({ action: s.action, replace: c })} title="Modifier">
                              {recording?.action === s.action && recording.replace === c ? 'Appuyez…' : comboLabel(c, isMac)}
                            </button>
                            <button
                              className="ghost tiny"
                              aria-label="Retirer"
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
                        {recording?.action === s.action && !recording.replace && <span className="kbd recording">Appuyez…</span>}
                        <button className="ghost small" onClick={() => setRecording({ action: s.action })} title="Ajouter un raccourci">
                          +
                        </button>
                        {overrides[s.action] && (
                          <button className="link small" onClick={() => setCombos(s.action, s.defaults)}>
                            par défaut
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

function UpdateSettings() {
  const updates = useSettings((s) => s.settings.updates)
  const update = useSettings((s) => s.update)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<UpdateCheckResult | null>(lastResult)
  const [source, setSource] = useState(updates.source)

  useEffect(() => {
    void window.endora.appInfo().then(setInfo)
  }, [])

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
      <h3>Mises à jour</h3>
      <div className="update-card">
        <div>
          <div className="big">Endora {info?.version ?? '…'}</div>
          {result?.ok && !result.updateAvailable && <div className="ok-text">Vous utilisez la dernière version.</div>}
          {result?.ok && result.updateAvailable && (
            <div>
              <div className="warn-text">Version {result.latest} disponible.</div>
              {result.publishedAt && <div className="muted small">Publiée le {new Date(result.publishedAt).toLocaleDateString('fr-FR')}</div>}
            </div>
          )}
          {result && !result.ok && <div className={result.notConfigured ? 'muted' : 'error-text'}>{result.message}</div>}
          {checkedAt && <div className="muted small">Dernière vérification : {checkedAt.toLocaleTimeString('fr-FR')}</div>}
        </div>
        <div className="row">
          {result?.ok && result.updateAvailable && result.url && (
            <button className="primary" onClick={() => void window.endora.openExternal(result.url!)}>
              Télécharger
            </button>
          )}
          <button onClick={() => void check()} disabled={checking}>
            {checking ? 'Vérification…' : 'Rechercher des mises à jour'}
          </button>
        </div>
      </div>
      {result?.ok && result.notes && <pre className="release-notes">{result.notes}</pre>}

      <div className="setting">
        <div>
          <div>Source des mises à jour</div>
          <div className="muted small">Dépôt GitHub « propriétaire/dépôt » (dernière release) ou URL d’un flux JSON {'{ version, url, notes }'}.</div>
        </div>
        <div className="row">
          <input value={source} placeholder="propriétaire/dépôt" onChange={(e) => setSource(e.target.value)} />
          <button disabled={source === updates.source} onClick={() => update((s) => ({ ...s, updates: { ...s.updates, source } }))}>
            Enregistrer
          </button>
        </div>
      </div>
      <Toggle
        label="Vérifier au démarrage"
        checked={updates.autoCheck}
        onChange={(v) => update((s) => ({ ...s, updates: { ...s.updates, autoCheck: v } }))}
      />

      {info && (
        <>
          <h3>À propos</h3>
          <table className="about-table">
            <tbody>
              <tr>
                <th>Version</th>
                <td>{info.version}</td>
              </tr>
              <tr>
                <th>Secrets</th>
                <td>{info.secretsEncrypted ? 'Chiffrés par le trousseau du système' : 'Trousseau indisponible : stockés en clair'}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </>
  )
}

/** Vérification automatique au démarrage, si activée et configurée. */
export function autoCheckUpdates(): void {
  const { updates } = useSettings.getState().settings
  if (!updates.autoCheck || updates.source === '') return
  void window.endora.checkForUpdates(updates.source).then((r) => {
    checkedAt = new Date()
    lastResult = r
    if (notifyUpdate(r) && r.ok) toast(`Endora ${r.latest} est disponible (voir les notifications).`)
  })
}
