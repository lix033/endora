import { useState } from 'react'
import { t } from '@shared/i18n'
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
        <button className="small-btn" onClick={() => openImportDialog()} title={t('sidebar.importTitle')}>
          {t('common.import')}
        </button>
      </div>
      <nav className="tabs sidebar-tabs">
        {(
          [
            ['collections', t('sidebar.collections')],
            ['environments', t('sidebar.environments')],
            ['history', t('sidebar.history')]
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
            title={t('sidebar.create')}
            aria-label={t('sidebar.create')}
            onClick={(e) =>
              openMenu(e, [
                { label: t('sidebar.newLooseRequest'), onSelect: () => newLooseRequest() },
                { label: t('sidebar.newCollection'), onSelect: () => newCollection() },
                'separator',
                { label: t('sidebar.tempTab'), onSelect: () => useTabs.getState().openNew() }
              ])
            }
          >
            +
          </button>
        )}
        {view === 'environments' && (
          <button
            className="ghost icon-btn"
            onClick={() => useTabs.getState().openView({ kind: 'environment', environmentId: useEnvironments.getState().create(t('env.newName')).id })}
            title={t('sidebar.newEnvironment')}
            aria-label={t('sidebar.newEnvironment')}
          >
            +
          </button>
        )}
        {view === 'history' && (
          <button className="ghost small" onClick={() => void clearHistory()} disabled={historyCount === 0}>
            {t('common.clearAll')}
          </button>
        )}
        <input ref={sidebarSearchRef} className="filter" value={filter} placeholder={t('sidebar.filter')} onChange={(e) => setFilter(e.target.value)} />
      </div>
      <div className="sidebar-body">
        {view === 'collections' && <CollectionsTree filter={filter} />}
        {view === 'environments' && <EnvironmentsList filter={filter} />}
        {view === 'history' && <HistoryList filter={filter} />}
      </div>
    </aside>
  )
}
