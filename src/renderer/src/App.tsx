import { useEffect, useRef, type CSSProperties } from 'react'
import { setLocale, t } from '@shared/i18n'
import logo from './assets/logo.svg'
import { CodePanel } from './components/CodePanel'
import { ConsolePanel } from './components/ConsolePanel'
import { ContextMenuHost } from './components/ContextMenu'
import { DialogHost, Toasts } from './components/Dialogs'
import { CollectionView, EnvironmentView } from './components/EntityViews'
import { MocksView } from './components/MocksView'
import { RequestPanel } from './components/RequestPanel'
import { RunnerView } from './components/RunnerView'
import { ResponsePanel } from './components/ResponsePanel'
import { autoCheckUpdates, SettingsView } from './components/SettingsView'
import { Sidebar } from './components/Sidebar'
import { Splitter } from './components/Splitter'
import { TabBar } from './components/TabBar'
import { TopBar } from './components/TopBar'
import { DEFAULT_SIZES, dispatch, installKeyboardShortcuts, useLayout } from './shortcuts'
import { useConsole } from './stores/console'
import { useEnvironments } from './stores/environments'
import { useSettings } from './stores/settings'
import { startMockEvents } from './stores/mocks'
import { startUpdaterEvents } from './stores/updater'
import { startSessionPersistence, useTabs, type Tab } from './stores/tabs'
import { useWorkspace } from './stores/workspace'

// StrictMode monte les effets deux fois en développement : le chargement n'a lieu qu'une fois.
let initialized = false

function initWorkspace(): void {
  if (initialized) return
  initialized = true
  void useWorkspace
    .getState()
    .init()
    .then((session) => {
      useTabs.getState().restore(session)
      startSessionPersistence()
      // Un élément supprimé laisse son onglet de requête ouvert, détaché et non enregistré.
      useWorkspace.subscribe((s, prev) => {
        if (s.collections !== prev.collections) useTabs.getState().syncWithWorkspace()
      })
      useEnvironments.subscribe((s, prev) => {
        if (s.environments !== prev.environments) useTabs.getState().syncWithWorkspace()
      })
      void autoCheckUpdates()
    })
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

function RequestEditor({ tab }: { tab: Tab }) {
  const codePanel = useLayout((s) => s.codePanel)
  const requestRatio = useLayout((s) => s.requestRatio)
  const codeWidth = useLayout((s) => s.codeWidth)
  const { resize } = useLayout.getState()
  const editor = useRef<HTMLDivElement>(null)
  const row = useRef<HTMLDivElement>(null)
  return (
    <div ref={row} className={`editor-row ${codePanel ? 'with-code' : ''}`} style={{ '--code-width': `${codeWidth}px` } as CSSProperties}>
      <div ref={editor} className="editor" style={{ '--request-ratio': `${Math.round(requestRatio * 1000) / 10}%` } as CSSProperties}>
        <RequestPanel tab={tab} />
        <Splitter
          axis="y"
          className="request-split"
          label={t('app.resizeRequest')}
          onDrag={(y) => {
            const r = editor.current!.getBoundingClientRect()
            resize({ requestRatio: clamp((y - r.top) / r.height, 0.1, 0.9) })
          }}
          onReset={() => resize({ requestRatio: DEFAULT_SIZES.requestRatio })}
        />
        <ResponsePanel tab={tab} />
      </div>
      {codePanel && (
        <div className="code-pane">
          <Splitter
            axis="x"
            label={t('app.resizeCode')}
            onDrag={(x) => {
              const r = row.current!.getBoundingClientRect()
              resize({ codeWidth: clamp(r.right - x, 260, Math.max(260, r.width - 280)) })
            }}
            onReset={() => resize({ codeWidth: DEFAULT_SIZES.codeWidth })}
          />
          <CodePanel tab={tab} onClose={() => useLayout.getState().toggleCodePanel()} />
        </div>
      )}
    </div>
  )
}

function TabContent({ tab }: { tab: Tab }) {
  switch (tab.view?.kind) {
    case 'settings':
      return <SettingsView tab={tab} />
    case 'environment':
    case 'globals':
      return <EnvironmentView tab={tab} />
    case 'collection':
    case 'folder':
      return <CollectionView tab={tab} />
    case 'runner':
      return <RunnerView tab={tab} />
    case 'mocks':
      return <MocksView tab={tab} />
    default:
      return <RequestEditor tab={tab} />
  }
}

export function App() {
  const loaded = useWorkspace((s) => s.loaded)
  const tab = useTabs((s) => s.tabs.find((t) => t.id === s.activeId) ?? null)
  const sidebarVisible = useLayout((s) => s.sidebarVisible)
  const sidebarWidth = useLayout((s) => s.sidebarWidth)
  const consoleOpen = useConsole((s) => s.open)
  // Langue appliquée avant le rendu des enfants ; l'arbre est remonté quand elle change.
  const language = useSettings((s) => s.settings.general.language)
  setLocale(language)
  useEffect(() => {
    document.documentElement.lang = language
  }, [language])

  useEffect(initWorkspace, [])
  useEffect(() => installKeyboardShortcuts(), [])
  useEffect(() => window.endora.onMenuAction(dispatch), [])
  useEffect(() => startMockEvents(), [])
  useEffect(() => startUpdaterEvents(), [])

  return (
    <div className="shell" key={language}>
      <TopBar />
      <div className={`app ${sidebarVisible ? '' : 'no-sidebar'}`} style={{ '--sidebar-width': `${sidebarWidth}px` } as CSSProperties}>
      {sidebarVisible && <Sidebar />}
      {sidebarVisible && (
        <Splitter
          axis="x"
          className="sidebar-split"
          label={t('app.resizeSidebar')}
          onDrag={(x) => useLayout.getState().resize({ sidebarWidth: clamp(x, 180, Math.min(600, window.innerWidth * 0.5)) })}
          onReset={() => useLayout.getState().resize({ sidebarWidth: DEFAULT_SIZES.sidebarWidth })}
        />
      )}
      <main className={`workbench ${consoleOpen ? 'with-console' : ''}`}>
        <TabBar />
        {!loaded ? (
          <div className="empty-workbench muted">{t('common.loading')}</div>
        ) : tab ? (
          <div className="tab-content" key={tab.id}>
            <TabContent tab={tab} />
          </div>
        ) : (
          <div className="empty-workbench">
            <img src={logo} alt="Endora" />
            <p>{t('app.noTabs')}</p>
            <button className="primary" onClick={() => useTabs.getState().openNew()}>
              {t('app.newRequest')}
            </button>
          </div>
        )}
        {consoleOpen && <ConsolePanel />}
        <footer className="statusbar">
          <button className="ghost small" onClick={() => useLayout.getState().toggleSidebar()}>
            {sidebarVisible ? t('app.hideSidebar') : t('app.showSidebar')}
          </button>
          <span className="spacer" />
          <button className={`ghost small ${consoleOpen ? 'on' : ''}`} onClick={() => useConsole.getState().toggle()}>
            {t('app.console')}
          </button>
        </footer>
      </main>
      </div>
      <DialogHost />
      <ContextMenuHost />
      <Toasts />
    </div>
  )
}
