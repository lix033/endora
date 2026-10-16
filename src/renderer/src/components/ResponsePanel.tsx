import { useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { html } from '@codemirror/lang-html'
import type { HttpResponseResult } from '@shared/http'
import type { ResponseFormat } from '@shared/settings'
import type { TestResult } from '@shared/scripting/types'
import { editorTheme } from '../editor'
import { useSettings } from '../stores/settings'
import type { Tab } from '../stores/tabs'

type View = 'pretty' | 'raw' | 'preview' | 'headers' | 'tests'
type Kind = 'json' | 'xml' | 'html' | 'image' | 'text'

function decode(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} o`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`
  return `${(n / 1024 / 1024).toFixed(2)} Mo`
}

/** Format affiché : déduit du type MIME en mode auto (comportement de référence), sinon forcé. */
export function kindOf(contentType: string | null, setting: ResponseFormat): Kind {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.startsWith('image/')) return 'image'
  if (setting !== 'auto') return setting
  if (ct.includes('json')) return 'json'
  if (ct.includes('html')) return 'html'
  if (ct.includes('xml')) return 'xml'
  return 'text'
}

export function ResponsePanel({ tab }: { tab: Tab }) {
  const { result, sending, outcome } = tab

  if (sending) return <section className="response empty">Envoi de la requête…</section>
  if (outcome?.prerequestError) {
    return (
      <section className="response empty error">
        <strong>Erreur dans le script exécuté avant la requête</strong>
        <span className="mono">{outcome.prerequestError.message}</span>
        <span className="muted small">Source : {outcome.prerequestError.source}. La requête n’a pas été envoyée.</span>
      </section>
    )
  }
  if (outcome?.skipped) {
    return <section className="response empty">La requête n’a pas été envoyée : un script a appelé pm.execution.skipRequest().</section>
  }
  if (!result) return <section className="response empty">Saisissez une URL et cliquez sur Envoyer pour obtenir une réponse.</section>
  if (!result.ok) {
    return (
      <section className="response empty error">
        <strong>Impossible d'obtenir une réponse</strong>
        <span>{result.message}</span>
      </section>
    )
  }
  return <ResponseView key={tab.id} result={result} tests={outcome?.tests ?? []} testError={outcome?.testError} />
}

function TestsView({ tests, testError }: { tests: TestResult[]; testError?: { message: string; source: string } }) {
  const [filter, setFilter] = useState<'all' | 'passed' | 'failed' | 'skipped'>('all')
  const visible = tests.filter((t) =>
    filter === 'all' ? true : filter === 'skipped' ? t.skipped : filter === 'passed' ? t.passed && !t.skipped : !t.passed
  )
  return (
    <div className="tests-view">
      {testError && (
        <div className="test-error">
          Erreur dans le script de test ({testError.source}) : <span className="mono">{testError.message}</span>
        </div>
      )}
      <nav className="tests-filter">
        {(['all', 'passed', 'skipped', 'failed'] as const).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {{ all: 'Tous', passed: 'Réussis', skipped: 'Ignorés', failed: 'Échoués' }[f]}
          </button>
        ))}
      </nav>
      {tests.length === 0 && <p className="muted">Aucun test pour cette requête. Ajoutez-en dans l’onglet Scripts, phase « Après la réponse ».</p>}
      <ul className="tests-list">
        {visible.map((t, i) => (
          <li key={i}>
            <span className={`test-badge ${t.skipped ? 'skipped' : t.passed ? 'pass' : 'fail'}`}>{t.skipped ? 'IGNORÉ' : t.passed ? 'RÉUSSI' : 'ÉCHEC'}</span>
            <span>{t.name}</span>
            {t.error && <span className="test-msg mono">{t.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ResponseView({ result, tests, testError }: { result: HttpResponseResult; tests: TestResult[]; testError?: { message: string; source: string } }) {
  const [view, setView] = useState<View>('pretty')
  const format = useSettings((s) => s.settings.general.responseFormat)
  const kind = kindOf(result.contentType, format)
  const text = useMemo(() => (kind === 'image' ? '' : decode(result.bodyBase64)), [result, kind])
  const pretty = useMemo(() => {
    if (kind !== 'json') return text
    try {
      return JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      return text
    }
  }, [text, kind])
  const ext = kind === 'json' ? [json()] : kind === 'xml' ? [xml()] : kind === 'html' ? [html()] : []
  const statusClass = result.status < 300 ? 'ok' : result.status < 400 ? 'redirect' : 'fail'
  const passed = tests.filter((t) => t.passed && !t.skipped).length
  const counted = tests.filter((t) => !t.skipped).length

  return (
    <section className="response">
      <header className="response-meta">
        <nav className="tabs">
          {(['pretty', 'raw', 'preview', 'headers', 'tests'] as const).map((v) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
              {
                {
                  pretty: 'Formaté',
                  raw: 'Brut',
                  preview: 'Aperçu',
                  headers: `En-têtes (${result.headers.length})`,
                  tests: counted > 0 || testError ? `Tests (${passed}/${counted})` : 'Tests'
                }[v]
              }
              {v === 'tests' && (testError || passed < counted) && <span className="dot fail-dot" />}
            </button>
          ))}
        </nav>
        <div className="stats">
          <span className={`status ${statusClass}`}>
            {result.status} {result.statusText}
          </span>
          <span>{result.timeMs} ms</span>
          <span>{formatSize(result.sizeBytes)}</span>
          {format !== 'auto' && <span className="muted small">format : {format.toUpperCase()}</span>}
        </div>
      </header>
      <div className="response-body">
        {view === 'tests' && <TestsView tests={tests} testError={testError} />}
        {view === 'headers' && (
          <table className="headers-table">
            <tbody>
              {result.headers.map(([k, v], i) => (
                <tr key={i}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view === 'preview' &&
          (kind === 'image' ? (
            <img className="preview-img" src={`data:${result.contentType};base64,${result.bodyBase64}`} alt="Aperçu" />
          ) : (
            <iframe className="preview" sandbox="" srcDoc={text} title="Aperçu" />
          ))}
        {(view === 'pretty' || view === 'raw') &&
          (kind === 'image' ? (
            <p className="muted">Réponse binaire ({result.contentType}). Voir l'aperçu.</p>
          ) : (
            <CodeMirror
              value={view === 'pretty' ? pretty : text}
              height="100%"
              theme="none"
              editable={false}
              extensions={view === 'pretty' ? [...ext, editorTheme] : [editorTheme]}
            />
          ))}
      </div>
    </section>
  )
}
