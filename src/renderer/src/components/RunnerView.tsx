import { dateLocale, t } from '@shared/i18n'
import { useState } from 'react'
import { parseDataFile, type RunPlanItem, type RunRequestResult } from '@shared/runner'
import { useEnvironments } from '../stores/environments'
import { exportRun, runnerKey, useRunner, type RunRecord } from '../stores/runner'
import { useScrollMemory, useTabState } from '../stores/tabui'
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
  if (!collection) return <div className="entity muted">{t('run.collectionDeleted')}</div>
  const key = runnerKey(view.collectionId, view.folderId)
  const shownId = runner.shown[key]
  const shown = shownId ? runner.runs.find((r) => r.id === shownId) : undefined
  if (shown) return <RunResults key={shown.id} tabId={tab.id} run={shown} onBack={() => runner.show(key, null)} onRerun={() => void runner.start(view.collectionId, view.folderId)} />
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
      toast(t('run.dataRejected', { message: parsed.message }), 'error')
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
            <span className="muted small">{t('run.title')}</span>
            <h2 className="entity-title">{folderId ? `${title} › ${config.plan[0]?.path.at(-1) ?? t('run.folder')}` : title}</h2>
          </div>
          <div className="row tight">
            <button className="ghost small" onClick={() => setPlan(config.plan.map((p) => ({ ...p, enabled: true })))}>
              {t('run.checkAll')}
            </button>
            <button className="ghost small" onClick={() => setPlan(config.plan.map((p) => ({ ...p, enabled: false })))}>
              {t('run.uncheckAll')}
            </button>
            <button className="ghost small" onClick={() => runner.update(key, { plan: [] })} title={t('run.resetOrderTitle')}>
              {t('run.resetOrder')}
            </button>
          </div>
        </header>
        <p className="muted small">{t('run.orderHint')}</p>
        {config.plan.length === 0 && <p className="muted">{folderId ? t('run.noRequestsFolder') : t('run.noRequestsCollection')}</p>}
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
        <h3>{t('run.runSettings')}</h3>
        <label className="field">
          <span>{t('run.environment')}</span>
          <select
            value={config.environmentId === undefined ? '__active__' : (config.environmentId ?? '')}
            onChange={(e) => runner.update(key, { environmentId: e.target.value === '__active__' ? undefined : e.target.value || null })}
          >
            <option value="__active__">{t('run.activeEnv', { name: environments.find((e) => e.id === activeId)?.name ?? t('run.activeEnvNone') })}</option>
            <option value="">{t('run.noEnv')}</option>
            {environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <div className="row two">
          <label className="field">
            <span>{t('run.iterations')}</span>
            <input type="number" min={1} max={10000} value={o.iterations} onChange={(e) => runner.updateOptions(key, { iterations: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label className="field">
            <span>{t('run.delay')}</span>
            <input type="number" min={0} step={100} value={o.delayMs} onChange={(e) => runner.updateOptions(key, { delayMs: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
        </div>
        <div className="field">
          <span>{t('run.data')}</span>
          {o.data ? (
            <div className="data-file">
              <div className="row space-between">
                <span className="mono">{o.data.fileName}</span>
                <button className="ghost small" onClick={() => runner.updateOptions(key, { data: null })}>
                  {t('run.remove')}
                </button>
              </div>
              <span className="muted small">
                {t('run.dataRows', { count: o.data.rows.length, vars: columns.map((c) => `{{${c}}}`).join(', ') || '—' })}
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
            <button onClick={() => void pickData()}>{t('run.selectFile')}</button>
          )}
        </div>
        <label className="check">
          <input type="checkbox" checked={o.persistVariables} onChange={(e) => runner.updateOptions(key, { persistVariables: e.target.checked })} />
          {t('run.persistVars')}
        </label>
        <p className="muted small indent">{t('run.persistHint')}</p>
        <label className="check">
          <input type="checkbox" checked={o.saveResponses} onChange={(e) => runner.updateOptions(key, { saveResponses: e.target.checked })} />
          {t('run.saveResponses')}
        </label>
        <label className="check">
          <input type="checkbox" checked={o.stopOnError} onChange={(e) => runner.updateOptions(key, { stopOnError: e.target.checked })} />
          {t('run.stopOnError')}
        </label>
        <button className="primary wide" disabled={enabledCount === 0} onClick={() => void runner.start(collectionId, folderId)}>
          {t('run.start', { count: enabledCount })}
          {o.iterations > 1 ? ` × ${o.iterations}` : ''}
        </button>

        {previous.length > 0 && (
          <>
            <h3>{t('run.previous')}</h3>
            <ul className="run-history">
              {previous.map((r) => (
                <li key={r.id}>
                  <button className="link" onClick={() => runner.show(key, r.id)}>
                    {new Date(r.startedAt).toLocaleTimeString(dateLocale())}
                  </button>
                  <span className={`run-status ${r.status}`}>{statusLabel(r.status)}</span>
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

const statusLabel = (status: RunRecord['status']): string => t(`run.status.${status}`)

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
  const passed = r.tests.filter((x) => x.passed && !x.skipped).length
  const counted = r.tests.filter((x) => !x.skipped).length
  return (
    <li className={`run-result ${resultFailed(r) ? 'failed' : ''}`}>
      <button className="ghost run-result-line" onClick={() => setOpen(!open)}>
        <span className={`chevron ${open ? 'open' : ''}`}>›</span>
        <span className={`tree-method m-${r.method}`}>{shortMethod(r.method)}</span>
        <span className="run-result-name">{r.name}</span>
        <span className="mono muted small run-result-url">{r.url}</span>
        {r.skipped ? (
          <span className="muted small">{t('run.skipped')}</span>
        ) : (
          <span className={`status ${statusClass}`}>{r.error ? t('run.error') : r.status}</span>
        )}
        {r.timeMs !== undefined && <span className="muted small">{r.timeMs} ms</span>}
        {counted > 0 && <span className={`test-count ${passed < counted ? 'fail' : 'pass'}`}>{passed}/{counted}</span>}
      </button>
      {open && (
        <div className="run-result-detail">
          {r.error && <p className="error-text">{r.error}</p>}
          {r.scriptError && (
            <p className="error-text">
              {t('run.scriptError', { phase: r.scriptError.phase, source: r.scriptError.source })}{' '}
              <span className="mono">{r.scriptError.message}</span>
            </p>
          )}
          {r.tests.length === 0 && !r.error && !r.scriptError && <p className="muted small">{t('run.noTests')}</p>}
          <ul className="tests-list">
            {r.tests.map((x, i) => (
              <li key={i}>
                <span className={`test-badge ${x.skipped ? 'skipped' : x.passed ? 'pass' : 'fail'}`}>{x.skipped ? t('tests.badgeSkipped') : x.passed ? t('tests.badgePass') : t('tests.badgeFail')}</span>
                <span>{x.name}</span>
                {x.error && <span className="test-msg mono">{x.error}</span>}
              </li>
            ))}
          </ul>
          {r.response && (
            <details>
              <summary className="muted small">{t('run.response', { type: r.response.contentType ?? t('run.unknownType') })}</summary>
              <pre className="run-body">{decode(r.response.bodyBase64).slice(0, 20000)}</pre>
            </details>
          )}
        </div>
      )}
    </li>
  )
}

function RunResults({ tabId, run, onBack, onRerun }: { tabId: string; run: RunRecord; onBack: () => void; onRerun: () => void }) {
  const [filter, setFilter] = useTabState<Filter>(tabId, `runner.filter.${run.id}`, 'all')
  const listRef = useScrollMemory<HTMLDivElement>(tabId, `runner.results.${run.id}.${filter}`)
  const stop = useRunner((s) => s.stop)
  const tests = run.results.flatMap((r) => r.tests)
  const passed = tests.filter((x) => x.passed && !x.skipped).length
  const failed = tests.filter((x) => !x.passed).length
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
            {t('run.startedAt', { date: new Date(run.startedAt).toLocaleString(dateLocale()) })}
            {run.environmentName ? t('run.envSuffix', { name: run.environmentName }) : ''}
            {run.dataFile ? t('run.dataSuffix', { file: run.dataFile }) : ''}
          </span>
          <h2 className="entity-title">
            {run.title} <span className={`run-status ${run.status}`}>{statusLabel(run.status)}</span>
          </h2>
        </div>
        <div className="row tight">
          {running ? (
            <button className="danger" onClick={() => stop(run.id)}>
              {t('run.stop')}
            </button>
          ) : (
            <>
              <button onClick={onBack}>{t('run.configure')}</button>
              <button onClick={() => void exportRun(run)}>{t('run.export')}</button>
              <button className="primary" onClick={onRerun}>
                {t('run.rerun')}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="run-summary">
        <div>
          <span className="big">{run.status === 'done' ? run.iterations : `${run.iteration + 1}/${run.iterations}`}</span>
          <span className="muted small">{t('run.iterationsLabel', { count: run.iterations })}</span>
        </div>
        <div>
          <span className="big">{run.results.length}</span>
          <span className="muted small">{t('run.requests')}</span>
        </div>
        <div>
          <span className="big ok-text">{passed}</span>
          <span className="muted small">{t('run.testsPassed')}</span>
        </div>
        <div>
          <span className={`big ${failed > 0 ? 'error-text' : ''}`}>{failed}</span>
          <span className="muted small">{t('run.testsFailed')}</span>
        </div>
        <div>
          <span className="big">{run.summary?.avgResponseMs ?? '—'}</span>
          <span className="muted small">{t('run.avgMs')}</span>
        </div>
        <div>
          <span className="big">{(elapsed / 1000).toFixed(1)}</span>
          <span className="muted small">{t('run.seconds')}</span>
        </div>
      </div>
      {running && <div className="run-progress" aria-hidden />}
      {run.message && <p className="error-text">{run.message}</p>}

      <nav className="tests-filter">
        {(['all', 'passed', 'failed'] as const).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {{ all: t('run.filterAll'), passed: t('run.filterPassed'), failed: t('run.filterFailed') }[f]}
          </button>
        ))}
      </nav>
      <div className="run-list" ref={listRef}>
        {[...byIteration].map(([iteration, results]) => (
          <section key={iteration}>
            <div className="history-day">{t('run.iteration', { n: iteration + 1 })}</div>
            <ul>
              {results.map((r) => (
                <ResultRow key={r.id} r={r} />
              ))}
            </ul>
          </section>
        ))}
        {visible.length === 0 && <p className="muted small pad">{running ? t('run.inProgress') : t('run.noResults')}</p>}
      </div>
    </div>
  )
}
