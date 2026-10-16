import type { TabView } from '@shared/model'
import { useEnvironments } from '../stores/environments'
import { useWorkspace } from '../stores/workspace'
import { isDirty, tabTitle, useTabs } from '../stores/tabs'
import { openMenu } from './ContextMenu'
import { EnvironmentSelector } from './Environments'

const VIEW_BADGE: Record<TabView['kind'], string> = {
  settings: '⚙',
  environment: 'ENV',
  globals: 'GLB',
  collection: 'COL',
  folder: 'DOS',
  runner: 'RUN'
}

export function TabBar() {
  const { tabs, activeId } = useTabs()
  // Titres à jour après un renommage.
  useWorkspace((s) => s.collections)
  useEnvironments((s) => s.environments)
  const actions = useTabs.getState()

  return (
    <div className="tabbar" role="tablist">
      <div className="tabbar-scroll">
        {tabs.map((t) => {
          const dirty = isDirty(t)
          const title = tabTitle(t)
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === activeId}
              className={`tab ${t.id === activeId ? 'active' : ''} ${t.preview ? 'preview' : ''}`}
              title={title}
              onClick={() => actions.activate(t.id)}
              onDoubleClick={() => actions.pin(t.id)}
              onAuxClick={(e) => {
                if (e.button === 1) void actions.close(t.id)
              }}
              onContextMenu={(e) =>
                openMenu(e, [
                  { label: 'Dupliquer l’onglet', onSelect: () => actions.duplicate(t.id), disabled: Boolean(t.view) },
                  'separator',
                  { label: 'Fermer', onSelect: () => void actions.close(t.id) },
                  { label: 'Fermer sans enregistrer', onSelect: () => void actions.close(t.id, { force: true }), disabled: !dirty },
                  { label: 'Fermer les autres onglets', onSelect: () => void actions.closeOthers(t.id), disabled: tabs.length < 2 },
                  { label: 'Fermer tous les onglets', onSelect: () => void actions.closeAll() }
                ])
              }
            >
              {t.view ? (
                <span className="tab-method view-badge">{VIEW_BADGE[t.view.kind]}</span>
              ) : (
                <span className={`tab-method m-${t.draft.method}`}>{t.draft.method}</span>
              )}
              <span className="tab-title">{title}</span>
              <button
                className={`tab-close ${dirty ? 'dirty' : ''}`}
                aria-label="Fermer l’onglet"
                onClick={(e) => {
                  e.stopPropagation()
                  void actions.close(t.id)
                }}
              >
                <span className="dirty-dot" />
                <span className="close-x">×</span>
              </button>
            </div>
          )
        })}
      </div>
      <button className="ghost tab-new" onClick={() => actions.openNew()} title="Nouvel onglet" aria-label="Nouvel onglet">
        +
      </button>
      <div className="tabbar-spacer" />
      <EnvironmentSelector />
    </div>
  )
}
