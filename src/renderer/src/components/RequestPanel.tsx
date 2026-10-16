import { useMemo, useRef, useState, type ClipboardEvent } from 'react'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { effectiveAuth } from '@shared/auth'
import { isFormatLanguage } from '@shared/format'
import { t } from '@shared/i18n'
import { importRequest } from '@shared/collection-v21'
import { generateCurl, isCurlCommand } from '@shared/curl'
import { HTTP_METHODS } from '@shared/http'
import type { BodyMode, ProtocolVersion, RawLanguage, RequestDraft } from '@shared/model'
import { paramsFromUrl, urlWithParams } from '@shared/url'
import { beautifyView, formatLanguage } from '../beautify'
import { editorTheme, variableHighlight } from '../editor'
import { tabChain } from '../stores/context'
import { memoryKey, useScrollMemory, useTabState } from '../stores/tabui'
import { isDirty, useTabs, type Tab } from '../stores/tabs'
import { toast } from '../stores/ui'
import { useWorkspace } from '../stores/workspace'
import { AuthEditor } from './AuthEditor'
import { BeautifyButton } from './BeautifyButton'
import { CodeEditor } from './CodeEditor'
import { KeyValueEditor } from './KeyValueEditor'
import { ScriptsEditor } from './ScriptsEditor'
import { horizontalWheel } from './Splitter'
import { useScopes, VarInput } from './VarInput'
import { urlInputRef, useLayout } from '../shortcuts'

type Section = 'params' | 'auth' | 'headers' | 'body' | 'scripts' | 'settings'

const languageExtension = { json: [json()], xml: [xml()], html: [html()], text: [], javascript: [javascript()] }

/** Extensions du body brut, une liste par langage (stable d'un rendu à l'autre). */
const bodyExtensions = Object.fromEntries(
  (Object.keys(languageExtension) as RawLanguage[]).map((l) => [
    l,
    [...languageExtension[l], editorTheme, variableHighlight, ...(isFormatLanguage(l) ? [formatLanguage.of(l)] : [])]
  ])
) as Record<RawLanguage, Extension[]>

export async function copyAsCurl(draft: RequestDraft): Promise<void> {
  await window.endora.writeClipboard(generateCurl(draft))
  toast(t('req.curlCopied'))
}

export function RequestPanel({ tab }: { tab: Tab }) {
  const { updateDraft, replaceDraft, send, cancel, save } = useTabs.getState()
  const codePanel = useLayout((s) => s.codePanel)
  // Sous-onglet, position du body et défilement : retrouvés au retour sur l'onglet.
  const [section, setSection] = useTabState<Section>(tab.id, 'request.section', 'params')
  const bodyView = useRef<EditorView | null>(null)
  const tabBodyRef = useScrollMemory<HTMLDivElement>(tab.id, `request.${section}`)
  const [converting, setConverting] = useState(false)
  const collections = useWorkspace((s) => s.collections)
  const collectionId = tab.source?.kind === 'collection' ? tab.source.collectionId : null
  const scopes = useScopes(collectionId)
  const d = tab.draft
  const edit = (fn: (d: RequestDraft) => RequestDraft) => updateDraft(tab.id, fn)
  const editBody = (patch: Partial<RequestDraft['body']>) => edit((x) => ({ ...x, body: { ...x.body, ...patch } }))
  const count = (rows: { key: string; enabled: boolean }[]) => rows.filter((r) => r.enabled && r.key !== '').length
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const inherited = useMemo(() => effectiveAuth(null, tabChain(tab).map((p) => ({ auth: p.auth, name: p.name, kind: p.kind }))), [collections, tab.source])

  // Coller un cURL qui remplace tout le contenu de l'URL convertit la requête de l'onglet
  // (comportement de référence : méthode, en-têtes et body sont réinitialisés puis remplis).
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text/plain')
    const input = e.currentTarget
    const replacesAll = input.value === '' || (input.selectionStart === 0 && input.selectionEnd === input.value.length)
    if (!replacesAll || !isCurlCommand(text)) return
    e.preventDefault()
    setConverting(true)
    void window.endora.parseCurl(text).then((r) => {
      setConverting(false)
      if (!r.ok) {
        toast(t('req.curlInvalid', { message: r.message }), 'error')
        return
      }
      replaceDraft(tab.id, importRequest(r.request))
    })
  }

  const methods: string[] = HTTP_METHODS.includes(d.method as (typeof HTTP_METHODS)[number]) ? [...HTTP_METHODS] : [...HTTP_METHODS, d.method]
  const hasScripts = d.scripts.prerequest.trim() !== '' || d.scripts.test.trim() !== ''

  return (
    <section className="request">
      <form
        className="urlbar"
        onSubmit={(e) => {
          e.preventDefault()
          if (tab.sending) cancel(tab.id)
          else void send(tab.id)
        }}
      >
        <select className={`method m-${d.method}`} value={d.method} onChange={(e) => edit((x) => ({ ...x, method: e.target.value }))}>
          {methods.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <VarInput
          className={`url ${converting ? 'converting' : ''}`}
          inputRef={urlInputRef}
          value={d.url}
          scopes={scopes}
          placeholder={t('req.urlPlaceholder')}
          onPaste={onPaste}
          ariaLabel="URL"
          onChange={(url) => edit((x) => ({ ...x, url, params: paramsFromUrl(url, x.params) }))}
        />
        <button type="submit" className={tab.sending ? 'danger' : 'primary'}>
          {tab.sending ? t('req.cancel') : t('req.send')}
        </button>
        <button type="button" onClick={() => void save(tab.id)} title={t('req.save')} className={isDirty(tab) ? 'dirty-save' : ''}>
          {t('req.save')}
        </button>
        <button type="button" className={`code-btn ${codePanel ? 'on-outline' : ''}`} onClick={() => useLayout.getState().toggleCodePanel()} title={t('req.codeTitle')}>
          {'</>'} <span className="code-label">{t('req.code')}</span>
        </button>
      </form>

      <nav className="tabs" ref={horizontalWheel}>
        <button className={section === 'params' ? 'active' : ''} onClick={() => setSection('params')}>
          {t('req.params')} {count(d.params) > 0 && <span className="badge">{count(d.params)}</span>}
        </button>
        <button className={section === 'auth' ? 'active' : ''} onClick={() => setSection('auth')}>
          {t('req.authorization')} {d.auth && d.auth.type !== 'noauth' && <span className="dot" />}
        </button>
        <button className={section === 'headers' ? 'active' : ''} onClick={() => setSection('headers')}>
          {t('req.headers')} {count(d.headers) > 0 && <span className="badge">{count(d.headers)}</span>}
        </button>
        <button className={section === 'body' ? 'active' : ''} onClick={() => setSection('body')}>
          {t('req.body')} {d.body.mode !== 'none' && <span className="dot" />}
        </button>
        <button className={section === 'scripts' ? 'active' : ''} onClick={() => setSection('scripts')}>
          {t('req.scripts')} {hasScripts && <span className="dot" />}
        </button>
        <button className={section === 'settings' ? 'active' : ''} onClick={() => setSection('settings')}>
          {t('req.settings')} {d.protocolVersion && <span className="dot" />}
        </button>
      </nav>

      <div className="tab-body" ref={tabBodyRef}>
        {section === 'params' && (
          <KeyValueEditor rows={d.params} scopes={scopes} onChange={(params) => edit((x) => ({ ...x, params, url: urlWithParams(x.url, params) }))} />
        )}
        {section === 'auth' && <AuthEditor auth={d.auth} allowInherit inherited={inherited} scopes={scopes} onChange={(auth) => edit((x) => ({ ...x, auth }))} />}
        {section === 'headers' && <KeyValueEditor rows={d.headers} scopes={scopes} onChange={(headers) => edit((x) => ({ ...x, headers }))} keyPlaceholder={t('req.headerKey')} />}
        {section === 'body' && (
          <div className="body-editor">
            <div className="body-modes">
              {(['none', 'raw', 'urlencoded', 'formdata'] as const satisfies readonly BodyMode[]).map((m) => (
                <label key={m}>
                  <input type="radio" checked={d.body.mode === m} onChange={() => editBody({ mode: m })} />
                  {{ none: t('req.bodyNone'), raw: 'raw', urlencoded: 'x-www-form-urlencoded', formdata: 'form-data' }[m]}
                </label>
              ))}
              {d.body.mode === 'raw' && (
                <select value={d.body.language} onChange={(e) => editBody({ language: e.target.value as RawLanguage })}>
                  <option value="json">JSON</option>
                  <option value="xml">XML</option>
                  <option value="html">HTML</option>
                  <option value="text">{t('req.bodyText')}</option>
                  <option value="javascript">JavaScript</option>
                </select>
              )}
              {d.body.mode === 'raw' && isFormatLanguage(d.body.language) && (
                <BeautifyButton
                  onClick={() => {
                    const view = bodyView.current
                    if (!view) return
                    view.focus()
                    void beautifyView(view)
                  }}
                />
              )}
            </div>
            {d.body.mode === 'none' &&
              (d.extra?.['body'] ? (
                <p className="muted">{t('req.bodyUnsupported')}</p>
              ) : (
                <p className="muted">{t('req.noBody')}</p>
              ))}
            {d.body.mode === 'raw' && (
              <CodeEditor
                memory={memoryKey(tab.id, 'request.body')}
                value={d.body.raw}
                height="100%"
                theme="none"
                extensions={bodyExtensions[d.body.language]}
                onCreateEditor={(view) => (bodyView.current = view)}
                onChange={(raw) => editBody({ raw })}
              />
            )}
            {d.body.mode === 'urlencoded' && <KeyValueEditor rows={d.body.urlencoded} scopes={scopes} onChange={(urlencoded) => editBody({ urlencoded })} />}
            {d.body.mode === 'formdata' && <KeyValueEditor rows={d.body.formdata} scopes={scopes} onChange={(formdata) => editBody({ formdata })} allowFiles />}
          </div>
        )}
        {section === 'scripts' && <ScriptsEditor scripts={d.scripts} tabId={tab.id} scope="request.scripts" onChange={(scripts) => edit((x) => ({ ...x, scripts }))} />}
        {section === 'settings' && (
          <div className="form-grid">
            <label>{t('req.httpVersion')}</label>
            <div>
              <select
                value={d.protocolVersion ?? 'default'}
                onChange={(e) => {
                  const v = e.target.value
                  edit((x) => {
                    const { protocolVersion: _old, ...rest } = x
                    return v === 'default' ? rest : { ...rest, protocolVersion: v as ProtocolVersion }
                  })
                }}
              >
                <option value="default">{t('req.httpVersionGlobal')}</option>
                <option value="auto">{t('req.httpVersionAuto')}</option>
                <option value="http1">HTTP/1.x</option>
                <option value="http2">HTTP/2</option>
              </select>
              <p className="muted small">{t('req.httpVersionHint')}</p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
