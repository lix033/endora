import { t } from '@shared/i18n'
import { useEffect, useRef, useState } from 'react'
import { useConsole, type ConsoleEntry } from '../stores/console'

function RequestEntry({ e }: { e: Extract<ConsoleEntry, { kind: 'request' }> }) {
  const [open, setOpen] = useState(false)
  const statusClass = e.error ? 'fail' : (e.status ?? 0) < 300 ? 'ok' : (e.status ?? 0) < 400 ? 'redirect' : 'fail'
  return (
    <div className="console-entry request">
      <button className="ghost console-line" onClick={() => setOpen(!open)}>
        <span className={`chevron ${open ? 'open' : ''}`}>›</span>
        {e.fromScript && <span className="muted small">pm.sendRequest</span>}
        <span className={`m-${e.method} mono`}>{e.method}</span>
        <span className="mono console-url">{e.url}</span>
        <span className={`status ${statusClass}`}>{e.error ? t('console.error') : e.status}</span>
        {e.timeMs !== undefined && <span className="muted small">{e.timeMs} ms</span>}
      </button>
      {open && (
        <div className="console-detail mono">
          {e.error && <div className="error-text">{e.error}</div>}
          {e.requestHeaders && (
            <>
              <div className="muted">{t('console.requestHeaders')}</div>
              {e.requestHeaders.map(([k, v], i) => (
                <div key={i}>
                  {k}: {/^authorization$/i.test(k) ? `${v.slice(0, 12)}…` : v}
                </div>
              ))}
            </>
          )}
          {e.responseHeaders && (
            <>
              <div className="muted">{t('console.responseHeaders')}</div>
              {e.responseHeaders.map(([k, v], i) => (
                <div key={i}>
                  {k}: {v}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function ConsolePanel() {
  const { entries, clear, setOpen } = useConsole()
  const [filter, setFilter] = useState('')
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // scrollIntoView renvoie une promesse dans les Chromium récents : elle ne doit pas servir de nettoyage.
    void end.current?.scrollIntoView({ block: 'end' })
  }, [entries.length])
  const f = filter.trim().toLowerCase()
  const visible = entries.filter((e) => f === '' || (e.kind === 'request' ? `${e.method} ${e.url}` : e.message).toLowerCase().includes(f))

  return (
    <section className="console">
      <header className="console-head">
        <strong>{t('console.title')}</strong>
        <input className="filter" placeholder={t('console.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="ghost small" onClick={clear}>
          {t('console.clear')}
        </button>
        <button className="ghost" onClick={() => setOpen(false)} aria-label={t('console.close')}>
          ×
        </button>
      </header>
      <div className="console-body">
        {visible.length === 0 && <p className="muted small pad">{t('console.empty')}</p>}
        {visible.map((e) =>
          e.kind === 'request' ? (
            <RequestEntry key={e.id} e={e} />
          ) : (
            <div key={e.id} className={`console-entry log ${e.level}`}>
              <span className="mono console-msg">{e.message}</span>
              {e.source && <span className="muted small">{e.source}</span>}
            </div>
          )
        )}
        <div ref={end} />
      </div>
    </section>
  )
}
