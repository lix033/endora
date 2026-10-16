// Onglets d'édition : environnement, globales, collection et dossier (enregistrement automatique).

import { useMemo, useState } from 'react'
import { effectiveAuth, type AuthConfig } from '@shared/auth'
import { exportCollection } from '@shared/collection-v21'
import { t } from '@shared/i18n'
import { findItem, type Scripts } from '@shared/model'
import { exportEnvironmentFile } from '@shared/variables'
import { parentChain } from '../stores/context'
import { useEnvironments } from '../stores/environments'
import { useScrollMemory, useTabState } from '../stores/tabui'
import { useTabs, type Tab } from '../stores/tabs'
import { toast } from '../stores/ui'
import { useWorkspace } from '../stores/workspace'
import { AuthEditor } from './AuthEditor'
import { ScriptsEditor } from './ScriptsEditor'
import { horizontalWheel } from './Splitter'
import { useScopes } from './VarInput'
import { VariablesTable } from './VariablesTable'

const fileName = (name: string, suffix: string) => `${name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export'}.${suffix}.json`

export async function exportEnvironment(name: string, values: Parameters<typeof exportEnvironmentFile>[1], scope: 'environment' | 'globals', id: string) {
  const r = await window.endora.saveTextFile(fileName(name, scope === 'globals' ? 'globals' : 'environment'), JSON.stringify(exportEnvironmentFile(name, values, scope, id), null, 2))
  if (r.ok) toast(t('entity.exported', { path: r.path }))
  else if (!r.canceled) toast(t('entity.exportFailed', { message: r.message }), 'error')
}

function EditableTitle({ value, onRename }: { value: string; onRename: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  if (draft === null) {
    return (
      <h2 className="entity-title" title={t('entity.clickRename')} onClick={() => setDraft(value)}>
        {value}
      </h2>
    )
  }
  const commit = () => {
    if (draft.trim()) onRename(draft.trim())
    setDraft(null)
  }
  return (
    <input
      className="entity-title-input"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(null)
      }}
    />
  )
}

export function EnvironmentView({ tab }: { tab: Tab }) {
  const view = tab.view
  const envs = useEnvironments()
  if (view?.kind === 'globals') {
    return (
      <div className="entity">
        <header className="entity-head">
          <h2 className="entity-title">{t('entity.globals')}</h2>
          <button onClick={() => void exportEnvironment(t('entity.globals'), envs.globals, 'globals', 'globals')}>{t('entity.export')}</button>
        </header>
        <VariablesTable
          values={envs.globals}
          onChange={(v) => envs.setGlobals(v)}
          hint={t('entity.globalsHint')}
        />
      </div>
    )
  }
  if (view?.kind !== 'environment') return null
  const env = envs.environments.find((e) => e.id === view.environmentId)
  if (!env) return <div className="entity muted">{t('entity.envDeleted')}</div>
  const active = envs.activeId === env.id
  return (
    <div className="entity">
      <header className="entity-head">
        <EditableTitle value={env.name} onRename={(n) => envs.rename(env.id, n)} />
        <div className="row">
          <button className={active ? 'primary' : ''} onClick={() => envs.setActive(active ? null : env.id)}>
            {active ? t('entity.envActive') : t('entity.activate')}
          </button>
          <button onClick={() => void exportEnvironment(env.name, env.values, 'environment', env.id)}>{t('entity.export')}</button>
        </div>
      </header>
      <VariablesTable
        values={env.values}
        onChange={(v) => envs.setValues(env.id, v)}
        hint={t('entity.envHint')}
      />
    </div>
  )
}

type EntitySection = 'overview' | 'auth' | 'scripts' | 'variables'

export function CollectionView({ tab }: { tab: Tab }) {
  const view = tab.view
  const collections = useWorkspace((s) => s.collections)
  const ws = useWorkspace.getState()
  const [section, setSection] = useTabState<EntitySection>(tab.id, 'entity.section', 'overview')
  const bodyRef = useScrollMemory<HTMLDivElement>(tab.id, `entity.${section}`)
  const collectionId = view && 'collectionId' in view ? view.collectionId : null
  const scopes = useScopes(collectionId)
  const collection = collections.find((c) => c.id === collectionId)
  const folder = view?.kind === 'folder' && collection ? findItem(collection.items, view.folderId) : null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inherited = useMemo(
    () =>
      view?.kind === 'folder' && collection
        ? effectiveAuth(
            null,
            parentChain(collection.id, view.folderId).map((p) => ({ auth: p.auth, name: p.name, kind: p.kind }))
          )
        : undefined,
    [collections, view]
  )
  if (!collection || (view?.kind === 'folder' && folder?.type !== 'folder')) return <div className="entity muted">{t('entity.deleted')}</div>

  const isFolder = view?.kind === 'folder' && folder?.type === 'folder'
  const target = isFolder ? folder : collection
  const edit = (fn: (x: { auth: AuthConfig | null; scripts: Scripts; description?: string; name: string }) => void) => {
    if (isFolder) ws.updateFolder(collection.id, folder.id, fn)
    else ws.updateCollection(collection.id, fn)
  }
  const requestCount = (items: typeof collection.items): number => items.reduce((n, i) => n + (i.type === 'request' ? 1 : requestCount(i.items)), 0)

  const sections: Array<[EntitySection, string]> = [
    ['overview', t('entity.overview')],
    ['auth', t('entity.authorization')],
    ['scripts', t('entity.scripts')],
    ...(isFolder ? [] : ([['variables', t('entity.variables')]] as Array<[EntitySection, string]>))
  ]

  return (
    <div className="entity" ref={bodyRef}>
      <header className="entity-head">
        <div>
          <span className="muted small">{isFolder ? t('entity.folderOf', { collection: collection.name }) : t('entity.collection')}</span>
          <EditableTitle value={target.name} onRename={(n) => edit((x) => void (x.name = n))} />
        </div>
        <div className="row tight">
        <button className="primary" onClick={() => useTabs.getState().openView({ kind: 'runner', collectionId: collection.id, ...(isFolder ? { folderId: folder.id } : {}) })}>
          {t('entity.run')}
        </button>
        {!isFolder && (
          <button
            onClick={() =>
              void window.endora
                .saveTextFile(fileName(collection.name, 'collection'), JSON.stringify(exportCollection(collection), null, 2))
                .then((r) => (r.ok ? toast(t('tree.exported', { path: r.path })) : !r.canceled && toast(t('entity.exportFailed', { message: r.message }), 'error')))
            }
          >
            {t('entity.exportV21')}
          </button>
        )}
        </div>
      </header>
      <nav className="tabs" ref={horizontalWheel}>
        {sections.map(([id, label]) => (
          <button key={id} className={section === id ? 'active' : ''} onClick={() => setSection(id)}>
            {label}
            {id === 'auth' && target.auth && <span className="dot" />}
            {id === 'scripts' && (target.scripts.prerequest.trim() || target.scripts.test.trim()) && <span className="dot" />}
            {id === 'variables' && collection.variables.length > 0 && <span className="badge">{collection.variables.length}</span>}
          </button>
        ))}
      </nav>
      <div className="entity-body">
        {section === 'overview' && (
          <div className="overview">
            <p className="muted small">{t('entity.requestCount', { count: requestCount(isFolder ? folder.items : collection.items) })}</p>
            <label className="field">
              <span>{t('entity.description')}</span>
              <textarea
                className="description"
                value={target.description ?? ''}
                placeholder={t('entity.descriptionPlaceholder')}
                onChange={(e) =>
                  edit((x) => {
                    x.description = e.target.value || undefined
                  })
                }
              />
            </label>
          </div>
        )}
        {section === 'auth' && (
          <>
            <p className="muted small">
              {isFolder ? t('entity.authFolderHint') : t('entity.authCollectionHint')}
            </p>
            <AuthEditor
              auth={target.auth}
              allowInherit={Boolean(isFolder)}
              inherited={inherited}
              scopes={scopes}
              onChange={(auth) =>
                edit((x) => {
                  x.auth = auth
                })
              }
            />
          </>
        )}
        {section === 'scripts' && (
          <>
            <p className="muted small">
              {isFolder ? t('entity.scriptsFolderHint') : t('entity.scriptsCollectionHint')}
            </p>
            <ScriptsEditor
              scripts={target.scripts}
              tabId={tab.id}
              scope={`entity.scripts.${target.id}`}
              onChange={(scripts) =>
                edit((x) => {
                  x.scripts = scripts
                })
              }
            />
          </>
        )}
        {section === 'variables' && !isFolder && (
          <VariablesTable
            values={collection.variables}
            onChange={(variables) =>
              ws.updateCollection(collection.id, (c) => {
                c.variables = variables
              })
            }
            hint={t('entity.collectionVarsHint')}
          />
        )}
      </div>
    </div>
  )
}
