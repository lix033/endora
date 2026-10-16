import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import logo from '../assets/logo.svg'
import { useNotifications } from '../stores/notifications'
import { useTabs } from '../stores/tabs'
import { useMocks } from '../stores/mocks'
import { BellIcon, GearIcon, ServicesIcon, WorkspaceIcon } from './icons'

type Panel = 'workspace' | 'notifications' | null

/** Panneau déroulant ancré sous son bouton ; se ferme au clic extérieur ou avec Échap. */
function Popover({ onClose, children, className = '' }: { onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div ref={ref} className={`popover ${className}`} role="dialog">
      {children}
    </div>
  )
}

function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { items, dismiss } = useNotifications()
  return (
    <Popover onClose={onClose} className="notifications">
      <div className="popover-head">{t('top.notifications')}</div>
      {items.length === 0 ? (
        <p className="popover-empty muted">{t('top.noNotifications')}</p>
      ) : (
        <ul className="notification-list">
          {items.map((n) => (
            <li key={n.id}>
              <div className="notification-title">{n.title}</div>
              {n.body && <div className="muted small">{n.body}</div>}
              <div className="row tight">
                {n.actions?.map((a) => (
                  <button
                    key={a.label}
                    className={`${a.primary ? 'primary ' : ''}small-btn`}
                    onClick={() => {
                      a.run()
                      onClose()
                    }}
                  >
                    {a.label}
                  </button>
                ))}
                {!n.actions && n.url && (
                  <button className="primary small-btn" onClick={() => void window.endora.openExternal(n.url!)}>
                    {t('top.download')}
                  </button>
                )}
                <button
                  className="small-btn"
                  onClick={() => {
                    useTabs.getState().openSettings('update')
                    onClose()
                  }}
                >
                  {t('top.details')}
                </button>
                <span className="spacer" />
                <button className="ghost small" onClick={() => dismiss(n.id)}>
                  {t('top.dismiss')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Popover>
  )
}

export function TopBar() {
  const [panel, setPanel] = useState<Panel>(null)
  const unread = useNotifications((s) => s.items.filter((i) => !i.read).length)
  const runningMocks = useMocks((s) => s.mocks.filter((m) => m.running).length)
  const close = () => setPanel(null)
  const toggle = (p: Exclude<Panel, null>) => {
    setPanel((cur) => (cur === p ? null : p))
    if (p === 'notifications') useNotifications.getState().markAllRead()
  }

  return (
    <header className="topbar">
      <div className="brand">
        <img src={logo} alt="" />
        Endora
      </div>
      <span className="spacer" />
      <div className="topbar-item">
        <button
          className={`topbar-btn ${panel === 'workspace' ? 'on' : ''}`}
          onClick={() => toggle('workspace')}
          title={t('top.workspaces')}
          aria-label={t('top.workspaces')}
          aria-haspopup="dialog"
          aria-expanded={panel === 'workspace'}
        >
          <WorkspaceIcon />
        </button>
        {panel === 'workspace' && (
          <Popover onClose={close}>
            <div className="popover-head">{t('top.workspaces')}</div>
            <p className="popover-empty muted">{t('top.workspacesSoon')}</p>
          </Popover>
        )}
      </div>
      <button
        className="topbar-btn"
        onClick={() => useTabs.getState().openView({ kind: 'mocks' })}
        title={runningMocks > 0 ? t('top.servicesRunning', { count: runningMocks }) : t('top.servicesTitle')}
        aria-label={t('top.services')}
      >
        <ServicesIcon />
        {runningMocks > 0 && <span className="topbar-dot" />}
      </button>
      <div className="topbar-item">
        <button
          className={`topbar-btn ${panel === 'notifications' ? 'on' : ''}`}
          onClick={() => toggle('notifications')}
          title={t('top.notifications')}
          aria-label={unread > 0 ? t('top.notificationsUnread', { count: unread }) : t('top.notifications')}
          aria-haspopup="dialog"
          aria-expanded={panel === 'notifications'}
        >
          <BellIcon />
          {unread > 0 && <span className="topbar-badge">{unread}</span>}
        </button>
        {panel === 'notifications' && <NotificationsPanel onClose={close} />}
      </div>
      <button className="topbar-btn" onClick={() => useTabs.getState().openSettings()} title={t('common.settings')} aria-label={t('common.settings')}>
        <GearIcon />
      </button>
    </header>
  )
}
