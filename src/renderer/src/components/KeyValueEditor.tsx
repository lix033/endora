import { useRef } from 'react'
import type { KeyValue } from '@shared/http'
import { t } from '@shared/i18n'
import { newId, newRow } from '@shared/model'
import type { Scope } from '@shared/variables'
import { VarInput } from './VarInput'

interface Props {
  rows: KeyValue[]
  onChange: (rows: KeyValue[]) => void
  keyPlaceholder?: string
  /** Form-data : chaque ligne peut être un texte ou un fichier local. */
  allowFiles?: boolean
  /** Portées pour colorer et compléter les `{{variables}}`. */
  scopes?: Scope[]
}

/** Tableau clé/valeur ; une ligne vide virtuelle en fin de liste permet d'en ajouter une. */
export function KeyValueEditor({ rows, onChange, keyPlaceholder = t('kv.key'), allowFiles = false, scopes = [] }: Props) {
  // La ligne virtuelle devient réelle avec le même identifiant : la saisie garde le focus.
  const trailingId = useRef(newId())
  const TRAILING = trailingId.current
  const update = (id: string, patch: Partial<KeyValue>) => {
    if (id === TRAILING) {
      trailingId.current = newId()
      onChange([...rows, { ...newRow(), ...patch, id }])
    } else onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id))
  const pick = async (id: string) => {
    const path = await window.endora.pickFile()
    if (path) update(id, { value: path, kind: 'file' })
  }

  const all = [...rows, { id: TRAILING, key: '', value: '', enabled: true } as KeyValue]

  return (
    <table className="kv">
      <tbody>
        {all.map((r) => {
          const isTrailing = r.id === TRAILING
          const isFile = r.kind === 'file'
          return (
            <tr key={r.id} className={r.enabled ? '' : 'disabled'}>
              <td className="kv-check">
                {!isTrailing && (
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={(e) => update(r.id, { enabled: e.target.checked })}
                    aria-label={t('kv.enable')}
                  />
                )}
              </td>
              <td>
                <VarInput value={r.key} placeholder={keyPlaceholder} scopes={scopes} onChange={(key) => update(r.id, { key })} />
              </td>
              {allowFiles && (
                <td className="kv-kind">
                  <select
                    value={isFile ? 'file' : 'text'}
                    onChange={(e) => update(r.id, e.target.value === 'file' ? { kind: 'file', value: '' } : { kind: 'text', value: '' })}
                    aria-label={t('kv.type')}
                  >
                    <option value="text">{t('kv.text')}</option>
                    <option value="file">{t('kv.file')}</option>
                  </select>
                </td>
              )}
              <td>
                {isFile ? (
                  <div className="kv-file">
                    <span className={r.value ? '' : 'muted'} title={r.value}>
                      {r.value || t('kv.noFile')}
                    </span>
                    <button className="ghost" onClick={() => void pick(r.id)}>
                      {t('kv.chooseFile')}
                    </button>
                  </div>
                ) : (
                  <VarInput value={r.value} placeholder={t('kv.value')} scopes={scopes} onChange={(value) => update(r.id, { value })} />
                )}
              </td>
              <td className="kv-del">
                {!isTrailing && (
                  <button className="ghost" onClick={() => remove(r.id)} aria-label={t('kv.delete')}>
                    ×
                  </button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
