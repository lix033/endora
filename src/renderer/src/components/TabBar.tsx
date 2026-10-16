import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { t } from '@shared/i18n'
import type { TabView } from '@shared/model'
import { useEnvironments } from '../stores/environments'
import { useWorkspace } from '../stores/workspace'
import { canRename, isDirty, tabTitle, useTabs } from '../stores/tabs'
import { openMenu } from './ContextMenu'
import { EnvironmentSelector } from './Environments'
import { RenameInput } from './RenameInput'
import { horizontalWheel } from './Splitter'

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
  const scroller = useRef<HTMLDivElement | null>(null)
  const scrollerRef = useCallback((el: HTMLDivElement | null) => {
    scroller.current = el
    return horizontalWheel(el)
  }, [])

  // L'onglet actif reste visible quand la barre déborde (ouverture, raccourcis ⌘1…⌘9).
  useEffect(() => {
    scroller.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId, tabs.length])

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
        ref={scrollerRef}
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
        {tabs.map((tab, index) => {
          const dirty = isDirty(tab)
          const title = tabTitle(tab)
          const renamable = canRename(tab)
          const hint = dropHint?.id === tab.id ? `drop-${dropHint.side}` : ''
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={tab.id === activeId}
              className={`tab ${tab.id === activeId ? 'active' : ''} ${tab.preview ? 'preview' : ''} ${dragging === tab.id ? 'dragging' : ''} ${hint}`}
              title={title}
              draggable={renaming !== tab.id}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, tab.id)
                e.dataTransfer.effectAllowed = 'move'
                setDragging(tab.id)
              }}
              onDragEnd={endDrag}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                e.stopPropagation()
                e.dataTransfer.dropEffect = 'move'
                showHint({ id: tab.id, side: sideOf(e) })
              }}
              onDrop={(e) => drop(e, sideOf(e) === 'after' ? (tabs[index + 1]?.id ?? null) : tab.id)}
              onClick={() => actions.activate(tab.id)}
              onDoubleClick={() => (renamable ? startRename(tab.id) : actions.pin(tab.id))}
              onAuxClick={(e) => {
                if (e.button === 1) void actions.close(tab.id)
              }}
              onContextMenu={(e) =>
                openMenu(e, [
                  { label: t('common.rename'), onSelect: () => startRename(tab.id), disabled: !renamable },
                  { label: t('tabs.duplicate'), onSelect: () => actions.duplicate(tab.id), disabled: Boolean(tab.view) },
                  'separator',
                  { label: t('common.close'), onSelect: () => void actions.close(tab.id) },
                  { label: t('tabs.closeForce'), onSelect: () => void actions.close(tab.id, { force: true }), disabled: !dirty },
                  { label: t('tabs.closeOthers'), onSelect: () => void actions.closeOthers(tab.id), disabled: tabs.length < 2 },
                  { label: t('tabs.closeAll'), onSelect: () => void actions.closeAll() }
                ])
              }
            >
              {tab.view ? (
                <span className="tab-method view-badge">{VIEW_BADGE[tab.view.kind]}</span>
              ) : (
                <span className={`tab-method m-${tab.draft.method}`}>{tab.draft.method}</span>
              )}
              {renaming === tab.id ? (
                <RenameInput
                  initial={title}
                  onDone={(name) => {
                    setRenaming(null)
                    if (name !== null) actions.rename(tab.id, name)
                  }}
                />
              ) : (
                <span className="tab-title">{title}</span>
              )}
              <button
                className={`tab-close ${dirty ? 'dirty' : ''}`}
                aria-label={t('tabs.close')}
                onClick={(e) => {
                  e.stopPropagation()
                  void actions.close(tab.id)
                }}
              >
                <span className="dirty-dot" />
                <span className="close-x">×</span>
              </button>
            </div>
          )
        })}
      </div>
      <button className="ghost tab-new" onClick={() => actions.openNew()} title={t('tabs.new')} aria-label={t('tabs.new')}>
        +
      </button>
      <div className="tabbar-spacer" />
      <EnvironmentSelector />
    </div>
  )
}
