import { useEffect, useMemo, useState } from 'react'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { html } from '@codemirror/lang-html'
import { exportRequest } from '@shared/collection-v21'
import { formatCode, indentJson } from '@shared/format'
import { t } from '@shared/i18n'
import type { HttpResponseResult } from '@shared/http'
import type { ResponseFormat } from '@shared/settings'
import type { TestResult } from '@shared/scripting/types'
import { editorTheme } from '../editor'
import { useSettings } from '../stores/settings'
import { memoryKey, objectVersion, useScrollMemory, useTabState } from '../stores/tabui'
import type { Tab } from '../stores/tabs'
import { toast } from '../stores/ui'
import { lookupItem, useWorkspace } from '../stores/workspace'
import { CodeEditor } from './CodeEditor'
import { horizontalWheel } from './Splitter'

type View = 'pretty' | 'raw' | 'preview' | 'headers' | 'tests'
type Kind = 'json' | 'xml' | 'html' | 'image' | 'text'

function decode(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function formatSize(n: number): string {
  if (n < 1024) return t('res.bytes', { n })
  if (n < 1024 * 1024) return t('res.kb', { n: (n / 1024).toFixed(1) })
  return t('res.mb', { n: (n / 1024 / 1024).toFixed(2) })
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

  if (sending) return <section className="response empty">{t('res.sending')}</section>
  if (outcome?.prerequestError) {
    return (
      <section className="response empty error">
        <strong>{t('res.prerequestError')}</strong>
        <span className="mono">{outcome.prerequestError.message}</span>
        <span className="muted small">{t('res.prerequestSource', { source: outcome.prerequestError.source })}</span>
      </section>
    )
  }
  if (outcome?.skipped) {
    return <section className="response empty">{t('res.skipped')}</section>
  }
  if (!result) return <section className="response empty">{t('res.empty')}</section>
  if (!result.ok) {
    return (
      <section className="response empty error">
        <strong>{t('res.failed')}</strong>
        <span>{result.message}</span>
      </section>
    )
  }
  return <ResponseView key={tab.id} tab={tab} result={result} tests={outcome?.tests ?? []} testError={outcome?.testError} />
}

/** En-têtes qui ne décrivent plus le corps une fois décodé. */
const TRANSPORT_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive'])

/** Enregistre la réponse comme exemple de la requête (format v2.1) : les mock servers la servent. */
function saveAsExample(tab: Tab, result: HttpResponseResult, body: string, language: string): void {
  if (tab.source?.kind !== 'collection') return
  const { collectionId, itemId } = tab.source
  const item = lookupItem(useWorkspace.getState().collections, collectionId, itemId)
  const existing = Array.isArray(item?.extra?.['response']) ? (item.extra['response'] as Array<{ name?: unknown }>) : []
  const base = `${result.status} ${result.statusText}`.trim()
  let name = base
  for (let i = 2; existing.some((e) => e.name === name); i++) name = `${base} (${i})`
  const ok = useWorkspace.getState().addExample(collectionId, itemId, {
    name,
    originalRequest: exportRequest(tab.draft),
    status: result.statusText,
    code: result.status,
    _postman_previewlanguage: language,
    header: result.headers.filter(([k]) => !TRANSPORT_HEADERS.has(k.toLowerCase())).map(([key, value]) => ({ key, value })),
    cookie: [],
    body
  })
  toast(ok ? t('res.exampleSaved', { name }) : t('res.exampleMissing'), ok ? 'info' : 'error')
}

/** Au-delà, un XML ou HTML reçu n'est pas mis en forme : Prettier deviendrait trop lent. */
const PRETTY_LIMIT = 512 * 1024
const prettyCache = new WeakMap<HttpResponseResult, { kind: Kind; text: string }>()

/**
 * Corps « Pretty » : JSON réindenté sans réécrire ses valeurs (grands entiers intacts), XML et HTML
 * mis en forme par Prettier (asynchrone, texte brut en attendant). Mémorisé par réponse.
 */
function usePretty(result: HttpResponseResult, text: string, kind: Kind): string {
  const sync = useMemo(() => {
    const cached = prettyCache.get(result)
    if (cached?.kind === kind) return cached.text
    if (kind !== 'json') return null
    const out = indentJson(text) ?? text
    prettyCache.set(result, { kind, text: out })
    return out
  }, [result, text, kind])
  const [formatted, setFormatted] = useState<{ result: HttpResponseResult; kind: Kind; text: string } | null>(null)
  useEffect(() => {
    if (sync !== null || (kind !== 'xml' && kind !== 'html') || text.length > PRETTY_LIMIT) return
    let live = true
    void formatCode(text, kind).then((r) => {
      const out = r.ok ? r.code : text
      prettyCache.set(result, { kind, text: out })
      if (live) setFormatted({ result, kind, text: out })
    })
    return () => {
      live = false
    }
  }, [sync, result, text, kind])
  if (sync !== null) return sync
  return formatted && formatted.result === result && formatted.kind === kind ? formatted.text : text
}

function TestsView({ tabId, tests, testError }: { tabId: string; tests: TestResult[]; testError?: { message: string; source: string } }) {
  const [filter, setFilter] = useTabState<'all' | 'passed' | 'failed' | 'skipped'>(tabId, 'response.testsFilter', 'all')
  const visible = tests.filter((x) =>
    filter === 'all' ? true : filter === 'skipped' ? x.skipped : filter === 'passed' ? x.passed && !x.skipped : !x.passed
  )
  return (
    <div className="tests-view">
      {testError && (
        <div className="test-error">
          {t('tests.scriptError')} ({testError.source}) : <span className="mono">{testError.message}</span>
        </div>
      )}
      <nav className="tests-filter">
        {(['all', 'passed', 'skipped', 'failed'] as const).map((f) => (
          <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
            {{ all: t('tests.all'), passed: t('tests.passed'), skipped: t('tests.skipped'), failed: t('tests.failed') }[f]}
          </button>
        ))}
      </nav>
      {tests.length === 0 && <p className="muted">{t('tests.none')}</p>}
      <ul className="tests-list">
        {visible.map((x, i) => (
          <li key={i}>
            <span className={`test-badge ${x.skipped ? 'skipped' : x.passed ? 'pass' : 'fail'}`}>{x.skipped ? t('tests.badgeSkipped') : x.passed ? t('tests.badgePass') : t('tests.badgeFail')}</span>
            <span>{x.name}</span>
            {x.error && <span className="test-msg mono">{x.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function ResponseView({ tab, result, tests, testError }: { tab: Tab; result: HttpResponseResult; tests: TestResult[]; testError?: { message: string; source: string } }) {
  // Vue affichée et positions : retrouvées au retour sur l'onglet, tant que la réponse est la même.
  const [view, setView] = useTabState<View>(tab.id, 'response.view', 'pretty')
  const place = `response.${view}.${objectVersion(result)}`
  const bodyRef = useScrollMemory<HTMLDivElement>(tab.id, place)
  const format = useSettings((s) => s.settings.general.responseFormat)
  const kind = kindOf(result.contentType, format)
  const text = useMemo(() => (kind === 'image' ? '' : decode(result.bodyBase64)), [result, kind])
  const pretty = usePretty(result, text, kind)
  const ext = kind === 'json' ? [json()] : kind === 'xml' ? [xml()] : kind === 'html' ? [html()] : []
  const statusClass = result.status < 300 ? 'ok' : result.status < 400 ? 'redirect' : 'fail'
  const passed = tests.filter((x) => x.passed && !x.skipped).length
  const counted = tests.filter((x) => !x.skipped).length

  return (
    <section className="response">
      <header className="response-meta">
        <nav className="tabs" ref={horizontalWheel}>
          {(['pretty', 'raw', 'preview', 'headers', 'tests'] as const).map((v) => (
            <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>
              {
                {
                  pretty: t('res.pretty'),
                  raw: t('res.raw'),
                  preview: t('res.preview'),
                  headers: t('res.headers', { count: result.headers.length }),
                  tests: counted > 0 || testError ? t('res.testsCount', { passed, total: counted }) : t('res.tests')
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
          {format !== 'auto' && <span className="muted small">{t('res.format', { format: format.toUpperCase() })}</span>}
          {tab.source?.kind === 'collection' && kind !== 'image' && (
            <button className="small-btn" onClick={() => saveAsExample(tab, result, text, kind === 'json' || kind === 'xml' || kind === 'html' ? kind : 'text')} title={t('res.saveExampleTitle')}>
              {t('res.saveExample')}
            </button>
          )}
        </div>
      </header>
      <div className="response-body" ref={bodyRef}>
        {view === 'tests' && <TestsView tabId={tab.id} tests={tests} testError={testError} />}
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
            <img className="preview-img" src={`data:${result.contentType};base64,${result.bodyBase64}`} alt={t('res.previewAlt')} />
          ) : (
            <iframe className="preview" sandbox="" srcDoc={text} title={t('res.previewAlt')} />
          ))}
        {(view === 'pretty' || view === 'raw') &&
          (kind === 'image' ? (
            <p className="muted">{t('res.binary', { type: result.contentType ?? '' })}</p>
          ) : (
            <CodeEditor
              memory={memoryKey(tab.id, place)}
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
