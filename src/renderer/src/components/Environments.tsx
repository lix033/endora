import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { lookupVariable, SCOPE_LABELS, visibleVariables } from '@shared/variables'
import { tabCollection } from '../stores/context'
import { useEnvironments } from '../stores/environments'
import { useTabs } from '../stores/tabs'
import { confirmDialog } from '../stores/ui'
import { openMenu } from './ContextMenu'
import { exportEnvironment } from './EntityViews'
import { useScopes } from './VarInput'

/** Barre latérale : globales et environnements. */
export function EnvironmentsList({ filter }: { filter: string }) {
  const { environments, activeId, globals } = useEnvironments()
  const activeTab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId))
  const f = filter.trim().toLowerCase()
  const open = (environmentId: string, preview: boolean) => useTabs.getState().openView({ kind: 'environment', environmentId }, { preview })

  const menu = (e: MouseEvent, id: string) => {
    const env = environments.find((x) => x.id === id)!
    const store = useEnvironments.getState()
    openMenu(e, [
      { label: activeId === id ? 'Désactiver' : 'Définir comme actif', onSelect: () => store.setActive(activeId === id ? null : id) },
      { label: 'Ouvrir', onSelect: () => open(id, false) },
      { label: 'Dupliquer', onSelect: () => store.duplicate(id) },
      { label: 'Exporter…', onSelect: () => void exportEnvironment(env.name, env.values, 'environment', env.id) },
      'separator',
      {
        label: 'Supprimer',
        danger: true,
        onSelect: () =>
          void confirmDialog('Supprimer l’environnement', `« ${env.name} » et ses variables seront supprimés définitivement.`, [
            { label: 'Annuler', value: 'cancel' },
            { label: 'Supprimer', value: 'delete', variant: 'danger' }
          ]).then((c) => c === 'delete' && store.remove(id))
      }
    ])
  }

  return (
    <div className="tree">
      <div
        className={`tree-row ${activeTab?.view?.kind === 'globals' ? 'active' : ''}`}
        onClick={() => useTabs.getState().openView({ kind: 'globals' }, { preview: true })}
        onDoubleClick={() => useTabs.getState().openView({ kind: 'globals' })}
      >
        <span className="env-icon globe" aria-hidden />
        <span className="tree-name">Globales</span>
        <span className="muted small">{globals.filter((g) => g.key).length}</span>
      </div>
      <div className="history-day">Environnements</div>
      {environments.length === 0 && (
        <div className="sidebar-empty">
          <p className="muted small">Un environnement regroupe des variables (URL de base, jetons…) que vous activez selon le contexte : dev, recette, prod.</p>
          <button onClick={() => open(useEnvironments.getState().create().id, false)}>Créer un environnement</button>
        </div>
      )}
      {environments
        .filter((e) => f === '' || e.name.toLowerCase().includes(f))
        .map((env) => (
          <div
            key={env.id}
            className={`tree-row ${activeTab?.view?.kind === 'environment' && activeTab.view.environmentId === env.id ? 'active' : ''}`}
            onClick={() => open(env.id, true)}
            onDoubleClick={() => open(env.id, false)}
            onContextMenu={(e) => menu(e, env.id)}
          >
            <button
              className={`env-radio ${activeId === env.id ? 'on' : ''}`}
              title={activeId === env.id ? 'Environnement actif' : 'Activer'}
              onClick={(e) => {
                e.stopPropagation()
                useEnvironments.getState().setActive(activeId === env.id ? null : env.id)
              }}
              aria-label="Activer l’environnement"
            />
            <span className="tree-name">{env.name}</span>
            <button className="ghost row-menu" aria-label="Actions" onClick={(e) => menu(e, env.id)}>
              ⋯
            </button>
          </div>
        ))}
    </div>
  )
}

/** Sélecteur de l'environnement actif et aperçu rapide des variables visibles. */
export function EnvironmentSelector() {
  const { environments, activeId } = useEnvironments()
  const activeTab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId))
  const collection = tabCollection(activeTab)
  const scopes = useScopes(collection?.id)
  const [peek, setPeek] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!peek) return
    const close = (e: globalThis.MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setPeek(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [peek])

  const vars = visibleVariables(scopes)

  return (
    <div className="env-selector" ref={ref}>
      <select
        value={activeId ?? ''}
        onChange={(e) => useEnvironments.getState().setActive(e.target.value || null)}
        aria-label="Environnement actif"
        title="Environnement actif"
      >
        <option value="">Aucun environnement</option>
        {environments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </select>
      <button className={`ghost peek-btn ${peek ? 'on' : ''}`} onClick={() => setPeek(!peek)} title="Aperçu des variables">
        {'{ }'}
      </button>
      {peek && (
        <div className="peek">
          <div className="peek-head">
            <strong>Variables visibles</strong>
            <span className="muted small">{collection ? `collection « ${collection.name} »` : 'hors collection'}</span>
          </div>
          {vars.length === 0 ? (
            <p className="muted small">Aucune variable. Créez-en dans un environnement, la collection ou les globales.</p>
          ) : (
            <table className="peek-table">
              <tbody>
                {vars.map((v) => {
                  const r = lookupVariable(scopes, v.key)!
                  return (
                    <tr key={v.key}>
                      <th className="mono">{v.key}</th>
                      <td className="mono">{r.type === 'secret' ? '●●●●●●' : r.value}</td>
                      <td className="muted small">
                        {SCOPE_LABELS[r.scope]}
                        {r.label ? ` · ${r.label}` : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div className="row">
            {activeId && (
              <button className="link" onClick={() => useTabs.getState().openView({ kind: 'environment', environmentId: activeId })}>
                Modifier l’environnement
              </button>
            )}
            <button className="link" onClick={() => useTabs.getState().openView({ kind: 'globals' })}>
              Modifier les globales
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
