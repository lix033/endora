import { useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { useEnvironments } from '../stores/environments'
import { useSettings } from '../stores/settings'
import { useWorkspace } from '../stores/workspace'
import { scopesFor } from '../stores/context'
import type { Collection } from '@shared/model'
import { DYNAMIC_VARIABLES, findVariableTokens, lookupVariable, SCOPE_LABELS, visibleVariables, type ResolvedVariable, type Scope } from '@shared/variables'

/** Portées visibles depuis une collection, recalculées quand variables ou environnement changent. */
export function useScopes(collectionId: string | null | undefined): Scope[] {
  const environments = useEnvironments((s) => s.environments)
  const activeId = useEnvironments((s) => s.activeId)
  const globals = useEnvironments((s) => s.globals)
  const collections = useWorkspace((s) => s.collections)
  return useMemo(() => {
    const c: Collection | null = collectionId ? (collections.find((x) => x.id === collectionId) ?? null) : null
    return scopesFor(c)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [environments, activeId, globals, collections, collectionId])
}

const mask = (s: string) => '●'.repeat(Math.min(s.length, 12))

interface Props {
  value: string
  onChange: (value: string) => void
  scopes: Scope[]
  placeholder?: string
  className?: string
  onPaste?: (e: ClipboardEvent<HTMLInputElement>) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  inputRef?: RefObject<HTMLInputElement | null>
  type?: 'text' | 'password'
  ariaLabel?: string
}

interface Suggestion {
  name: string
  detail: string
}

export function VarInput({ value, onChange, scopes, placeholder, className = '', onPaste, onKeyDown, inputRef, type = 'text', ariaLabel }: Props) {
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  const mirror = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<{ x: number; y: number; name: string; resolved: ResolvedVariable | null } | null>(null)
  const [suggest, setSuggest] = useState<{ items: Suggestion[]; index: number; start: number } | null>(null)
  const autocomplete = useSettings((s) => s.settings.general.variableAutocomplete)
  const tokens = useMemo(() => findVariableTokens(value), [value])

  // Garde le calque coloré aligné avec le défilement horizontal du champ.
  useLayoutEffect(() => {
    const input = ref.current
    if (!input || !mirror.current) return
    const sync = () => {
      if (mirror.current) mirror.current.style.transform = `translateX(${-input.scrollLeft}px)`
    }
    sync()
    input.addEventListener('scroll', sync)
    return () => input.removeEventListener('scroll', sync)
  })

  const computeSuggestions = (text: string, caret: number) => {
    if (!autocomplete) return setSuggest(null)
    const before = text.slice(0, caret)
    const m = /\{\{([^{}]*)$/.exec(before)
    if (!m) return setSuggest(null)
    const prefix = m[1]!.toLowerCase()
    const items: Suggestion[] = [
      ...visibleVariables(scopes).map((v) => ({ name: v.key, detail: SCOPE_LABELS[v.scope] })),
      ...Object.entries(DYNAMIC_VARIABLES).map(([name, d]) => ({ name, detail: d.description }))
    ]
      .filter((s) => s.name.toLowerCase().includes(prefix))
      .slice(0, 50)
    setSuggest(items.length > 0 ? { items, index: 0, start: before.length - m[1]!.length } : null)
  }

  const insert = (s: Suggestion) => {
    const input = ref.current
    if (!input || !suggest) return
    const caret = input.selectionStart ?? value.length
    const after = value.slice(caret).replace(/^[^{}\s]*\}\}/, '')
    const next = `${value.slice(0, suggest.start)}${s.name}}}${after}`
    onChange(next)
    setSuggest(null)
    const pos = suggest.start + s.name.length + 2
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(pos, pos)
    })
  }

  const parts: ReactNode[] = []
  let last = 0
  for (const t of tokens) {
    if (t.start > last) parts.push(<span key={`t${last}`}>{type === 'password' ? mask(value.slice(last, t.start)) : value.slice(last, t.start)}</span>)
    const resolved = lookupVariable(scopes, t.name)
    const known = resolved !== null || t.name in DYNAMIC_VARIABLES
    parts.push(
      <span
        key={`v${t.start}`}
        className={`var-token ${known ? 'resolved' : 'unresolved'}`}
        onMouseEnter={(e) => {
          const r = (e.target as HTMLElement).getBoundingClientRect()
          setHover({ x: r.left, y: r.bottom + 4, name: t.name, resolved })
        }}
        onMouseLeave={() => setHover(null)}
        onMouseDown={(e) => {
          e.preventDefault()
          ref.current?.focus()
          ref.current?.setSelectionRange(t.end, t.end)
        }}
      >
        {value.slice(t.start, t.end)}
      </span>
    )
    last = t.end
  }
  if (last < value.length) parts.push(<span key={`t${last}`}>{type === 'password' ? mask(value.slice(last)) : value.slice(last)}</span>)

  return (
    <div className={`var-input ${className}`}>
      <div className="var-mirror" aria-hidden>
        <div ref={mirror} className="var-mirror-inner">
          {parts}
        </div>
      </div>
      <input
        ref={ref}
        type={type}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        aria-label={ariaLabel}
        onPaste={onPaste}
        onChange={(e) => {
          onChange(e.target.value)
          computeSuggestions(e.target.value, e.target.selectionStart ?? e.target.value.length)
        }}
        onBlur={() => setTimeout(() => setSuggest(null), 120)}
        onKeyDown={(e) => {
          if (suggest) {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const n = suggest.items.length
              setSuggest({ ...suggest, index: (suggest.index + (e.key === 'ArrowDown' ? 1 : -1) + n) % n })
              return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault()
              insert(suggest.items[suggest.index]!)
              return
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setSuggest(null)
              return
            }
          }
          onKeyDown?.(e)
        }}
      />
      {suggest && (
        <ul className="var-suggest" role="listbox">
          {suggest.items.map((s, i) => (
            <li
              key={s.name}
              role="option"
              aria-selected={i === suggest.index}
              className={i === suggest.index ? 'active' : ''}
              onMouseDown={(e) => {
                e.preventDefault()
                insert(s)
              }}
            >
              <span className="mono">{s.name}</span>
              <span className="muted small">{s.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {hover && <VarTooltip {...hover} />}
    </div>
  )
}

function VarTooltip({ x, y, name, resolved }: { x: number; y: number; name: string; resolved: ResolvedVariable | null }) {
  const dynamic = DYNAMIC_VARIABLES[name]
  const show = (v: string) => (resolved?.type === 'secret' ? mask(v) : v || '∅')
  return (
    <div className="var-tooltip" style={{ left: x, top: y }}>
      <div className="var-tooltip-name mono">{name}</div>
      {resolved ? (
        <>
          <div className="row-kv">
            <span>Initiale</span>
            <span className="mono">{show(resolved.initial)}</span>
          </div>
          <div className="row-kv">
            <span>Courante</span>
            <span className="mono">{show(resolved.value)}</span>
          </div>
          <div className="row-kv">
            <span>Portée</span>
            <span>
              {SCOPE_LABELS[resolved.scope]}
              {resolved.label ? ` · ${resolved.label}` : ''}
            </span>
          </div>
        </>
      ) : dynamic ? (
        <div className="muted">Variable dynamique : {dynamic.description}, générée à chaque envoi.</div>
      ) : (
        <div className="unresolved-text">Variable non résolue. Définissez-la dans l’environnement actif, la collection ou les globales.</div>
      )}
    </div>
  )
}
