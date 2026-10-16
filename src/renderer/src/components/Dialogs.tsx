import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { DEFAULT_IMPORT_OPTIONS, type ImportConversion, type ImportOptions } from '@shared/api'
import { importCollection, importRequest } from '@shared/collection-v21'
import { t } from '@shared/i18n'
import { isLoose, LOOSE_COLLECTION_ID, walkRequests, type Collection, type TreeItem } from '@shared/model'
import { parseEnvironmentFile } from '@shared/variables'
import { useEnvironments } from '../stores/environments'
import { useTabs } from '../stores/tabs'
import { toast, useUi, type Dialog, type SaveTarget } from '../stores/ui'
import { useWorkspace } from '../stores/workspace'

function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header>{title}</header>
        <div className="modal-body">{children}</div>
        <footer>{footer}</footer>
      </div>
    </div>
  )
}

function ConfirmModal({ dialog }: { dialog: Extract<Dialog, { kind: 'confirm' }> }) {
  return (
    <Modal
      title={dialog.title}
      onClose={() => dialog.resolve('cancel')}
      footer={dialog.buttons.map((b) => (
        <button key={b.value} className={b.variant ?? ''} autoFocus={b.variant === 'primary' || (b.variant === 'danger' && dialog.buttons.length === 2)} onClick={() => dialog.resolve(b.value)}>
          {b.label}
        </button>
      ))}
    >
      <p>{dialog.message}</p>
    </Modal>
  )
}

// --- Enregistrement ------------------------------------------------------------------------

interface Location {
  collectionId: string
  parentId: string | null
  label: string
  depth: number
}

function locations(collections: Collection[]): Location[] {
  const out: Location[] = []
  const walk = (c: Collection, items: TreeItem[], depth: number) => {
    for (const it of items) {
      if (it.type !== 'folder') continue
      out.push({ collectionId: c.id, parentId: it.id, label: it.name, depth })
      walk(c, it.items, depth + 1)
    }
  }
  // Les requêtes libres sont toujours proposées en premier, même avant leur première utilisation.
  out.push({ collectionId: LOOSE_COLLECTION_ID, parentId: null, label: t('save.loose'), depth: 0 })
  for (const c of collections) {
    if (isLoose(c)) continue
    out.push({ collectionId: c.id, parentId: null, label: c.name, depth: 0 })
    walk(c, c.items, 1)
  }
  return out
}

let lastLocation: { collectionId: string; parentId: string | null } | null = null

function SaveModal({ dialog }: { dialog: Extract<Dialog, { kind: 'save' }> }) {
  const collections = useWorkspace((s) => s.collections)
  const locs = locations(collections)
  const initial = locs.find((l) => l.collectionId === lastLocation?.collectionId && l.parentId === lastLocation?.parentId) ?? locs[0]
  const [name, setName] = useState(dialog.defaultName)
  const [selected, setSelected] = useState<{ collectionId: string; parentId: string | null } | null>(initial ?? null)
  const [newName, setNewName] = useState<string | null>(null)

  const submit = () => {
    if (!selected || name.trim() === '') return
    lastLocation = selected
    if (selected.collectionId === LOOSE_COLLECTION_ID) useWorkspace.getState().ensureLoose()
    const target: SaveTarget = { ...selected, name: name.trim() }
    dialog.resolve(target)
  }

  const createCollection = () => {
    if (!newName?.trim()) return
    const c = useWorkspace.getState().createCollection(newName.trim())
    setSelected({ collectionId: c.id, parentId: null })
    setNewName(null)
  }

  return (
    <Modal
      title={dialog.title}
      onClose={() => dialog.resolve(null)}
      footer={
        <>
          <button onClick={() => dialog.resolve(null)}>{t('common.cancel')}</button>
          <button className="primary" disabled={!selected || name.trim() === ''} onClick={submit}>
            {t('common.save')}
          </button>
        </>
      }
    >
      <label className="field">
        <span>{t('save.requestName')}</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
      <div className="field">
        <span>{t('save.saveTo')}</span>
        <div className="location-list">
          {locs.map((l) => {
            const isSel = selected?.collectionId === l.collectionId && selected.parentId === l.parentId
            return (
              <button
                key={`${l.collectionId}/${l.parentId ?? ''}`}
                className={`location ${isSel ? 'selected' : ''}`}
                style={{ paddingLeft: 10 + l.depth * 16 }}
                onClick={() => setSelected({ collectionId: l.collectionId, parentId: l.parentId })}
                onDoubleClick={submit}
              >
                <span className={l.collectionId === LOOSE_COLLECTION_ID ? 'loose-icon' : l.parentId ? 'folder-icon' : 'collection-icon'} aria-hidden />
                {l.label}
              </button>
            )
          })}
        </div>
        {newName === null ? (
          <button className="link" onClick={() => setNewName(t('save.newCollectionName'))}>
            {t('save.newCollection')}
          </button>
        ) : (
          <div className="row">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createCollection()
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setNewName(null)
                }
              }}
            />
            <button onClick={createCollection}>{t('common.create')}</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// --- Import --------------------------------------------------------------------------------

export interface ImportReport {
  source: string
  ok: boolean
  message: string
}

/** Applique une conversion : collections ajoutées, environnements créés, globales fusionnées, requêtes ouvertes. */
function applyConversion(source: string, r: ImportConversion): ImportReport {
  if (!r.ok) return { source, ok: false, message: r.message }
  const parts: string[] = []
  const collections: Collection[] = []
  const errors: string[] = []
  for (const raw of r.collections) {
    const c = importCollection(raw)
    if (c.ok) collections.push(c.collection)
    else errors.push(c.message)
  }
  if (collections.length > 0) {
    useWorkspace.getState().addCollections(collections)
    const count = collections.reduce((n, c) => n + [...walkRequests(c.items)].length, 0)
    parts.push(`${collections.length === 1 ? t('import.collectionOne', { name: collections[0]!.name }) : t('import.collectionMany', { count: collections.length })} (${t('import.requestCount', { count })})`)
  }
  for (const raw of r.environments) {
    const env = parseEnvironmentFile(raw)
    if (env?.kind === 'environment') {
      useEnvironments.getState().create(env.name, env.values)
      parts.push(t('import.environment', { name: env.name }))
    }
  }
  for (const raw of r.globals) {
    const g = parseEnvironmentFile({ ...(raw as object), _postman_variable_scope: 'globals' })
    if (g) {
      const store = useEnvironments.getState()
      const keys = new Set(g.values.map((v) => v.key))
      store.setGlobals([...store.globals.filter((v) => !keys.has(v.key)), ...g.values])
      parts.push(t('import.globals', { count: g.values.length }))
    }
  }
  for (const req of r.requests) {
    useTabs.getState().openNew(importRequest(req.request), req.name || undefined)
    parts.push(t('import.requestOpened'))
  }
  if (errors.length > 0) return { source, ok: false, message: errors.join(' ; ') }
  return { source, ok: true, message: `${r.formatLabel} → ${parts.join(', ') || t('import.nothing')}` }
}

/** Importe des textes (fichiers, texte collé) via la détection du process principal. */
export async function importTexts(files: Array<{ name: string; text: string }>, options: ImportOptions = DEFAULT_IMPORT_OPTIONS): Promise<ImportReport[]> {
  const reports: ImportReport[] = []
  for (const f of files) reports.push(applyConversion(f.name || t('import.pastedText'), await window.endora.convertImport(f.name, f.text, options)))
  return reports
}

type ImportSource = 'files' | 'link' | 'text'

function ImportModal({ dialog }: { dialog: Extract<Dialog, { kind: 'import' }> }) {
  const close = useUi((s) => s.closeDialog)
  const [source, setSource] = useState<ImportSource>(dialog.initialText ? 'text' : 'files')
  const [text, setText] = useState(dialog.initialText ?? '')
  const [link, setLink] = useState('')
  const [options, setOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS)
  const [reports, setReports] = useState<ImportReport[]>([])
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)

  const run = async (task: () => Promise<ImportReport[]>) => {
    setBusy(true)
    setReports([])
    const r = await task()
    setBusy(false)
    setReports(r)
    const ok = r.filter((x) => x.ok).length
    if (ok > 0) toast(ok === 1 ? t('import.done') : t('import.doneMany', { count: ok }))
  }

  const pickFiles = async () => {
    const r = await window.endora.openTextFiles()
    if (r.ok) await run(() => importTexts(r.files, options))
    else if (!r.canceled) setReports([{ source: t('import.files'), ok: false, message: r.message }])
  }

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files]
    if (files.length === 0) return
    await run(async () => importTexts(await Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() }))), options))
  }

  return (
    <Modal
      title={t('import.title')}
      onClose={close}
      footer={
        <>
          <button onClick={close}>{reports.length > 0 ? t('common.close') : t('common.cancel')}</button>
          {source === 'text' && (
            <button className="primary" disabled={busy || text.trim() === ''} onClick={() => void run(() => importTexts([{ name: '', text }], options))}>
              {t('import.importText')}
            </button>
          )}
          {source === 'link' && (
            <button
              className="primary"
              disabled={busy || !/^https?:\/\//i.test(link.trim())}
              onClick={() => void run(async () => [applyConversion(link.trim(), await window.endora.fetchImport(link.trim(), options))])}
            >
              {t('import.importLink')}
            </button>
          )}
        </>
      }
    >
      <nav className="tabs import-tabs">
        {(
          [
            ['files', t('import.files')],
            ['link', t('import.link')],
            ['text', t('import.rawText')]
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={source === id ? 'active' : ''} onClick={() => setSource(id)}>
            {label}
          </button>
        ))}
      </nav>
      {source === 'files' && (
        <div
          className={`drop-zone ${dragging ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => void onDrop(e)}
        >
          <p>{t('import.drop')}</p>
          <button onClick={() => void pickFiles()} disabled={busy}>
            {t('import.choose')}
          </button>
        </div>
      )}
      {source === 'link' && (
        <input className="wide-input" autoFocus placeholder="https://example.com/openapi.yaml" value={link} onChange={(e) => setLink(e.target.value)} />
      )}
      {source === 'text' && (
        <textarea
          autoFocus
          className="import-text"
          value={text}
          spellCheck={false}
          placeholder={t('import.textPlaceholder')}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      <p className="muted small">
        {t('import.formats')}
      </p>
      <details className="import-options">
        <summary className="muted small">{t('import.openapiOptions')}</summary>
        <div className="form-grid">
          <label>{t('import.folders')}</label>
          <select value={options.folderStrategy} onChange={(e) => setOptions({ ...options, folderStrategy: e.target.value as ImportOptions['folderStrategy'] })}>
            <option value="Paths">{t('import.byPath')}</option>
            <option value="Tags">{t('import.byTag')}</option>
          </select>
          <label>{t('import.values')}</label>
          <select value={options.parametersResolution} onChange={(e) => setOptions({ ...options, parametersResolution: e.target.value as ImportOptions['parametersResolution'] })}>
            <option value="Schema">{t('import.fromSchema')}</option>
            <option value="Example">{t('import.fromExample')}</option>
          </select>
        </div>
      </details>
      {busy && <p className="muted">{t('import.converting')}</p>}
      {reports.length > 0 && (
        <ul className="import-reports">
          {reports.map((r, i) => (
            <li key={i} className={r.ok ? 'ok-text' : 'error-text'}>
              <strong>{r.source}</strong> : {r.message}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">{t('import.tip')}</p>
    </Modal>
  )
}

export function DialogHost() {
  const dialog = useUi((s) => s.dialog)
  if (!dialog) return null
  if (dialog.kind === 'confirm') return <ConfirmModal dialog={dialog} />
  if (dialog.kind === 'save') return <SaveModal dialog={dialog} />
  return <ImportModal dialog={dialog} />
}

export function Toasts() {
  const { toasts, dismissToast } = useUi()
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => dismissToast(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
