import { useRef, useState } from 'react'
import { newId } from '@shared/model'
import { newVariable, type Variable } from '@shared/variables'

interface Props {
  values: Variable[]
  onChange: (values: Variable[]) => void
  /** Texte d'aide sous l'en-tête. */
  hint?: string
}

/**
 * Tableau de variables : valeur initiale (exportée, partagée) et valeur courante (locale, utilisée
 * à l'envoi), type par défaut ou secret, comme dans le client de référence.
 */
export function VariablesTable({ values, onChange, hint }: Props) {
  const [filter, setFilter] = useState('')
  const [revealed, setRevealed] = useState<Set<string>>(new Set())
  const trailingId = useRef(newId())
  const f = filter.trim().toLowerCase()

  const update = (id: string, patch: Partial<Variable>) => {
    if (id === trailingId.current) {
      trailingId.current = newId()
      onChange([...values, { ...newVariable(), ...patch, id }])
    } else onChange(values.map((v) => (v.id === id ? { ...v, ...patch } : v)))
  }
  const toggleReveal = (id: string) => {
    const next = new Set(revealed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setRevealed(next)
  }

  const rows = [...values.filter((v) => f === '' || v.key.toLowerCase().includes(f)), { ...newVariable(), id: trailingId.current }]

  return (
    <div className="variables">
      <div className="variables-tools">
        <input className="filter" placeholder="Filtrer les variables" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button
          onClick={() => onChange(values.map(({ current, ...v }) => ({ ...v, value: current ?? v.value })))}
          title="Copier chaque valeur courante dans la valeur initiale"
          disabled={!values.some((v) => v.current !== undefined && v.current !== v.value)}
        >
          Tout persister
        </button>
        <button
          onClick={() => onChange(values.map(({ current: _c, ...v }) => v))}
          title="Remplacer chaque valeur courante par la valeur initiale"
          disabled={!values.some((v) => v.current !== undefined)}
        >
          Tout réinitialiser
        </button>
      </div>
      {hint && <p className="muted small">{hint}</p>}
      <table className="kv vars-table">
        <thead>
          <tr>
            <th className="kv-check" />
            <th>Variable</th>
            <th className="vars-type">Type</th>
            <th>Valeur initiale</th>
            <th>Valeur courante</th>
            <th className="kv-del" />
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const isTrailing = v.id === trailingId.current
            const secret = v.type === 'secret' && !revealed.has(v.id)
            const current = v.current ?? v.value
            return (
              <tr key={v.id} className={v.enabled ? '' : 'disabled'}>
                <td className="kv-check">
                  {!isTrailing && <input type="checkbox" checked={v.enabled} onChange={(e) => update(v.id, { enabled: e.target.checked })} aria-label="Activer" />}
                </td>
                <td>
                  <input value={v.key} placeholder="Nouvelle variable" spellCheck={false} onChange={(e) => update(v.id, { key: e.target.value })} />
                </td>
                <td className="vars-type">
                  <select value={v.type} onChange={(e) => update(v.id, { type: e.target.value as Variable['type'] })} aria-label="Type">
                    <option value="default">défaut</option>
                    <option value="secret">secret</option>
                  </select>
                </td>
                <td>
                  <input
                    type={secret ? 'password' : 'text'}
                    value={v.value}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => update(v.id, { value: e.target.value })}
                  />
                </td>
                <td>
                  <div className="row tight">
                    <input
                      type={secret ? 'password' : 'text'}
                      value={current}
                      spellCheck={false}
                      autoComplete="off"
                      className={v.current !== undefined && v.current !== v.value ? 'diverged' : ''}
                      onChange={(e) => update(v.id, { current: e.target.value })}
                    />
                    {v.type === 'secret' && !isTrailing && (
                      <button className="ghost tiny" onClick={() => toggleReveal(v.id)} title={secret ? 'Afficher' : 'Masquer'}>
                        {secret ? 'Voir' : 'Cacher'}
                      </button>
                    )}
                  </div>
                </td>
                <td className="kv-del">
                  {!isTrailing && (
                    <button className="ghost" onClick={() => onChange(values.filter((x) => x.id !== v.id))} aria-label="Supprimer">
                      ×
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
