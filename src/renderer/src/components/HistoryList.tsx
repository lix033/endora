import type { MouseEvent } from 'react'
import { dateLocale, t } from '@shared/i18n'
import { draftLabel, type HistoryEntry } from '@shared/model'
import { useTabs } from '../stores/tabs'
import { confirmDialog, saveDialog, toast } from '../stores/ui'
import { useWorkspace } from '../stores/workspace'
import { openMenu } from './ContextMenu'
import { shortMethod } from './CollectionsTree'
import { copyAsCurl } from './RequestPanel'

const dayKey = (d: Date): string => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

function dayLabel(d: Date, now = new Date()): string {
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (dayKey(d) === dayKey(now)) return t('common.today')
  if (dayKey(d) === dayKey(yesterday)) return t('common.yesterday')
  return d.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

/** Regroupe les entrées (déjà triées de la plus récente à la plus ancienne) par jour. */
function groupByDay(entries: HistoryEntry[]): Array<{ label: string; entries: HistoryEntry[] }> {
  const groups: Array<{ key: string; label: string; entries: HistoryEntry[] }> = []
  for (const e of entries) {
    const d = new Date(e.createdAt)
    const key = dayKey(d)
    const last = groups[groups.length - 1]
    if (last?.key === key) last.entries.push(e)
    else groups.push({ key, label: dayLabel(d), entries: [e] })
  }
  return groups
}

async function saveToCollection(entry: HistoryEntry): Promise<void> {
  const target = await saveDialog(draftLabel(entry.request), t('history.saveToCollection'))
  if (!target) return
  const id = useWorkspace.getState().addRequest(target.collectionId, target.parentId, target.name, entry.request)
  if (id) toast(t('history.saved', { name: useWorkspace.getState().collections.find((c) => c.id === target.collectionId)?.name ?? '' }))
}

export async function clearHistory(): Promise<void> {
  const choice = await confirmDialog(t('history.clearTitle'), t('history.clearMessage'), [
    { label: t('common.cancel'), value: 'cancel' },
    { label: t('common.clearAll'), value: 'clear', variant: 'danger' }
  ])
  if (choice === 'clear') useWorkspace.getState().clearHistory()
}

export function HistoryList({ filter }: { filter: string }) {
  const history = useWorkspace((s) => s.history)
  const activeSource = useTabs((s) => s.tabs.find((t) => t.id === s.activeId)?.source)
  const f = filter.trim().toLowerCase()
  const visible = f === '' ? history : history.filter((h) => h.request.url.toLowerCase().includes(f) || h.request.method.toLowerCase() === f)

  if (history.length === 0) {
    return (
      <div className="sidebar-empty">
        <p>{t('history.empty')}</p>
        <p className="muted small">{t('history.emptyHint')}</p>
      </div>
    )
  }

  const menu = (e: MouseEvent, h: HistoryEntry) =>
    openMenu(e, [
      { label: t('tree.openInTab'), onSelect: () => useTabs.getState().openHistory(h, { preview: false }) },
      { label: t('history.saveToCollectionMenu'), onSelect: () => void saveToCollection(h) },
      { label: t('tree.copyCurl'), onSelect: () => void copyAsCurl(h.request) },
      'separator',
      { label: t('common.delete'), danger: true, onSelect: () => useWorkspace.getState().deleteHistory(h.id) }
    ])

  return (
    <div className="tree">
      {groupByDay(visible).map((g) => (
        <div key={g.label} className="history-group">
          <div className="history-day">{g.label}</div>
          {g.entries.map((h) => {
            const time = new Date(h.createdAt).toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' })
            const statusText = h.error ? t('history.statusError', { message: h.error }) : h.status ? t('history.status', { status: h.status }) : ''
            return (
              <div
                key={h.id}
                className={`tree-row ${activeSource?.kind === 'history' && activeSource.historyId === h.id ? 'active' : ''}`}
                title={`${time}${statusText ? `\n${statusText}` : ''}`}
                onClick={() => useTabs.getState().openHistory(h, { preview: true })}
                onDoubleClick={() => useTabs.getState().openHistory(h, { preview: false })}
                onContextMenu={(e) => menu(e, h)}
              >
                <span className={`tree-method m-${h.request.method}`}>{shortMethod(h.request.method)}</span>
                <span className="tree-name mono">{draftLabel(h.request)}</span>
                {h.error ? <span className="hist-status fail">!</span> : h.status ? <span className={`hist-status ${h.status < 400 ? 'ok' : 'fail'}`}>{h.status}</span> : null}
                <button className="ghost row-menu" aria-label={t('common.actions')} onClick={(e) => menu(e, h)}>
                  ⋯
                </button>
              </div>
            )
          })}
        </div>
      ))}
      {visible.length === 0 && <p className="muted small pad">{t('history.noMatch')}</p>}
    </div>
  )
}
