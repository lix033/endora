import { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { EditorView } from '@codemirror/view'
import { dateLocale, t, type MessageKey } from '@shared/i18n'
import { MOCK_HEADERS, type MockState } from '@shared/mock'
import { isLoose } from '@shared/model'
import { editorTheme } from '../editor'
import { useMocks } from '../stores/mocks'
import { useTabs, type Tab } from '../stores/tabs'
import { confirmDialog, toast } from '../stores/ui'
import { useWorkspace } from '../stores/workspace'
import { Toggle } from './SettingsView'

/** Sélection « nouveau mock » dans l'onglet Services. */
const NEW = 'new'

const extensions = [javascript(), EditorView.lineWrapping, editorTheme]

/** Extraits du script de mock (textes propres à Endora), dans la langue de l'interface. */
const SNIPPETS: Array<{ label: MessageKey; code: MessageKey }> = [
  { label: 'mocks.snip.json', code: 'mocks.snip.json.code' },
  { label: 'mocks.snip.crud', code: 'mocks.snip.crud.code' },
  { label: 'mocks.snip.counter', code: 'mocks.snip.counter.code' },
  { label: 'mocks.snip.token', code: 'mocks.snip.token.code' },
  { label: 'mocks.snip.error', code: 'mocks.snip.error.code' },
  { label: 'mocks.snip.log', code: 'mocks.snip.log.code' }
]

const copy = (text: string, what: string) => void window.endora.writeClipboard(text).then(() => toast(t('common.copied', { what })))

function StatusBadge({ mock }: { mock: MockState }) {
  if (mock.error) return <span className="mock-status error">{t('mocks.error')}</span>
  return <span className={`mock-status ${mock.running ? 'on' : ''}`}>{mock.running ? t('mocks.running') : t('mocks.stopped')}</span>
}

function NewMockForm({ onCreated }: { onCreated: (id: string) => void }) {
  const collections = useWorkspace((s) => s.collections)
  const [collectionId, setCollectionId] = useState('')
  // Choix explicite, sinon première collection : le formulaire peut s'afficher avant le chargement
  // des collections (onglet restauré au démarrage).
  const collection = collections.find((c) => c.id === collectionId) ?? collections.find((c) => !isLoose(c)) ?? collections[0]
  const [name, setName] = useState('')
  const [publicAccess, setPublicAccess] = useState(false)
  const [autoDeploy, setAutoDeploy] = useState(true)
  const [enableSession, setEnableSession] = useState(true)
  const [creating, setCreating] = useState(false)

  const create = async () => {
    if (!collection || creating) return
    setCreating(true)
    let mock: MockState | null = null
    try {
      mock = await useMocks.getState().create({ name: name.trim() || t('mocks.defaultName', { collection: collection.name }), collectionId: collection.id, publicAccess, autoDeploy, enableSession })
    } finally {
      setCreating(false)
    }
    if (mock) {
      toast(t('mocks.created', { name: mock.config.name, url: mock.url }))
      onCreated(mock.config.id)
    }
  }

  return (
    <div className="mock-form">
      <h3>{t('mocks.formTitle')}</h3>
      <p className="muted">{t('mocks.formIntro')}</p>
      {collections.length === 0 ? (
        <p>{t('mocks.needCollection')}</p>
      ) : (
        <>
          <label className="field">
            <span>{t('mocks.collection')}</span>
            <select value={collection?.id ?? ''} onChange={(e) => setCollectionId(e.target.value)}>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('mocks.name')}</span>
            <input value={name} placeholder={collection ? t('mocks.defaultName', { collection: collection.name }) : t('mocks.namePlaceholder')} onChange={(e) => setName(e.target.value)} />
          </label>
          <Toggle
            label={t('mocks.publicAccess')}
            hint={t('mocks.publicHintNew', { header: MOCK_HEADERS.key })}
            checked={publicAccess}
            onChange={setPublicAccess}
          />
          <Toggle
            label={t('mocks.autoDeploy')}
            hint={t('mocks.autoDeployHintNew')}
            checked={autoDeploy}
            onChange={setAutoDeploy}
          />
          <Toggle
            label={t('mocks.sessions')}
            hint={t('mocks.sessionsHintNew', { header: MOCK_HEADERS.session })}
            checked={enableSession}
            onChange={setEnableSession}
          />
          <div className="row">
            <button className="primary" disabled={!collection || creating} onClick={() => void create()}>
              {creating ? t('mocks.creating') : t('mocks.create')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function ScriptEditor({ mock }: { mock: MockState }) {
  const [script, setScript] = useState(mock.config.script)
  const dirty = script !== mock.config.script
  const save = () => void useMocks.getState().update(mock.config.id, { script }).then((ok) => ok && toast(t('mocks.scriptSaved')))
  const append = (code: string) => setScript((s) => (s.trim() === '' ? code : `${s.replace(/\s+$/, '')}\n\n${code}`))
  return (
    <section className="mock-section">
      <div className="mock-section-head">
        <h4>{t('mocks.script')}</h4>
        <button className="primary small-btn" disabled={!dirty} onClick={save}>
          {t('mocks.saveScript')}
        </button>
      </div>
      <p className="muted small">
        {t('mocks.scriptHint')} <code>pm.request</code>, <code>pm.response</code>, <code>pm.state</code>, <code>pm.session</code>, <code>pm.route</code>,{' '}
        <code>console</code>.
      </p>
      <div className="mock-script">
        <div
          className="mock-script-editor"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
              e.preventDefault()
              e.stopPropagation()
              if (dirty) save()
            }
          }}
        >
          <CodeMirror key={mock.config.id} value={script} height="100%" theme="none" extensions={extensions} onChange={setScript} />
        </div>
        <aside className="snippets">
          <p className="muted small">{t('mocks.snippets')}</p>
          {SNIPPETS.map((s) => (
            <button key={s.label} className="link" onClick={() => append(t(s.code))}>
              {t(s.label)}
            </button>
          ))}
        </aside>
      </div>
    </section>
  )
}

function MockLog({ mock }: { mock: MockState }) {
  const id = mock.config.id
  const logs = useMocks((s) => s.logs[id])
  useEffect(() => {
    void useMocks.getState().loadLogs(id)
  }, [id])
  return (
    <section className="mock-section">
      <div className="mock-section-head">
        <h4>{t('mocks.log')}</h4>
        <div className="row tight">
          <button className="small-btn" onClick={() => void useMocks.getState().resetState(id)} title={t('mocks.resetStateTitle')}>
            {t('mocks.resetState')}
          </button>
          <button className="small-btn" disabled={!logs?.length} onClick={() => void useMocks.getState().clearLogs(id)}>
            {t('mocks.clearLog')}
          </button>
        </div>
      </div>
      {!logs?.length ? (
        <p className="muted small">{t('mocks.noRequests')}</p>
      ) : (
        <table className="mock-log">
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="muted">{new Date(l.time).toLocaleTimeString(dateLocale())}</td>
                <td className={`mono m-${l.method}`}>{l.method}</td>
                <td className="mono">
                  {l.path}
                  {l.logs?.map((m, i) => (
                    <div key={i} className={`mock-log-line ${m.level}`}>
                      {m.message}
                    </div>
                  ))}
                  {l.error && <div className="mock-log-line error">{l.error}</div>}
                </td>
                <td className={`mono ${l.status >= 400 ? 'danger-text' : 'ok-text'}`}>{l.status}</td>
                <td className="muted">{l.route ? `${l.route}${l.example ? ` · ${l.example}` : ''}` : '—'}</td>
                <td className="muted">{l.session}</td>
                <td className="muted">{l.durationMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function MockDetail({ mock }: { mock: MockState }) {
  const { config } = mock
  const actions = useMocks.getState()
  const [editingName, setEditingName] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const set = (patch: Parameters<typeof actions.update>[1]) => void actions.update(config.id, patch)

  const remove = async () => {
    const choice = await confirmDialog(t('mocks.deleteTitle'), t('mocks.deleteMessage', { name: config.name }), [
      { label: t('common.cancel'), value: 'cancel' },
      { label: t('common.delete'), value: 'delete', variant: 'danger' }
    ])
    if (choice === 'delete' && (await actions.remove(config.id))) useTabs.getState().openView({ kind: 'mocks', mockId: NEW })
  }

  const curl = `curl ${mock.url}/…${config.publicAccess ? '' : ` -H "${MOCK_HEADERS.key}: ${showKey ? config.apiKey : t('mocks.keyPlaceholder')}"`}${config.enableSession ? ` -H "${MOCK_HEADERS.session}: alice"` : ''}`

  return (
    <div className="mock-detail">
      <div className="entity-head">
        <div>
          {editingName ? (
            <input
              className="entity-title-input"
              autoFocus
              defaultValue={config.name}
              onBlur={(e) => {
                setEditingName(false)
                if (e.target.value.trim() && e.target.value !== config.name) set({ name: e.target.value })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setEditingName(false)
              }}
            />
          ) : (
            <h2 className="entity-title" onDoubleClick={() => setEditingName(true)} title={t('mocks.renameHint')}>
              {config.name}
            </h2>
          )}
          <div className="row tight muted small">
            <StatusBadge mock={mock} />
            <span>
              {t('mocks.collectionLabel')}{' '}
              {mock.collectionName ? (
                <button className="link" onClick={() => useTabs.getState().openView({ kind: 'collection', collectionId: config.collectionId })}>
                  {mock.collectionName}
                </button>
              ) : (
                '—'
              )}
            </span>
            <span>
              {t('mocks.counts', { routes: mock.routes, examples: mock.examples })}
            </span>
          </div>
        </div>
        <div className="row">
          {mock.running ? <button onClick={() => void actions.stop(config.id)}>{t('mocks.stop')}</button> : <button className="primary" onClick={() => void actions.start(config.id)}>{t('mocks.start')}</button>}
          <button className="danger" onClick={() => void remove()}>
            {t('common.delete')}
          </button>
        </div>
      </div>

      {mock.error && <div className="mock-error">{mock.error}</div>}

      <section className="mock-card">
        <div className="mock-url">
          <span className="muted small">{t('mocks.url')}</span>
          <code>{mock.url}</code>
          <button className="small-btn" onClick={() => copy(mock.url, t('mocks.urlWord'))}>
            {t('common.copy')}
          </button>
        </div>
        {mock.networkUrl && (
          <div className="mock-url">
            <span className="muted small">{t('mocks.networkUrl')}</span>
            <code>{mock.networkUrl}</code>
            <button className="small-btn" onClick={() => copy(mock.networkUrl!, t('mocks.urlWord'))}>
              {t('common.copy')}
            </button>
          </div>
        )}
        {!config.publicAccess && (
          <div className="mock-url">
            <span className="muted small">{t('mocks.key', { header: MOCK_HEADERS.key })}</span>
            <code>{showKey ? config.apiKey : '•'.repeat(24)}</code>
            <button className="small-btn" onClick={() => setShowKey((v) => !v)}>
              {showKey ? t('common.hide') : t('common.show')}
            </button>
            <button className="small-btn" onClick={() => copy(config.apiKey, t('mocks.keyWord'))}>
              {t('common.copy')}
            </button>
          </div>
        )}
        <code className="mock-curl">{curl}</code>
        <p className="muted small">
          {t('mocks.chooseExample')} {t('mocks.chooseExampleHeaders', { name: MOCK_HEADERS.responseName, code: MOCK_HEADERS.responseCode })}
        </p>
      </section>

      <section className="mock-section">
        <Toggle
          label={t('mocks.publicAccess')}
          hint={t('mocks.publicHint', { header: MOCK_HEADERS.key })}
          checked={config.publicAccess}
          onChange={(v) => set({ publicAccess: v })}
        />
        <Toggle
          label={t('mocks.autoDeploy')}
          hint={t('mocks.autoDeployHint')}
          checked={config.autoDeploy}
          onChange={(v) => set({ autoDeploy: v })}
        />
        {!config.autoDeploy && (
          <div className="setting">
            <div>
              <div>{t('mocks.deployedVersion')}</div>
              <div className="muted small">{config.deployedAt ? new Date(config.deployedAt).toLocaleString(dateLocale()) : '—'}</div>
            </div>
            <button onClick={() => void actions.deploy(config.id)}>{t('mocks.deploy')}</button>
          </div>
        )}
        <Toggle
          label={t('mocks.sessions')}
          hint={t('mocks.sessionsHint', { header: MOCK_HEADERS.session })}
          checked={config.enableSession}
          onChange={(v) => set({ enableSession: v })}
        />
      </section>

      <ScriptEditor key={config.id} mock={mock} />
      <MockLog mock={mock} />
    </div>
  )
}

export function MocksView({ tab }: { tab: Tab }) {
  const { mocks, loaded } = useMocks()
  const wanted = tab.view?.kind === 'mocks' ? tab.view.mockId : undefined
  const selected = wanted === NEW ? null : (mocks.find((m) => m.config.id === wanted) ?? (wanted ? null : mocks[0]) ?? null)
  const select = (mockId: string) => useTabs.getState().openView({ kind: 'mocks', mockId })

  return (
    <div className="settings services">
      <nav className="settings-nav">
        <h2>{t('mocks.services')}</h2>
        <h4 className="nav-group">{t('mocks.group')}</h4>
        {mocks.map((m) => (
          <button key={m.config.id} className={selected?.config.id === m.config.id ? 'active' : ''} onClick={() => select(m.config.id)} title={m.url}>
            <span className={`status-dot ${m.error ? 'error' : m.running ? 'on' : ''}`} />
            {m.config.name}
          </button>
        ))}
        <button className={`link nav-add ${!selected ? 'active' : ''}`} onClick={() => select(NEW)}>
          {t('mocks.new')}
        </button>
      </nav>
      <div className="settings-body">
        {!loaded ? <p className="muted">{t('common.loading')}</p> : selected ? <MockDetail key={selected.config.id} mock={selected} /> : <NewMockForm onCreated={select} />}
      </div>
    </div>
  )
}
