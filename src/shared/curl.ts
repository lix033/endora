// Génération d'une commande cURL équivalente à ce qu'Endora envoie pour un brouillon.

import { rawContentType } from './http'
import type { RequestDraft } from './model'

/** Détection d'un texte cURL : la première ligne non vide commence par « curl » (comportement de référence). */
export function isCurlCommand(text: string): boolean {
  const firstLine = text.trimStart().split(/\r?\n/, 1)[0] ?? ''
  return /^curl(\s|$)/i.test(firstLine.trim())
}

/** Quote POSIX : tout entre apostrophes, les apostrophes internes deviennent '\''. */
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

const active = <T extends { key: string; value: string; enabled: boolean }>(rows: T[]) =>
  rows.filter((r) => r.enabled && (r.key !== '' || r.value !== ''))

export function generateCurl(d: RequestDraft): string {
  const parts: string[] = []
  const headers = active(d.headers)
  const hasHeader = (name: string) => headers.some((h) => h.key.toLowerCase() === name)
  const method = d.method.toUpperCase()
  const bodyAllowed = method !== 'GET' && method !== 'HEAD'

  const bodyArgs: string[] = []
  let impliedHeader: string | null = null
  if (bodyAllowed) {
    switch (d.body.mode) {
      case 'raw':
        if (d.body.raw !== '') {
          bodyArgs.push(`--data-raw ${shellQuote(d.body.raw)}`)
          impliedHeader = rawContentType(d.body.language)
        }
        break
      case 'urlencoded':
        for (const f of active(d.body.urlencoded)) bodyArgs.push(`--data-urlencode ${shellQuote(`${f.key}=${f.value}`)}`)
        break
      case 'formdata':
        for (const f of active(d.body.formdata)) {
          const value = f.kind === 'file' ? `@"${f.value.replace(/"/g, '\\"')}"` : `"${f.value.replace(/"/g, '\\"')}"`
          bodyArgs.push(`--form ${shellQuote(`${f.key}=${value}`)}`)
        }
        break
    }
  }

  // curl déduit POST de --data/--form : --request n'est ajouté que s'il change la méthode.
  const implied = bodyArgs.length > 0 ? 'POST' : 'GET'
  const first = ['curl', '--location']
  if (method === 'HEAD') first.push('--head')
  else if (method !== implied) first.push(`--request ${method}`)
  first.push(shellQuote(d.url.trim()))
  parts.push(first.join(' '))
  for (const h of headers) parts.push(`--header ${shellQuote(`${h.key}: ${h.value}`)}`)
  if (impliedHeader && !hasHeader('content-type')) parts.push(`--header ${shellQuote(`Content-Type: ${impliedHeader}`)}`)
  parts.push(...bodyArgs)

  return parts.join(' \\\n')
}
