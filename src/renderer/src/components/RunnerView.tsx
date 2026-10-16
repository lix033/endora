import { useState } from 'react'
import { parseDataFile, type RunPlanItem, type RunRequestResult } from '@shared/runner'
import { useEnvironments } from '../stores/environments'
import { exportRun, runnerKey, useRunner, type RunRecord } from '../stores/runner'
import type { Tab } from '../stores/tabs'
import { toast } from '../stores/ui'
import { useWorkspace } from '../stores/workspace'
import { shortMethod } from './CollectionsTree'

export function RunnerView({ tab }: { tab: Tab }) {
  const view = tab.view
  const collections = useWorkspace((s) => s.collections)
  const runner = useRunner()
  if (view?.kind !== 'runner') return null
  const collection = collections.find((c) => c.id === view.collectionId)
  if (!collection) return <div className="entity muted">Collection supprimée.</div>
  const key = runnerKey(view.collectionId, view.folderId)
  const shownId = runner.shown[key]
  const shown = shownId ? runner.runs.find((r) => r.id === shownId) : undefined
  if (shown) return <RunResults run={shown} onBack={() => runner.show(key, null)} onRerun={() => void runner.start(view.collectionId, view.folderId)} />
  return <RunConfig collectionId={view.collectionId} folderId={view.folderId} />
}

// --- Configuration -------------------------------------------------------------------------------

function RunConfig({ collectionId, folderId }: { collectionId: string; folderId?: string }) {
  const runner = useRunner()
  const environments = useEnvironments((s) => s.environments)
  const activeId = useEnvironments((s) => s.activeId)
  const key = runnerKey(collectionId, folderId)
  const config = runner.config(collectionId, folderId)
  const o = config.options
  const [dragId, setDragId] = useState<string | null>(null)
  const previous = runner.runs.filter((r) => r.key === key)
  const title = useWorkspace((s) => s.collections.find((c) => c.id === collectionId)?.name)
  const enabledCount = config.plan.filter((p) => p.enabled).length

  const setPlan = (plan: RunPlanItem[]) => runner.update(key, { plan })
  const move = (fromId: string, toId: string) => {
    if (fromId === toId) return
    const plan = [...config.plan]
    const from = plan.findIndex((p) => p.itemId === fromId)
    const [item] = plan.splice(from, 1)
    plan.splice(
      plan.findIndex((p) => p.itemId === toId),
      0,
      item!
    )
    setPlan(plan)
  }

  const pickData = async () => {
    const r = await window.endora.openTextFiles()
    if (!r.ok) {
      if (!r.canceled) toast(r.message, 'error')
      return
    }
    const file = r.files[0]!
    const parsed = parseDataFile(file.name, file.text)
    if (!parsed.ok) {
      toast(`Fichier de données refusé : ${parsed.message}`, 'error')
      return
    }
    // Comme dans la référence : le nombre d'itérations suit le nombre de lignes du fichier.
    runner.updateOptions(key, { data: { fileName: file.name, rows: parsed.rows }, iterations: Math.max(1, parsed.rows.length) })
  }

  const columns = o.data ? [...new Set(o.data.rows.flatMap((r) => Object.keys(r)))] : []

  return (
    <div className="runner">
      <section className="runner-order">
        <header className="runner-head">
          <div>
            <span className="muted small">Collection Runner</span>
            <h2 className="entity-title">{folderId ? `${title} › ${config.plan[0]?.path.at(-1) ?? 'Dossier'}` : title}</h2>
          </div>
          <div className="row tight">
            <button className="ghost small" onClick={() => setPlan(config.plan.map((p) => ({ ...p, enabled: true })))}>
              Tout cocher
            </button>
            <button className="ghost small" onClick={() => setPlan(config.plan.map((p) => ({ ...p, enabled: false })))}>
              Tout décocher
            </button>
            <button className="ghost small" onClick={() => runner.update(key, { plan: [] })} title="Rétablir l’ordre de la collection">
              Ordre initial
            </button>
          </div>
        </header>
        <p className="muted small">Ordre d’exécution : glissez les requêtes pour les réordonner, décochez celles à ignorer.</p>
        {config.plan.length === 0 && <p className="muted">Aucune requête dans {folderId ? 'ce dossier' : 'cette collection'}.</p>}
        <ol className="run-plan">
          {config.plan.map((p) => (
            <li
              key={p.itemId}
              draggable
              className={`${p.enabled ? '' : 'disabled'} ${dragId === p.itemId ? 'dragging' : ''}`}
              onDragStart={(e) => {
                setDragId(p.itemId)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                if (dragId) move(dragId, p.itemId)
              }}
              onDragEnd={() => setDragId(null)}
            >
              <span className="grip" aria-hidden>
                ⋮⋮
              </span>
              <input type="checkbox" checked={p.enabled} onChange={(e) => setPlan(config.plan.map((x) => (x.itemId === p.itemId ? { ...x, enabled: e.target.checked } : x)))} />
              <span className={`tree-method m-${p.method}`}>{shortMethod(p.method)}</span>
              <span className="run-plan-name">
                {p.path.length > 0 && <span className="muted">{p.path.join(' › ')} › </span>}
                {p.name}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <aside className="runner-options">
        <h3>Exécution</h3>
        <label className="field">
          <span>Environnement</span>
          <select
            value={config.environmentId === undefined ? '__active__' : (config.environmentId ?? '')}
            onChange={(e) => runner.update(key, { environmentId: e.target.value === '__active__' ? undefined : e.target.value || null })}
          >
            <option value="__active__">Environnement actif ({environments.find((e) => e.id === activeId)?.name ?? 'aucun'})</option>
            <option value="">Aucun environnement</option>
            {environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row two">
          <label className="field">
            <span>Itérations</span>
            <input type="number" min={1} max={10000} value={o.iterations} onChange={(e) => runner.updateOptions(key, { iterations: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label className="field">
            <span>Délai (ms)</span>
            <input type="number" min={0} step={100} value={o.delayMs} onChange={(e) => runner.updateOptions(key, { delayMs: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
        <div className="field">
          <span>Données (CSV ou JSON)</span>
          {o.data ? (
            <div className="data-file">
              <div className="row space-between">
                <span className="mono">{o.data.fileName}</span>
                <button className="ghost small" onClick={() => runner.updateOptions(key, { data: null })}>
                  Retirer
                </button>
              </div>
              <span className="muted small">
                {o.data.rows.length} ligne(s) · variables : {columns.map((c) => `{{${c}}}`).join(', ') || '—'}
              </span>
              {o.data.rows.length > 0 && (
                <table className="data-preview">
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {o.data.rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        {columns.map((c) => (
                          <td key={c}>{r[c] ?? ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ) : (
            <button onClick={() => void pickData()}>Choisir un fichier…</button>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={o.persistVariables} onChange={(e) => runner.updateOptions(key, { persistVariables: e.target.checked })} />
          Conserver les valeurs des variables
        </label>
        <p className="muted small indent">Les variables modifiées par les scripts sont enregistrées dans l’environnement, la collection et les globales.</p>
        <label className="check">
          <input type="checkbox" checked={o.saveResponses} onChange={(e) => runner.updateOptions(key, { saveResponses: e.target.checked })} />
          Enregistrer les réponses
        </label>
        <label className="check">
          <input type="checkbox" checked={o.stopOnError} onChange={(e) => runner.updateOptions(key, { stopOnError: e.target.checked })} />
          Arrêter à la première erreur
        </label>
        <button className="primary wide" disabled={enabledCount === 0} onClick={() => void runner.start(collectionId, folderId)}>
          Lancer {enabledCount} requête{enabledCount > 1 ? 's' : ''}
          {o.iterations > 1 ? ` × ${o.iterations}` : ''}
        </button>

        {previous.length > 0 && (
          <>
            <h3>Exécutions précédentes</h3>
            <ul className="run-history">
              {previous.map((r) => (
                <li key={r.id}>
                  <button className="link" onClick={() => runner.show(key, r.id)}>
                    {new Date(r.startedAt).toLocaleTimeString('fr-FR')}
                  </button>
                  <span className={`run-status ${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  {r.summary && (
                    <span className="muted small">
                      {r.summary.testsPassed} ✓ · {r.summary.testsFailed} ✗
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  )
}

// --- Résultats -----------------------------------------------------------------------------------

const STATUS_LABEL: Record<RunRecord['status'], string> = { running: 'En cours', done: 'Terminée', stopped: 'Arrêtée', error: 'Interrompue' }

type Filter = 'all' | 'passed' | 'failed'

const resultFailed = (r: RunRequestResult) => Boolean(r.error || r.scriptError || r.tests.some((t) => !t.passed))

function decode(b64: string): string {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
  } catch {
    return ''
  }
}

function ResultRow({ r }: { r: RunRequestResult }) {
  const [open, setOpen] = useState(false)
  const statusClass = r.error ? 'fail' : (r.status ?? 0) < 300 ? 'ok' : (r.status ?? 0) < 400 ? 'redirect' : 'fail'
  const passed = r.tests.filter((t) => t.passed && !t.skipped).length
  const counted = r.tests.filter((t) => !t.skipped).length
  return (
    <li className={`run-result ${resultFailed(r) ? 'failed' : ''}`}>
      <button className="ghost run-result-line" onClick={() => setOpen(!open)}>
        <span className={`chevron ${open ? 'open' : ''}`}>›</span>
        <span className={`tree-method m-${r.method}`}>{shortMethod(r.method)}</span>
        <span className="run-result-name">{r.name}</span>
        <span className="mono muted small run-result-url">{r.url}</span>
        {r.skipped ? (
          <span className="muted small">ignorée</span>
        ) : (
          <span className={`status ${statusClass}`}>{r.error ? 'Erreur' : r.status}</span>
        )}
        {r.timeMs !== undefined && <span className="muted small">{r.timeMs} ms</span>}
        {counted > 0 && <span className={`test-count ${passed < counted ? 'fail' : 'pass'}`}>{passed}/{counted}</span>}
      </button>
      {open && (
        <div className="run-result-detail">
          {r.error && <p className="error-text">{r.error}</p>}
          {r.scriptError && (
            <p className="error-text">
              Erreur de script ({r.scriptError.phase === 'prerequest' ? 'avant la requête' : 'après la réponse'}, {r.scriptError.source}) :{' '}
              <span className="mono">{r.scriptError.message}</span>
            </p>
          )}
          {r.tests.length === 0 && !r.error && !r.scriptError && <p className="muted small">Aucun test.</p>}
          <ul className="tests-list">
            {r.tests.map((t, i) => (
              <li key={i}>
                <span className={`test-badge ${t.skipped ? 'skipped' : t.passed ? 'pass' : 'fail'}`}>{t.skipped ? 'IGNORÉ' : t.passed ? 'RÉUSSI' : 'ÉCHEC'}</span>
                <span>{t.name}</span>
                {t.error && <span className="test-msg mono">{t.error}</span>}
              </li>
            ))}
          </ul>
          {r.response && (
            <details>
              <summary className="muted small">Réponse ({r.response.contentType ?? 'inconnu'})</summary>
              <pre className="run-body">{decode(r.response.bodyBase64).slice(0, 20000)}</pre>
            </details>
          )}
        </div>
      )}
    </li>
  )
}

function RunResults({ run, onBack, onRerun }: { run: RunRecord; onBack: () => void; onRerun: () => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const stop = useRunner((s) => s.stop)
  const tests = run.results.flatMap((r) => r.tests)
  const passed = tests.filter((t) => t.passed && !t.skipped).length
  const failed = tests.filter((t) => !t.passed).length
  const running = run.status === 'running'
  const elapsed = (run.finishedAt ?? Date.now()) - run.startedAt
  const visible = run.results.filter((r) => (filter === 'all' ? true : filter === 'failed' ? resultFailed(r) : !resultFailed(r)))
  const byIteration = new Map<number, RunRequestResult[]>()
  for (const r of visible) byIteration.set(r.iteration, [...(byIteration.get(r.iteration) ?? []), r])

  return (
    <div className="runner-results">
      <header className="runner-head">
        <div>
          <span className="muted small">
            Exécution du {new Date(run.startedAt).toLocaleString('fr-FR')}
            {run.environmentName ? ` · environnement « ${run.environmentName} »` : ''}
            {run.dataFile ? ` · données ${run.dataFile}` : ''}
          </span>
          <h2 className="entity-title">
            {run.title} <span className={`run-status ${run.status}`}>{STATUS_LABEL[run.status]}</span>
          </h2>
        </div>
        <div className="row tight">
          {running ? (
            <button className="danger" onClick={() => stop(run.id)}>
              Arrêter
            </button>
          ) : (
            <>
              <button onClick={onBack}>Configurer</button>
              <button onClick={() => void exportRun(run)}>Exporter</button>
              <button className="primary" onClick={onRerun}>
                Relancer
              </button>
            </>
          )}
        </div>
      </header>

      <div className="run-summary">
        <div>
          <span className="big">{run.status === 'done' ? run.iterations : `${run.iteration + 1}/${run.iterations}`}</span>
          <span className="muted small">itération{run.iterations > 1 ? 's' : ''}</span>
        </div>
        <div>
          <span className="big">{run.results.length}</span>
          <span className="muted small">requêtes</span>
        </div>
        <div>
          <span className="big ok-text">{passed}</span>
          <span className="muted small">tests réussis</span>
        </div>
        <div>
          <span className={`big ${failed > 0 ? 'error-text' : ''}`}>{failed}</span>
          <span className="muted small">tests échoués</span>
        </div>
        <div>
          <span className="big">{run.summary?.avgResponseMs ?? '—'}</span>
          <span className="muted small">ms en moyenne</span>
        </div>
        <div>
          <span className="big">{(elapsed / 1000).toFixed(1)}</span>
          <span className="muted small">secondes</span>
        </div>
      </div>
      {running && <div className="run-progress" aria-hidden />}
      {run.message && <p className="error-text">{run.message}</p>}

      <nav className="tests-filter">
        {(['all', 'passed', 'failed'] as const).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {{ all: 'Tout', passed: 'Réussi', failed: 'Échoué' }[f]}
          </button>
        ))}
      </nav>
      <div className="run-list">
        {[...byIteration].map(([iteration, results]) => (
          <section key={iteration}>
            <div className="history-day">Itération {iteration + 1}</div>
            <ul>
              {results.map((r) => (
                <ResultRow key={r.id} r={r} />
              ))}
            </ul>
          </section>
        ))}
        {visible.length === 0 && <p className="muted small pad">{running ? 'Exécution en cours…' : 'Aucun résultat pour ce filtre.'}</p>}
      </div>
    </div>
  )
}
