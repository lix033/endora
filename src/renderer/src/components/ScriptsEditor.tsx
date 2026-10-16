import { useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { EditorView } from '@codemirror/view'
import type { Scripts } from '@shared/model'
import { editorTheme, variableHighlight } from '../editor'

type Phase = keyof Scripts

/** Extraits insérés en fin de script (textes propres à Endora). */
const SNIPPETS: Record<Phase, Array<{ label: string; code: string }>> = {
  prerequest: [
    { label: 'Lire une variable d’environnement', code: `const valeur = pm.environment.get('nom')` },
    { label: 'Définir une variable d’environnement', code: `pm.environment.set('nom', 'valeur')` },
    { label: 'Définir une variable de collection', code: `pm.collectionVariables.set('nom', 'valeur')` },
    { label: 'Ajouter un en-tête', code: `pm.request.headers.upsert({ key: 'X-Request-Id', value: pm.variables.replaceIn('{{$guid}}') })` },
    { label: 'Horodatage dans une variable', code: `pm.variables.set('maintenant', new Date().toISOString())` },
    {
      label: 'Envoyer une requête',
      code: `const res = await pm.sendRequest({ url: 'https://example.com/token', method: 'POST' })\npm.environment.set('token', res.json().access_token)`
    },
    { label: 'Ne pas envoyer la requête', code: `pm.execution.skipRequest()` }
  ],
  test: [
    { label: 'Statut 200', code: `pm.test('Le statut est 200', () => {\n  pm.response.to.have.status(200)\n})` },
    { label: 'Temps de réponse', code: `pm.test('Réponse en moins de 500 ms', () => {\n  pm.expect(pm.response.responseTime).to.be.below(500)\n})` },
    { label: 'Corps JSON', code: `pm.test('Le corps contient un id', () => {\n  const json = pm.response.json()\n  pm.expect(json).to.have.property('id')\n})` },
    { label: 'En-tête présent', code: `pm.test('Content-Type présent', () => {\n  pm.response.to.have.header('Content-Type')\n})` },
    { label: 'Valeur JSON', code: `pm.test('Valeur attendue', () => {\n  pm.response.to.have.jsonBody('data.status', 'ok')\n})` },
    { label: 'Stocker une valeur de la réponse', code: `pm.environment.set('id', pm.response.json().id)` },
    { label: 'Journaliser la réponse', code: `console.log(pm.response.json())` }
  ]
}

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
            {p === 'prerequest' ? 'Avant la requête' : 'Après la réponse'}
            {scripts[p].trim() !== '' && <span className="dot" />}
          </button>
        ))}
      </nav>
      <div className="scripts-body">
        <CodeMirror key={`${editorKey}-${phase}`} value={scripts[phase]} height="100%" theme="none" extensions={extensions} onChange={(code) => onChange({ ...scripts, [phase]: code })} />
      </div>
      <aside className="snippets">
        <p className="muted small">Extraits</p>
        {SNIPPETS[phase].map((s) => (
          <button key={s.label} className="link" onClick={() => append(s.code)}>
            {s.label}
          </button>
        ))}
        <p className="muted small help">
          API disponible : <code>pm.request</code>, <code>pm.response</code>, <code>pm.test</code>, <code>pm.expect</code>, <code>pm.environment</code>,{' '}
          <code>pm.collectionVariables</code>, <code>pm.globals</code>, <code>pm.variables</code>, <code>pm.sendRequest</code>, <code>console</code>,{' '}
          <code>require('lodash' | 'crypto-js' | 'chai' | 'uuid')</code>.
        </p>
      </aside>
    </div>
  )
}
