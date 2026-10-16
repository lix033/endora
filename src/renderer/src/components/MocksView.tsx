import { useEffect, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { EditorView } from '@codemirror/view'
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

/** Extraits du script de mock (textes propres à Endora). */
const SNIPPETS: Array<{ label: string; code: string }> = [
  { label: 'Réponse JSON dynamique', code: `pm.response.status(200).json({ id: pm.request.params.id, date: new Date().toISOString() })` },
  {
    label: 'Ressource en mémoire (CRUD)',
    code: `const items = pm.state.get('items') || []
if (pm.request.method === 'POST') {
  const item = { id: items.length + 1, ...pm.request.json() }
  pm.state.set('items', [...items, item])
  pm.response.status(201).json(item)
} else if (pm.request.method === 'GET' && !pm.request.params.id) {
  pm.response.json(items)
}`
  },
  { label: 'Compteur par session', code: `const n = (pm.state.get('compteur') || 0) + 1\npm.state.set('compteur', n)\npm.response.header('X-Compteur', n)` },
  { label: 'Exiger un jeton', code: `if (!pm.request.header('authorization')) {\n  pm.response.status(401).json({ error: 'Non authentifié' })\n}` },
  { label: 'Simuler une erreur', code: `if (pm.request.query.erreur) {\n  pm.response.status(500).json({ error: 'Erreur simulée' })\n}` },
  { label: 'Journaliser la requête', code: `console.log(pm.request.method, pm.request.path, pm.session)` }
]

const copy = (text: string, what: string) => void window.endora.writeClipboard(text).then(() => toast(`${what} copiée.`))

function StatusBadge({ mock }: { mock: MockState }) {
  if (mock.error) return <span className="mock-status error">Erreur</span>
  return <span className={`mock-status ${mock.running ? 'on' : ''}`}>{mock.running ? 'En marche' : 'Arrêté'}</span>
}

function NewMockForm({ onCreated }: { onCreated: (id: string) => void }) {
  const collections = useWorkspace((s) => s.collections)
  const [collectionId, setCollectionId] = useState(collections.find((c) => !isLoose(c))?.id ?? collections[0]?.id ?? '')
  const collection = collections.find((c) => c.id === collectionId)
  const [name, setName] = useState('')
  const [publicAccess, setPublicAccess] = useState(false)
  const [autoDeploy, setAutoDeploy] = useState(true)
  const [enableSession, setEnableSession] = useState(true)
  const [creating, setCreating] = useState(false)

  const create = async () => {
    if (!collection) return
    setCreating(true)
    const mock = await useMocks.getState().create({ name: name.trim() || `Mock ${collection.name}`, collectionId, publicAccess, autoDeploy, enableSession })
    setCreating(false)
    if (mock) {
      toast(`Mock « ${mock.config.name} » démarré sur ${mock.url}.`)
      onCreated(mock.config.id)
    }
  }

  return (
    <div className="mock-form">
      <h3>Nouveau mock server</h3>
      <p className="muted">
        Le mock répond aux requêtes de la collection avec leurs exemples enregistrés. Son URL est créée automatiquement.
      </p>
      {collections.length === 0 ? (
        <p>Créez ou importez d’abord une collection.</p>
      ) : (
        <>
          <label className="field">
            <span>Collection</span>
            <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Nom</span>
            <input value={name} placeholder={collection ? `Mock ${collection.name}` : 'Nom du mock'} onChange={(e) => setName(e.target.value)} />
          </label>
          <Toggle
            label="Autoriser l’accès public"
            hint={`Joignable depuis le réseau local, sans clé. Sinon : cette machine uniquement, avec l’en-tête ${MOCK_HEADERS.key}.`}
            checked={publicAccess}
            onChange={setPublicAccess}
          />
          <Toggle
            label="Déployer automatiquement les modifications"
            hint="Les changements de la collection sont servis dès leur enregistrement. Sinon : bouton « Déployer »."
            checked={autoDeploy}
            onChange={setAutoDeploy}
          />
          <Toggle
            label="Activer les sessions"
            hint={`Chaque valeur de l’en-tête ${MOCK_HEADERS.session} a son propre état (pm.state).`}
            checked={enableSession}
            onChange={setEnableSession}
          />
          <div className="row">
            <button className="primary" disabled={!collection || creating} onClick={() => void create()}>
              {creating ? 'Création…' : 'Créer le mock'}
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
  const save = () => void useMocks.getState().update(mock.config.id, { script }).then((ok) => ok && toast('Script du mock enregistré.'))
  const append = (code: string) => setScript((s) => (s.trim() === '' ? code : `${s.replace(/\s+$/, '')}\n\n${code}`))
  return (
    <section className="mock-section">
      <div className="mock-section-head">
        <h4>Script du mock</h4>
        <button className="primary small-btn" disabled={!dirty} onClick={save}>
          Enregistrer le script
        </button>
      </div>
      <p className="muted small">
        Exécuté à chaque requête reçue, après le choix de l’exemple : <code>pm.request</code>, <code>pm.response</code> (préremplie avec l’exemple),{' '}
        <code>pm.state</code> (état de la session), <code>pm.session</code>, <code>pm.route</code>, <code>console</code>. Sans accès réseau.
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
          <p className="muted small">Extraits</p>
          {SNIPPETS.map((s) => (
            <button key={s.label} className="link" onClick={() => append(s.code)}>
              {s.label}
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
        <h4>Journal</h4>
        <div className="row tight">
          <button className="small-btn" onClick={() => void useMocks.getState().resetState(id)} title="Vide pm.state pour toutes les sessions">
            Réinitialiser l’état
          </button>
          <button className="small-btn" disabled={!logs?.length} onClick={() => void useMocks.getState().clearLogs(id)}>
            Effacer
          </button>
        </div>
      </div>
      {!logs?.length ? (
        <p className="muted small">Aucune requête reçue.</p>
      ) : (
        <table className="mock-log">
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="muted">{new Date(l.time).toLocaleTimeString('fr-FR')}</td>
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
    const choice = await confirmDialog('Supprimer le mock', `« ${config.name} » sera arrêté et supprimé. La collection n’est pas modifiée.`, [
      { label: 'Annuler', value: 'cancel' },
      { label: 'Supprimer', value: 'delete', variant: 'danger' }
    ])
    if (choice === 'delete' && (await actions.remove(config.id))) useTabs.getState().openView({ kind: 'mocks', mockId: NEW })
  }

  const curl = `curl ${mock.url}/…${config.publicAccess ? '' : ` -H "${MOCK_HEADERS.key}: ${showKey ? config.apiKey : '<clé>'}"`}${config.enableSession ? ` -H "${MOCK_HEADERS.session}: alice"` : ''}`

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
            <h2 className="entity-title" onDoubleClick={() => setEditingName(true)} title="Double-cliquez pour renommer">
              {config.name}
            </h2>
          )}
          <div className="row tight muted small">
            <StatusBadge mock={mock} />
            <span>
              Collection :{' '}
              {mock.collectionName ? (
                <button className="link" onClick={() => useTabs.getState().openView({ kind: 'collection', collectionId: config.collectionId })}>
                  {mock.collectionName}
                </button>
              ) : (
                '—'
              )}
            </span>
            <span>
              · {mock.routes} requête{mock.routes > 1 ? 's' : ''}, {mock.examples} exemple{mock.examples > 1 ? 's' : ''}
            </span>
          </div>
        </div>
        <div className="row">
          {mock.running ? <button onClick={() => void actions.stop(config.id)}>Arrêter</button> : <button className="primary" onClick={() => void actions.start(config.id)}>Démarrer</button>}
          <button className="danger" onClick={() => void remove()}>
            Supprimer
          </button>
        </div>
      </div>

      {mock.error && <div className="mock-error">{mock.error}</div>}

      <section className="mock-card">
        <div className="mock-url">
          <span className="muted small">URL</span>
          <code>{mock.url}</code>
          <button className="small-btn" onClick={() => copy(mock.url, 'URL')}>
            Copier
          </button>
        </div>
        {mock.networkUrl && (
          <div className="mock-url">
            <span className="muted small">Réseau local</span>
            <code>{mock.networkUrl}</code>
            <button className="small-btn" onClick={() => copy(mock.networkUrl!, 'URL')}>
              Copier
            </button>
          </div>
        )}
        {!config.publicAccess && (
          <div className="mock-url">
            <span className="muted small">Clé ({MOCK_HEADERS.key})</span>
            <code>{showKey ? config.apiKey : '•'.repeat(24)}</code>
            <button className="small-btn" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Masquer' : 'Afficher'}
            </button>
            <button className="small-btn" onClick={() => copy(config.apiKey, 'Clé')}>
              Copier
            </button>
          </div>
        )}
        <code className="mock-curl">{curl}</code>
        <p className="muted small">
          Choisir un exemple : en-têtes <code>{MOCK_HEADERS.responseName}</code> ou <code>{MOCK_HEADERS.responseCode}</code>.
        </p>
      </section>

      <section className="mock-section">
        <Toggle
          label="Autoriser l’accès public"
          hint={`Joignable depuis le réseau local, sans clé. Désactivé : mock privé, cette machine uniquement, en-tête ${MOCK_HEADERS.key} obligatoire.`}
          checked={config.publicAccess}
          onChange={(v) => set({ publicAccess: v })}
        />
        <Toggle
          label="Déployer automatiquement les modifications"
          hint="Les changements de la collection sont servis dès leur enregistrement."
          checked={config.autoDeploy}
          onChange={(v) => set({ autoDeploy: v })}
        />
        {!config.autoDeploy && (
          <div className="setting">
            <div>
              <div>Version déployée</div>
              <div className="muted small">{config.deployedAt ? new Date(config.deployedAt).toLocaleString('fr-FR') : '—'}</div>
            </div>
            <button onClick={() => void actions.deploy(config.id)}>Déployer</button>
          </div>
        )}
        <Toggle
          label="Activer les sessions"
          hint={`Chaque valeur de l’en-tête ${MOCK_HEADERS.session} a son propre état ; sans en-tête, état partagé.`}
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
        <h2>Services</h2>
        <h4 className="nav-group">Mock servers</h4>
        {mocks.map((m) => (
          <button key={m.config.id} className={selected?.config.id === m.config.id ? 'active' : ''} onClick={() => select(m.config.id)} title={m.url}>
            <span className={`status-dot ${m.error ? 'error' : m.running ? 'on' : ''}`} />
            {m.config.name}
          </button>
        ))}
        <button className={`link nav-add ${!selected ? 'active' : ''}`} onClick={() => select(NEW)}>
          + Nouveau mock
        </button>
      </nav>
      <div className="settings-body">
        {!loaded ? <p className="muted">Chargement…</p> : selected ? <MockDetail key={selected.config.id} mock={selected} /> : <NewMockForm onCreated={select} />}
      </div>
    </div>
  )
}
