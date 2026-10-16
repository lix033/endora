import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { xml } from '@codemirror/lang-xml'
import { html } from '@codemirror/lang-html'
import { EditorView } from '@codemirror/view'
import type { CodegenLanguage, CodegenOption } from '@shared/api'
import { editorTheme } from '../editor'
import { buildExecutionInput } from '../stores/context'
import { useEnvironments } from '../stores/environments'
import { useSettings } from '../stores/settings'
import { tabTitle, type Tab } from '../stores/tabs'
import { toast } from '../stores/ui'
import { useWorkspace } from '../stores/workspace'

let languagesCache: CodegenLanguage[] | null = null

/** Libellés des options du générateur (repli sur le libellé d'origine pour une option inconnue). */
const OPTION_LABELS: Record<string, string> = {
  includeBoilerplate: 'Inclure le code d’amorce',
  indentCount: 'Taille de l’indentation',
  indentType: 'Type d’indentation',
  requestTimeout: 'Délai d’attente (ms)',
  requestTimeoutInSeconds: 'Délai d’attente (s)',
  followRedirect: 'Suivre les redirections',
  followOriginalHttpMethod: 'Conserver la méthode lors des redirections',
  maxRedirects: 'Nombre maximal de redirections',
  trimRequestBody: 'Supprimer les espaces des champs du body',
  multiLine: 'Commande sur plusieurs lignes',
  longFormat: 'Options en forme longue',
  lineContinuationCharacter: 'Caractère de continuation de ligne',
  quoteType: 'Type de guillemets',
  silent: 'Mode silencieux',
  quiet: 'Mode discret',
  debug: 'Mode débogage',
  ignoreWarnings: 'Ignorer les avertissements',
  asyncAwaitEnabled: 'Utiliser async/await',
  ES6_enabled: 'Syntaxe ES6',
  asyncType: 'Mode de communication',
  protocol: 'Protocole',
  useMimeType: 'Utiliser curl_mime'
}

const VALUE_LABELS: Record<string, string> = { Tab: 'Tabulation', Space: 'Espace', single: 'simples', double: 'doubles', async: 'asynchrone', sync: 'synchrone' }

/** Coloration : JavaScript sert aussi aux langages de syntaxe proche (Java, C#, Go, Swift…). */
function extensionsFor(syntax: string) {
  const base = [editorTheme, EditorView.lineWrapping]
  if (syntax === 'json') return [json(), ...base]
  if (syntax === 'xml') return [xml(), ...base]
  if (syntax === 'html') return [html(), ...base]
  if (['javascript', 'typescript', 'java', 'csharp', 'c', 'golang', 'swift', 'kotlin', 'dart', 'objectivec', 'rust', 'php'].includes(syntax)) return [javascript(), ...base]
  return base
}

export function CodePanel({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const codegen = useSettings((s) => s.settings.codegen)
  const update = useSettings((s) => s.update)
  const [languages, setLanguages] = useState<CodegenLanguage[]>(languagesCache ?? [])
  const [options, setOptions] = useState<CodegenOption[]>([])
  const [showOptions, setShowOptions] = useState(false)
  const [snippet, setSnippet] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Régénère quand la requête, l'environnement ou les variables changent.
  const environments = useEnvironments((s) => s.environments)
  const activeEnv = useEnvironments((s) => s.activeId)
  const globals = useEnvironments((s) => s.globals)
  const collections = useWorkspace((s) => s.collections)

  useEffect(() => {
    if (languagesCache) return
    void window.endora.codegenLanguages().then((l) => {
      languagesCache = l
      setLanguages(l)
    })
  }, [])

  const key = `${codegen.language}_${codegen.variant}`
  const chosen = codegen.options[key] ?? {}
  const current = languages.find((l) => l.key === codegen.language)

  useEffect(() => {
    void window.endora.codegenOptions(codegen.language, codegen.variant).then(setOptions)
  }, [codegen.language, codegen.variant])

  useEffect(() => {
    const t = setTimeout(() => {
      const input = buildExecutionInput(tab, 'codegen', tabTitle(tab))
      void window.endora.generateCode(input, codegen.language, codegen.variant, chosen, codegen.resolveVariables).then((r) => {
        if (r.ok) {
          setSnippet(r.snippet)
          setError(null)
        } else setError(r.message)
      })
    }, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.draft, codegen, environments, activeEnv, globals, collections])

  const extensions = useMemo(() => extensionsFor(current?.syntax ?? 'text'), [current?.syntax])

  const setChoice = (value: string) => {
    const [language, variant] = JSON.parse(value) as [string, string]
    update((s) => ({ ...s, codegen: { ...s.codegen, language, variant } }))
  }
  const setOption = (id: string, value: unknown) =>
    update((s) => ({ ...s, codegen: { ...s.codegen, options: { ...s.codegen.options, [key]: { ...(s.codegen.options[key] ?? {}), [id]: value } } } }))

  return (
    <aside className="code-panel">
      <header className="code-head">
        <strong>Code</strong>
        <button className="ghost" onClick={onClose} aria-label="Fermer le panneau de code">
          ×
        </button>
      </header>
      <div className="code-tools">
        <select value={JSON.stringify([codegen.language, codegen.variant])} onChange={(e) => setChoice(e.target.value)} aria-label="Langage">
          {languages.map((l) =>
            l.variants.map((v) => (
              <option key={`${l.key}_${v}`} value={JSON.stringify([l.key, v])}>
                {l.variants.length > 1 || v !== l.label ? `${l.label} — ${v}` : l.label}
              </option>
            ))
          )}
        </select>
        <button className={`ghost small ${showOptions ? 'on' : ''}`} onClick={() => setShowOptions(!showOptions)} title="Options du générateur">
          Options
        </button>
        <button
          className="small-btn"
          disabled={!snippet || Boolean(error)}
          onClick={() => void window.endora.writeClipboard(snippet).then(() => toast('Code copié'))}
        >
          Copier
        </button>
      </div>
      <label className="check small code-resolve">
        <input
          type="checkbox"
          checked={codegen.resolveVariables}
          onChange={(e) => update((s) => ({ ...s, codegen: { ...s.codegen, resolveVariables: e.target.checked } }))}
        />
        Résoudre les variables et appliquer l’auth
      </label>
      {showOptions && (
        <div className="code-options">
          {options.length === 0 && <p className="muted small">Aucune option pour ce langage.</p>}
          {options.map((o) => {
            const value = chosen[o.id] ?? o.default
            return (
              <label key={o.id} className="code-option" title={o.description}>
                <span>{OPTION_LABELS[o.id] ?? o.name}</span>
                {o.type === 'boolean' ? (
                  <input type="checkbox" checked={Boolean(value)} onChange={(e) => setOption(o.id, e.target.checked)} />
                ) : o.type === 'enum' ? (
                  <select value={String(value)} onChange={(e) => setOption(o.id, e.target.value)}>
                    {(o.availableOptions ?? []).map((a) => (
                      <option key={String(a)} value={String(a)}>
                        {VALUE_LABELS[String(a)] ?? String(a)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={o.type === 'positiveInteger' ? 'number' : 'text'}
                    min={0}
                    value={String(value ?? '')}
                    onChange={(e) => setOption(o.id, o.type === 'positiveInteger' ? Math.max(0, Number(e.target.value) || 0) : e.target.value)}
                  />
                )}
              </label>
            )
          })}
        </div>
      )}
      <div className="code-body">
        {error ? <p className="error-text pad">{error}</p> : <CodeMirror value={snippet} height="100%" theme="none" editable={false} extensions={extensions} />}
      </div>
    </aside>
  )
}
