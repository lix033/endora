import { useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { EditorView } from '@codemirror/view'
import { t, type MessageKey } from '@shared/i18n'
import type { Scripts } from '@shared/model'
import { editorTheme, variableHighlight } from '../editor'

type Phase = keyof Scripts

/** Extraits insérés en fin de script (textes propres à Endora), dans la langue de l'interface. */
const SNIPPETS: Record<Phase, Array<{ label: MessageKey; code: MessageKey | string }>> = {
  prerequest: [
    { label: 'snip.getEnv', code: 'snip.getEnv.code' },
    { label: 'snip.setEnv', code: 'snip.setEnv.code' },
    { label: 'snip.setCollection', code: 'snip.setCollection.code' },
    { label: 'snip.addHeader', code: `pm.request.headers.upsert({ key: 'X-Request-Id', value: pm.variables.replaceIn('{{$guid}}') })` },
    { label: 'snip.timestamp', code: 'snip.timestamp.code' },
    {
      label: 'snip.sendRequest',
      code: `const res = await pm.sendRequest({ url: 'https://example.com/token', method: 'POST' })\npm.environment.set('token', res.json().access_token)`
    },
    { label: 'snip.skip', code: `pm.execution.skipRequest()` }
  ],
  test: [
    { label: 'snip.status200', code: 'snip.status200.code' },
    { label: 'snip.responseTime', code: 'snip.responseTime.code' },
    { label: 'snip.jsonBody', code: 'snip.jsonBody.code' },
    { label: 'snip.headerPresent', code: 'snip.headerPresent.code' },
    { label: 'snip.jsonValue', code: 'snip.jsonValue.code' },
    { label: 'snip.storeValue', code: `pm.environment.set('id', pm.response.json().id)` },
    { label: 'snip.logResponse', code: `console.log(pm.response.json())` }
  ]
}

/** Code d'un extrait : clé de traduction (textes à traduire) ou code littéral. */
const snippetCode = (code: MessageKey | string): string => (code.startsWith('snip.') ? t(code as MessageKey) : code)

const extensions = [javascript(), EditorView.lineWrapping, editorTheme, variableHighlight]

export function ScriptsEditor({ scripts, onChange, editorKey }: { scripts: Scripts; onChange: (s: Scripts) => void; editorKey: string }) {
  const [phase, setPhase] = useState<Phase>('prerequest')
  const append = (code: string) => {
    const current = scripts[phase]
    onChange({ ...scripts, [phase]: current.trim() === '' ? code : `${current.replace(/\s+$/, '')}\n\n${code}` })
  }
  return (
    <div className="scripts-editor">
      <nav className="scripts-phases">
        {(['prerequest', 'test'] as const).map((p) => (
          <button key={p} className={phase === p ? 'active' : ''} onClick={() => setPhase(p)}>
            {p === 'prerequest' ? t('scripts.prerequest') : t('scripts.test')}
            {scripts[p].trim() !== '' && <span className="dot" />}
          </button>
        ))}
      </nav>
      <div className="scripts-body">
        <CodeMirror key={`${editorKey}-${phase}`} value={scripts[phase]} height="100%" theme="none" extensions={extensions} onChange={(code) => onChange({ ...scripts, [phase]: code })} />
      </div>
      <aside className="snippets">
        <p className="muted small">{t('scripts.snippets')}</p>
        {SNIPPETS[phase].map((s) => (
          <button key={s.label} className="link" onClick={() => append(snippetCode(s.code))}>
            {t(s.label)}
          </button>
        ))}
        <p className="muted small help">
          {t('scripts.api')} <code>pm.request</code>, <code>pm.response</code>, <code>pm.test</code>, <code>pm.expect</code>, <code>pm.environment</code>,{' '}
          <code>pm.collectionVariables</code>, <code>pm.globals</code>, <code>pm.variables</code>, <code>pm.sendRequest</code>, <code>console</code>,{' '}
          <code>require('lodash' | 'crypto-js' | 'chai' | 'uuid')</code>.
        </p>
      </aside>
    </div>
  )
}
