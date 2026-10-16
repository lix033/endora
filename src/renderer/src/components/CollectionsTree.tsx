import { useEffect, useMemo, useRef, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { create } from 'zustand'
import { exportCollection } from '@shared/collection-v21'
import { emptyDraft, isLoose, type Collection, type TreeItem } from '@shared/model'
import { useTabs } from '../stores/tabs'
import { confirmDialog, openImportDialog, toast } from '../stores/ui'
import { useWorkspace } from '../stores/workspace'
import { openMenu } from './ContextMenu'
import { copyAsCurl } from './RequestPanel'

const DRAG_TYPE = 'application/x-endora-item'

interface TreeUi {
  expanded: Set<string>
  renaming: string | null
  dropTarget: string | null
  toggle: (id: string) => void
  expand: (...ids: string[]) => void
  setRenaming: (id: string | null) => void
  setDropTarget: (id: string | null) => void
}

const useTreeUi = create<TreeUi>((set, get) => ({
  expanded: new Set(),
  renaming: null,
  dropTarget: null,
  toggle: (id) => {
    const expanded = new Set(get().expanded)
    if (expanded.has(id)) expanded.delete(id)
    else expanded.add(id)
    set({ expanded })
  },
  expand: (...ids) => set({ expanded: new Set([...get().expanded, ...ids]) }),
  setRenaming: (renaming) => set({ renaming }),
  setDropTarget: (dropTarget) => set({ dropTarget })
}))

export const shortMethod = (m: string): string =>
  ({ DELETE: 'DEL', OPTIONS: 'OPT', PATCH: 'PATCH' })[m] ?? (m.length > 5 ? m.slice(0, 4) : m)

const fileName = (name: string): string => `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'collection'}.collection.json`

function matches(item: TreeItem, filter: string): boolean {
  if (filter === '') return true
  if (item.name.toLowerCase().includes(filter)) return true
  if (item.type === 'request') return item.request.url.toLowerCase().includes(filter)
  return item.items.some((i) => matches(i, filter))
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (value: string | null) => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      ref={ref}
      className="rename"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  )
}

/** Ajoute une requête vide, l'ouvre dans un onglet et passe en renommage. */
function addRequest(collectionId: string, parentId: string | null): void {
  const id = useWorkspace.getState().addRequest(collectionId, parentId, 'Nouvelle requête', emptyDraft())
  if (!id) return
  useTreeUi.getState().expand(collectionId, ...(parentId ? [parentId] : []))
  useTabs.getState().openItem(collectionId, id, { preview: false })
  useTreeUi.getState().setRenaming(id)
}

function addFolder(collectionId: string, parentId: string | null): void {
  const id = useWorkspace.getState().addFolder(collectionId, parentId)
  if (!id) return
  useTreeUi.getState().expand(collectionId, ...(parentId ? [parentId] : []))
  useTreeUi.getState().setRenaming(id)
}

async function exportToFile(c: Collection): Promise<void> {
  const r = await window.endora.saveTextFile(fileName(c.name), JSON.stringify(exportCollection(c), null, 2))
  if (r.ok) toast(`Collection exportée : ${r.path}`)
  else if (!r.canceled) toast(`Export impossible : ${r.message}`, 'error')
}

async function confirmDelete(kind: string, name: string): Promise<boolean> {
  const choice = await confirmDialog(`Supprimer ${kind}`, `« ${name} » sera supprimé définitivement.`, [
    { label: 'Annuler', value: 'cancel' },
    { label: 'Supprimer', value: 'delete', variant: 'danger' }
  ])
  return choice === 'delete'
}

// --- Glisser-déposer -------------------------------------------------------------------------

type DropPlacement = { parentId: string | null; beforeId?: string }

function dropHandlers(targetId: string, collectionId: string, placement: DropPlacement) {
  const ui = useTreeUi.getState()
  return {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      if (useTreeUi.getState().dropTarget !== targetId) ui.setDropTarget(targetId)
    },
    onDragLeave: () => {
      if (useTreeUi.getState().dropTarget === targetId) ui.setDropTarget(null)
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ui.setDropTarget(null)
      const raw = e.dataTransfer.getData(DRAG_TYPE)
      if (!raw) return
      const from = JSON.parse(raw) as { collectionId: string; itemId: string }
      useWorkspace.getState().moveItem(from, { collectionId, ...placement })
      if (placement.parentId) ui.expand(placement.parentId)
      ui.expand(collectionId)
    }
  }
}

// --- Nœuds -----------------------------------------------------------------------------------

function ItemNode({ item, collectionId, parentId, depth, filter }: { item: TreeItem; collectionId: string; parentId: string | null; depth: number; filter: string }) {
  const { expanded, renaming, dropTarget, toggle, setRenaming } = useTreeUi()
  const ws = useWorkspace.getState()
  const tabs = useTabs.getState()
  const activeSource = useTabs((s) => s.tabs.find((t) => t.id === s.activeId)?.source)
  if (!matches(item, filter)) return null

  const isFolder = item.type === 'folder'
  const open = isFolder && (expanded.has(item.id) || filter !== '')
  const active = activeSource?.kind === 'collection' && activeSource.itemId === item.id
  const placement: DropPlacement = isFolder ? { parentId: item.id } : { parentId, beforeId: item.id }

  const menu = (e: MouseEvent) =>
    openMenu(
      e,
      isFolder
        ? [
            { label: 'Ouvrir (auth, scripts)', onSelect: () => tabs.openView({ kind: 'folder', collectionId, folderId: item.id }) },
            { label: 'Lancer le dossier', onSelect: () => openRunner(collectionId, item.id) },
            'separator',
            { label: 'Ajouter une requête', onSelect: () => addRequest(collectionId, item.id) },
            { label: 'Ajouter un dossier', onSelect: () => addFolder(collectionId, item.id) },
            'separator',
            { label: 'Renommer', onSelect: () => setRenaming(item.id) },
            { label: 'Dupliquer', onSelect: () => ws.duplicateItem(collectionId, item.id) },
            'separator',
            {
              label: 'Supprimer',
              danger: true,
              onSelect: () => void confirmDelete('le dossier', item.name).then((ok) => ok && ws.deleteItem(collectionId, item.id))
            }
          ]
        : [
            { label: 'Ouvrir dans un onglet', onSelect: () => tabs.openItem(collectionId, item.id, { preview: false }) },
            { label: 'Renommer', onSelect: () => setRenaming(item.id) },
            { label: 'Dupliquer', onSelect: () => ws.duplicateItem(collectionId, item.id) },
            { label: 'Copier en cURL', onSelect: () => void copyAsCurl(item.request) },
            'separator',
            {
              label: 'Supprimer',
              danger: true,
              onSelect: () => void confirmDelete('la requête', item.name).then((ok) => ok && ws.deleteItem(collectionId, item.id))
            }
          ]
    )

  return (
    <>
      <div
        className={`tree-row ${active ? 'active' : ''} ${dropTarget === item.id ? 'drop' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={renaming !== item.id}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ collectionId, itemId: item.id }))
          e.dataTransfer.effectAllowed = 'move'
        }}
        {...dropHandlers(item.id, collectionId, placement)}
        onClick={() => (isFolder ? toggle(item.id) : tabs.openItem(collectionId, item.id, { preview: true }))}
        onDoubleClick={() =>
          isFolder ? tabs.openView({ kind: 'folder', collectionId, folderId: item.id }) : tabs.openItem(collectionId, item.id, { preview: false })
        }
        onContextMenu={menu}
      >
        {isFolder ? <span className={`chevron ${open ? 'open' : ''}`}>›</span> : <span className={`tree-method m-${item.request.method}`}>{shortMethod(item.request.method)}</span>}
        {isFolder && <span className="folder-icon" aria-hidden />}
        {renaming === item.id ? (
          <RenameInput
            initial={item.name}
            onDone={(name) => {
              setRenaming(null)
              if (name !== null) ws.renameItem(collectionId, item.id, name)
            }}
          />
        ) : (
          <span className="tree-name">{item.name}</span>
        )}
        <button className="ghost row-menu" aria-label="Actions" onClick={menu}>
          ⋯
        </button>
      </div>
      {open &&
        item.items.map((child) => <ItemNode key={child.id} item={child} collectionId={collectionId} parentId={item.id} depth={depth + 1} filter={filter} />)}
      {open && item.items.length === 0 && (
        <div className="tree-empty" style={{ paddingLeft: 22 + (depth + 1) * 14 }}>
          Dossier vide
        </div>
      )}
    </>
  )
}

function CollectionNode({ c, filter }: { c: Collection; filter: string }) {
  const { expanded, renaming, dropTarget, toggle, setRenaming } = useTreeUi()
  const ws = useWorkspace.getState()
  const visible = filter === '' || c.name.toLowerCase().includes(filter) || c.items.some((i) => matches(i, filter))
  if (!visible) return null
  const open = expanded.has(c.id) || filter !== ''
  const childFilter = c.name.toLowerCase().includes(filter) ? '' : filter

  const menu = (e: MouseEvent) =>
    openMenu(e, [
      { label: 'Ouvrir (auth, scripts, variables)', onSelect: () => useTabs.getState().openView({ kind: 'collection', collectionId: c.id }) },
      { label: 'Lancer la collection', onSelect: () => openRunner(c.id) },
      'separator',
      { label: 'Ajouter une requête', onSelect: () => addRequest(c.id, null) },
      { label: 'Ajouter un dossier', onSelect: () => addFolder(c.id, null) },
      'separator',
      { label: 'Renommer', onSelect: () => setRenaming(c.id) },
      { label: 'Dupliquer', onSelect: () => ws.duplicateCollection(c.id) },
      { label: 'Exporter (v2.1)…', onSelect: () => void exportToFile(c) },
      'separator',
      {
        label: 'Supprimer',
        danger: true,
        onSelect: () => void confirmDelete('la collection', c.name).then((ok) => ok && ws.deleteCollection(c.id))
      }
    ])

  return (
    <div className="tree-collection">
      <div
        className={`tree-row collection ${dropTarget === c.id ? 'drop' : ''}`}
        {...dropHandlers(c.id, c.id, { parentId: null })}
        onClick={() => toggle(c.id)}
        onDoubleClick={() => useTabs.getState().openView({ kind: 'collection', collectionId: c.id })}
        onContextMenu={menu}
      >
        <span className={`chevron ${open ? 'open' : ''}`}>›</span>
        {renaming === c.id ? (
          <RenameInput
            initial={c.name}
            onDone={(name) => {
              setRenaming(null)
              if (name !== null) ws.renameCollection(c.id, name)
            }}
          />
        ) : (
          <span className="tree-name">{c.name}</span>
        )}
        <button className="ghost row-menu" aria-label="Actions" onClick={menu}>
          ⋯
        </button>
      </div>
      {open &&
        c.items.map((item) => <ItemNode key={item.id} item={item} collectionId={c.id} parentId={null} depth={1} filter={childFilter} />)}
      {open && c.items.length === 0 && (
        <div className="tree-empty" style={{ paddingLeft: 36 }}>
          Collection vide.{' '}
          <button className="link" onClick={() => addRequest(c.id, null)}>
            Ajouter une requête
          </button>
        </div>
      )}
    </div>
  )
}

/** Requêtes libres : enregistrées sans collection, créées en un clic. */
function LooseSection({ filter }: { filter: string }) {
  const loose = useWorkspace((s) => s.collections.find(isLoose))
  const { expanded, toggle, dropTarget } = useTreeUi()
  const open = !expanded.has('loose-collapsed') || filter !== ''
  const items = loose?.items ?? []
  if (filter !== '' && !items.some((i) => matches(i, filter))) return null
  return (
    <div className="tree-collection loose">
      <div
        className={`tree-row collection ${loose && dropTarget === loose.id ? 'drop' : ''}`}
        {...(loose ? dropHandlers(loose.id, loose.id, { parentId: null }) : {})}
        onClick={() => toggle('loose-collapsed')}
        onContextMenu={(e) =>
          openMenu(e, [
            { label: 'Nouvelle requête', onSelect: () => newLooseRequest() },
            { label: 'Lancer toutes les requêtes', onSelect: () => loose && openRunner(loose.id), disabled: items.length === 0 }
          ])
        }
      >
        <span className={`chevron ${open ? 'open' : ''}`}>›</span>
        <span className="tree-name">Requêtes libres</span>
        <button
          className="ghost row-menu always"
          title="Nouvelle requête sans collection"
          aria-label="Nouvelle requête sans collection"
          onClick={(e) => {
            e.stopPropagation()
            newLooseRequest()
          }}
        >
          +
        </button>
      </div>
      {open && loose && items.map((item) => <ItemNode key={item.id} item={item} collectionId={loose.id} parentId={null} depth={1} filter={filter} />)}
      {open && items.length === 0 && (
        <div className="tree-empty" style={{ paddingLeft: 36 }}>
          <button className="link" onClick={() => newLooseRequest()}>
            + Créer une requête sans collection
          </button>
        </div>
      )}
    </div>
  )
}

/** Création rapide : une requête enregistrée hors collection, ouverte et prête à être nommée. */
export function newLooseRequest(): void {
  const loose = useWorkspace.getState().ensureLoose()
  useTreeUi.getState().expand(loose.id)
  addRequest(loose.id, null)
}

export function openRunner(collectionId: string, folderId?: string): void {
  useTabs.getState().openView({ kind: 'runner', collectionId, ...(folderId ? { folderId } : {}) })
}

export function CollectionsTree({ filter }: { filter: string }) {
  const all = useWorkspace((s) => s.collections)
  // Le filtrage se fait hors du sélecteur : un nouveau tableau à chaque lecture bouclerait le rendu.
  const collections = useMemo(() => all.filter((c) => !isLoose(c)), [all])
  const f = filter.trim().toLowerCase()

  let body: ReactNode
  if (collections.length === 0) {
    body = (
      <div className="sidebar-empty">
        <p>Aucune collection.</p>
        <p className="muted small">Regroupez vos requêtes dans des collections, ou importez un fichier de collection v2.1.</p>
        <div className="row">
          <button onClick={() => newCollection()}>Créer une collection</button>
          <button onClick={() => openImportDialog()}>Importer</button>
        </div>
      </div>
    )
  } else {
    body = collections.map((c) => <CollectionNode key={c.id} c={c} filter={f} />)
  }
  return (
    <div className="tree">
      <LooseSection filter={f} />
      <div className="history-day">Collections</div>
      {body}
    </div>
  )
}

export function newCollection(): void {
  const c = useWorkspace.getState().createCollection()
  useTreeUi.getState().expand(c.id)
  useTreeUi.getState().setRenaming(c.id)
}
