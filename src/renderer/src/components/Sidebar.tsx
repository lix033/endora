import { useState } from 'react'
import logo from '../assets/logo.svg'
import { sidebarSearchRef } from '../shortcuts'
import { useEnvironments } from '../stores/environments'
import { useTabs } from '../stores/tabs'
import { openImportDialog } from '../stores/ui'
import { useWorkspace } from '../stores/workspace'
import { openMenu } from './ContextMenu'
import { CollectionsTree, newCollection, newLooseRequest } from './CollectionsTree'
import { EnvironmentsList } from './Environments'
import { clearHistory, HistoryList } from './HistoryList'

type View = 'collections' | 'environments' | 'history'

export function Sidebar() {
  const [view, setView] = useState<View>('collections')
  const [filter, setFilter] = useState('')
  const historyCount = useWorkspace((s) => s.history.length)

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="brand">
          <img src={logo} alt="" />
          Endora
        </div>
        <div className="row tight">
          <button className="small-btn" onClick={() => openImportDialog()} title="Importer une collection, un environnement ou un cURL">
            Importer
          </button>
          <button className="small-btn" onClick={() => useTabs.getState().openSettings()} title="Paramètres" aria-label="Paramètres">
            ⚙
          </button>
        </div>
      </div>
      <nav className="tabs sidebar-tabs">
        {(
          [
            ['collections', 'Collections'],
            ['environments', 'Environnements'],
            ['history', 'Historique']
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="sidebar-tools">
        {view === 'collections' && (
          <button
            className="ghost icon-btn"
            title="Créer"
            aria-label="Créer"
            onClick={(e) =>
              openMenu(e, [
                { label: 'Nouvelle requête (sans collection)', onSelect: () => newLooseRequest() },
                { label: 'Nouvelle collection', onSelect: () => newCollection() },
                'separator',
                { label: 'Onglet de requête temporaire', onSelect: () => useTabs.getState().openNew() }
              ])
            }
          >
            +
          </button>
        )}
        {view === 'environments' && (
          <button
            className="ghost icon-btn"
            onClick={() => useTabs.getState().openView({ kind: 'environment', environmentId: useEnvironments.getState().create().id })}
            title="Nouvel environnement"
            aria-label="Nouvel environnement"
          >
            +
          </button>
        )}
        {view === 'history' && (
          <button className="ghost small" onClick={() => void clearHistory()} disabled={historyCount === 0}>
            Tout effacer
          </button>
        )}
        <input ref={sidebarSearchRef} className="filter" value={filter} placeholder="Filtrer" onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="sidebar-body">
        {view === 'collections' && <CollectionsTree filter={filter} />}
        {view === 'environments' && <EnvironmentsList filter={filter} />}
        {view === 'history' && <HistoryList filter={filter} />}
      </div>
    </aside>
  )
}
