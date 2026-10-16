import { useState } from 'react'
import { AUTH_LABELS, AUTH_TYPES, authParam, newAuth, type AuthConfig, type AuthField, type AuthType, type EffectiveAuth } from '@shared/auth'
import { resolveDeep, type Scope } from '@shared/variables'
import { toast } from '../stores/ui'
import { VarInput } from './VarInput'

interface Props {
  auth: AuthConfig | null
  onChange: (auth: AuthConfig | null) => void
  scopes: Scope[]
  /** Requête et dossier : « Hériter du parent » est proposé (valeur `null`). */
  allowInherit: boolean
  /** Auth héritée, affichée quand `auth` vaut `null`. */
  inherited?: EffectiveAuth
}

function FieldInput({ field, auth, onChange, scopes }: { field: AuthField; auth: AuthConfig; onChange: (v: AuthConfig) => void; scopes: Scope[] }) {
  const [reveal, setReveal] = useState(false)
  const raw = authParam(auth, field.key)
  const set = (value: AuthConfig['params'][string]) => onChange({ ...auth, params: { ...auth.params, [field.key]: value } })
  const text = raw === null || raw === undefined ? '' : typeof raw === 'object' ? JSON.stringify(raw, null, 2) : String(raw)

  switch (field.kind) {
    case 'checkbox':
      return (
        <label className="check">
          <input type="checkbox" checked={raw === true || raw === 'true'} onChange={(e) => set(e.target.checked)} />
          {field.label}
        </label>
      )
    case 'select':
      return (
        <select value={text} onChange={(e) => set(e.target.value)}>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    case 'textarea':
    case 'json':
      return <textarea className="auth-textarea mono" value={text} spellCheck={false} placeholder={field.placeholder} onChange={(e) => set(e.target.value)} />
    case 'secret':
      return (
        <div className="row secret-row">
          <VarInput value={text} onChange={set} scopes={scopes} type={reveal ? 'text' : 'password'} placeholder={field.placeholder} ariaLabel={field.label} />
          <button className="ghost small" onClick={() => setReveal(!reveal)} title={reveal ? 'Masquer' : 'Afficher'}>
            {reveal ? 'Masquer' : 'Afficher'}
          </button>
        </div>
      )
    default:
      return <VarInput value={text} onChange={set} scopes={scopes} placeholder={field.placeholder} ariaLabel={field.label} />
  }
}

export function AuthEditor({ auth, onChange, scopes, allowInherit, inherited }: Props) {
  const [fetching, setFetching] = useState(false)
  const selected = auth ? auth.type : allowInherit ? 'inherit' : 'noauth'
  const def = auth ? AUTH_TYPES.find((t) => t.type === auth.type) : undefined
  const visible = (f: AuthField) => !f.when || (auth !== null && f.when.values.includes(String(authParam(auth, f.when.key))))
  const basic = def?.fields.filter((f) => !f.advanced && visible(f)) ?? []
  const advanced = def?.fields.filter((f) => f.advanced && visible(f)) ?? []

  const getToken = async () => {
    if (!auth) return
    setFetching(true)
    const r = await window.endora.getOAuth2Token({ type: auth.type, params: resolveDeep(auth.params, scopes) })
    setFetching(false)
    if (!r.ok) {
      toast(`Jeton non obtenu : ${r.message}`, 'error')
      return
    }
    onChange({
      ...auth,
      params: {
        ...auth.params,
        accessToken: r.accessToken,
        ...(r.refreshToken ? { refreshToken: r.refreshToken } : {}),
        ...(r.expiresIn ? { tokenExpiresAt: new Date(Date.now() + r.expiresIn * 1000).toISOString() } : {})
      }
    })
    toast('Nouveau jeton d’accès enregistré dans l’autorisation.')
  }

  const row = (f: AuthField) =>
    f.kind === 'checkbox' ? (
      <div key={f.key} className="auth-row full">
        <FieldInput field={f} auth={auth!} onChange={onChange} scopes={scopes} />
      </div>
    ) : (
      <div key={f.key} className="auth-row">
        <label>{f.label}</label>
        <div>
          <FieldInput field={f} auth={auth!} onChange={onChange} scopes={scopes} />
          {f.hint && <p className="muted small">{f.hint}</p>}
        </div>
      </div>
    )

  return (
    <div className="auth-editor">
      <div className="auth-type">
        <label>Type</label>
        <select
          value={selected}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'inherit') onChange(null)
            else if (v === 'noauth' && !allowInherit) onChange(null)
            else onChange(newAuth(v as AuthType))
          }}
        >
          {allowInherit && <option value="inherit">Hériter du parent</option>}
          {AUTH_TYPES.map((t) => (
            <option key={t.type} value={t.type}>
              {t.label}
            </option>
          ))}
        </select>
        <p className="muted small">
          {selected === 'inherit'
            ? inherited?.auth && inherited.inheritedFrom
              ? `Utilise l’autorisation « ${AUTH_LABELS[inherited.auth.type]} » ${inherited.inheritedFrom.kind === 'collection' ? 'de la collection' : 'du dossier'} « ${inherited.inheritedFrom.name} ».`
              : 'Aucune autorisation définie par les parents : la requête part sans authentification.'
            : selected === 'noauth'
              ? allowInherit
                ? 'Cette requête n’envoie aucune autorisation, même si un parent en définit une.'
                : 'Les requêtes qui héritent de leur parent n’enverront pas d’autorisation.'
              : 'Les valeurs acceptent les {{variables}}, résolues à l’envoi.'}
        </p>
      </div>

      {auth && auth.type !== 'noauth' && (
        <div className="auth-fields">
          {basic.map(row)}
          {auth.type === 'oauth2' && (
            <div className="auth-row full">
              <button onClick={() => void getToken()} disabled={fetching}>
                {fetching ? 'Obtention du jeton…' : 'Obtenir un nouveau jeton'}
              </button>
              {typeof auth.params['tokenExpiresAt'] === 'string' && (
                <span className="muted small">Expire le {new Date(auth.params['tokenExpiresAt']).toLocaleString('fr-FR')}</span>
              )}
            </div>
          )}
          {advanced.length > 0 && (
            <details className="auth-advanced" open={auth.type === 'oauth2'}>
              <summary>{auth.type === 'oauth2' ? 'Configurer un nouveau jeton' : 'Avancé'}</summary>
              {advanced.map(row)}
            </details>
          )}
        </div>
      )}
    </div>
  )
}
