// Génération de code (bibliothèque Apache-2.0 postman-code-generators). Comportement de référence
// observé : l'extrait part de la requête telle qu'elle sera envoyée — variables résolues et auth
// appliquée. Les scripts ne sont pas exécutés. Les langages propres à la marque de référence sont
// exclus.

import { effectiveAuth } from '@shared/auth'
import type { CodegenLanguage, CodegenOption, CodegenResult } from '@shared/api'
import type { ExecutionInput } from '@shared/execution'
import { rawContentType, type HttpRequestSpec } from '@shared/http'
import { resolveDeep } from '@shared/variables'
import { signRequest } from './auth'
import { draftToScriptRequest, scopesFrom, toScriptVars, toSpec } from './executor'
import { prepareRequest } from './http'
import { t } from '@shared/i18n'

const EXCLUDED = new Set(['postman-cli'])

// Chargés à la première utilisation (démarrage plus rapide).
let modules: Promise<{ codegen: typeof import('postman-code-generators').default; sdk: typeof import('postman-collection').default }> | null = null
const load = () =>
  (modules ??= Promise.all([import('postman-code-generators'), import('postman-collection')]).then(([c, s]) => ({ codegen: c.default, sdk: s.default })))

export async function codegenLanguages(): Promise<CodegenLanguage[]> {
  const { codegen } = await load()
  return codegen
    .getLanguageList()
    .filter((l) => !EXCLUDED.has(l.key))
    .map((l) => ({ key: l.key, label: l.label, syntax: l.syntax_mode, variants: l.variants.map((v) => v.key) }))
}

export async function codegenOptions(language: unknown, variant: unknown): Promise<CodegenOption[]> {
  const { codegen } = await load()
  return new Promise((resolve) => {
    if (typeof language !== 'string' || typeof variant !== 'string') return resolve([])
    try {
      codegen.getOptions(language, variant, (err, options) => resolve(err ? [] : options))
    } catch {
      resolve([])
    }
  })
}

/** Corps au format v2.1 attendu par le générateur. */
function bodyDefinition(spec: HttpRequestSpec): Record<string, unknown> | undefined {
  const b = spec.body
  const active = <T extends { key: string; enabled: boolean }>(rows: T[]) => rows.filter((r) => r.enabled && r.key !== '')
  if (b.mode === 'raw') return { mode: 'raw', raw: b.text, options: { raw: { language: b.language } } }
  if (b.mode === 'urlencoded') return { mode: 'urlencoded', urlencoded: active(b.fields).map((f) => ({ key: f.key, value: f.value })) }
  if (b.mode === 'formdata') {
    return {
      mode: 'formdata',
      formdata: active(b.fields).map((f) => (f.kind === 'file' ? { key: f.key, type: 'file', src: f.value } : { key: f.key, value: f.value, type: 'text' }))
    }
  }
  return undefined
}

export async function generateCode(input: ExecutionInput, language: unknown, variant: unknown, options: unknown, resolveVariables: unknown): Promise<CodegenResult> {
  if (typeof language !== 'string' || typeof variant !== 'string' || EXCLUDED.has(language)) return { ok: false, message: t('codegen.unknown') }
  try {
    const { codegen, sdk } = await load()
    const vars = {
      environment: toScriptVars(input.variables.environment),
      globals: toScriptVars(input.variables.globals),
      collectionVariables: toScriptVars(input.variables.collection),
      local: [],
      data: []
    }
    const scopes = resolveVariables === false ? [] : scopesFrom(vars)
    const spec = toSpec(draftToScriptRequest(input), scopes, input.draft.body.language)
    let url = spec.url
    let headers: Array<[string, string]> = spec.headers.filter((h) => h.enabled && h.key !== '').map((h) => [h.key, h.value])

    if (resolveVariables !== false) {
      // Requête réellement envoyée : en-têtes par défaut et signature d'auth comprises.
      const prepared = await prepareRequest(spec)
      if (prepared.ok) {
        let p = prepared.prepared
        const { auth } = effectiveAuth(input.draft.auth, input.chain.map((c) => ({ auth: c.auth, name: c.name, kind: c.kind })))
        if (auth && auth.type !== 'digest' && auth.type !== 'ntlm') {
          const signed = await signRequest({ type: auth.type, params: resolveDeep(auth.params, scopes) }, p)
          if (signed.ok) p = signed.prepared
        }
        url = p.url.toString()
        // Le générateur ajoute son propre content-type multipart (avec boundary).
        headers = spec.body.mode === 'formdata' ? p.headers.filter(([k]) => k.toLowerCase() !== 'content-type') : p.headers
      }
    } else if (spec.body.mode === 'raw' && !headers.some(([k]) => k.toLowerCase() === 'content-type')) {
      headers.push(['Content-Type', rawContentType(spec.body.language)])
    }

    const request = new sdk.Request({
      method: spec.method.toUpperCase(),
      url,
      header: headers.map(([key, value]) => ({ key, value })),
      body: bodyDefinition(spec)
    })
    const safeOptions = options && typeof options === 'object' ? (options as Record<string, unknown>) : {}
    return await new Promise<CodegenResult>((resolve) => {
      codegen.convert(language, variant, request, safeOptions, (err, snippet) =>
        resolve(err || typeof snippet !== 'string' ? { ok: false, message: err?.message ?? t('codegen.failed') } : { ok: true, snippet })
      )
    })
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
