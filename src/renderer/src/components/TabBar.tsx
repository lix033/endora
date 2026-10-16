import { useState, type DragEvent } from 'react'
import type { TabView } from '@shared/model'
import { useEnvironments } from '../stores/environments'
import { useWorkspace } from '../stores/workspace'
import { canRename, isDirty, tabTitle, useTabs } from '../stores/tabs'
import { openMenu } from './ContextMenu'
import { EnvironmentSelector } from './Environments'
import { RenameInput } from './RenameInput'

const DRAG_TYPE = 'application/x-endora-tab'

type DropSide = 'before' | 'after'
type DropHint = { id: string; side: DropSide } | null

/** Moitié gauche de l'onglet survolé : avant ; moitié droite : après. */
function sideOf(e: DragEvent): DropSide {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
}

const VIEW_BADGE: Record<TabView['kind'], string> = {
  settings: '⚙',
  environment: 'ENV',
  globals: 'GLB',
  collection: 'COL',
  folder: 'DOS',
  runner: 'RUN',
  mocks: 'SRV'
}

export function TabBar() {
  const { tabs, activeId } = useTabs()
  // Titres à jour après un renommage.
  useWorkspace((s) => s.collections)
  useEnvironments((s) => s.environments)
  const actions = useTabs.getState()
  const [renaming, setRenaming] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<DropHint>(null)

  const showHint = (hint: DropHint) => {
    if (hint?.id !== dropHint?.id || hint?.side !== dropHint?.side) setDropHint(hint)
  }
  const endDrag = () => {
    setDragging(null)
    setDropHint(null)
  }
  const drop = (e: DragEvent, beforeId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    const id = e.dataTransfer.getData(DRAG_TYPE)
    if (id) actions.move(id, beforeId)
    endDrag()
  }
  const startRename = (id: string) => {
    actions.activate(id)
    actions.pin(id)
    setRenaming(id)
  }

  return (
    <div className="tabbar" role="tablist">
      <div
        className="tabbar-scroll"
        // Dépôt après le dernier onglet : place l'onglet à la fin.
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          const last = tabs[tabs.length - 1]
          showHint(last ? { id: last.id, side: 'after' } : null)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropHint(null)
        }}
        onDrop={(e) => drop(e, null)}
      >
        {tabs.map((t, index) => {
          const dirty = isDirty(t)
          const title = tabTitle(t)
          const renamable = canRename(t)
          const hint = dropHint?.id === t.id ? `drop-${dropHint.side}` : ''
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === activeId}
              className={`tab ${t.id === activeId ? 'active' : ''} ${t.preview ? 'preview' : ''} ${dragging === t.id ? 'dragging' : ''} ${hint}`}
              title={title}
              draggable={renaming !== t.id}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, t.id)
                e.dataTransfer.effectAllowed = 'move'
                setDragging(t.id)
              }}
              onDragEnd={endDrag}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                showHint({ id: t.id, side: sideOf(e) })
              }}
              onDrop={(e) => drop(e, sideOf(e) === 'after' ? (tabs[index + 1]?.id ?? null) : t.id)}
              onClick={() => actions.activate(t.id)}
              onDoubleClick={() => (renamable ? startRename(t.id) : actions.pin(t.id))}
              onAuxClick={(e) => {
                if (e.button === 1) void actions.close(t.id)
              }}
              onContextMenu={(e) =>
                openMenu(e, [
                  { label: 'Renommer', onSelect: () => startRename(t.id), disabled: !renamable },
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
              {renaming === t.id ? (
                <RenameInput
                  initial={title}
                  onDone={(name) => {
                    setRenaming(null)
                    if (name !== null) actions.rename(t.id, name)
                  }}
                />
              ) : (
                <span className="tab-title">{title}</span>
              )}
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
