import { t } from '@shared/i18n'
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
        <input className="filter" placeholder={t('vars.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button
          onClick={() => onChange(values.map(({ current, ...v }) => ({ ...v, value: current ?? v.value })))}
          title={t('vars.persistAllTitle')}
          disabled={!values.some((v) => v.current !== undefined && v.current !== v.value)}
        >
          {t('vars.persistAll')}
        </button>
        <button
          onClick={() => onChange(values.map(({ current: _c, ...v }) => v))}
          title={t('vars.resetAllTitle')}
          disabled={!values.some((v) => v.current !== undefined)}
        >
          {t('vars.resetAll')}
        </button>
      </div>
      {hint && <p className="muted small">{hint}</p>}
      <table className="kv vars-table">
        <thead>
          <tr>
            <th className="kv-check" />
            <th>{t('vars.variable')}</th>
            <th className="vars-type">{t('vars.type')}</th>
            <th>{t('vars.initial')}</th>
            <th>{t('vars.current')}</th>
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
                  {!isTrailing && <input type="checkbox" checked={v.enabled} onChange={(e) => update(v.id, { enabled: e.target.checked })} aria-label={t('vars.enable')} />}
                </td>
                <td>
                  <input value={v.key} placeholder={t('vars.new')} spellCheck={false} onChange={(e) => update(v.id, { key: e.target.value })} />
                </td>
                <td className="vars-type">
                  <select value={v.type} onChange={(e) => update(v.id, { type: e.target.value as Variable['type'] })} aria-label={t('vars.type')}>
                    <option value="default">{t('vars.default')}</option>
                    <option value="secret">{t('vars.secret')}</option>
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
                      <button className="ghost tiny" onClick={() => toggleReveal(v.id)} title={secret ? t('common.show') : t('common.hide')}>
                        {secret ? t('vars.reveal') : t('vars.mask')}
                      </button>
                    )}
                  </div>
                </td>
                <td className="kv-del">
                  {!isTrailing && (
                    <button className="ghost" onClick={() => onChange(values.filter((x) => x.id !== v.id))} aria-label={t('vars.delete')}>
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
