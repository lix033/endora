// Import HAR 1.2 (HTTP Archive, spécification W3C publique) → collection v2.1.
// Chaque entrée devient une requête ; les pseudo-en-têtes HTTP/2 et les en-têtes calculés à
// l'envoi (content-length, host…) sont ignorés.

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function isHar(input: unknown): boolean {
  return isObject(input) && isObject(input['log']) && Array.isArray(input['log']['entries'])
}

const SKIPPED_HEADERS = new Set(['content-length', 'host', 'connection', 'accept-encoding'])

const languageOf = (mime: string): string =>
  /json/i.test(mime) ? 'json' : /xml/i.test(mime) ? 'xml' : /html/i.test(mime) ? 'html' : /javascript/i.test(mime) ? 'javascript' : 'text'

function requestName(method: string, url: string): string {
  try {
    const u = new URL(url)
    return `${method} ${u.pathname}`
  } catch {
    return `${method} ${url}`
  }
}

export function harToCollection(input: unknown, fileName: string): Json {
  const log = (input as { log: Json }).log
  const entries = (log['entries'] as unknown[]).filter(isObject)
  const items: Json[] = []
  for (const entry of entries) {
    const req = entry['request']
    if (!isObject(req)) continue
    const method = str(req['method']).toUpperCase() || 'GET'
    const url = str(req['url'])
    const headers = (Array.isArray(req['headers']) ? req['headers'] : [])
      .filter(isObject)
      .filter((h) => !str(h['name']).startsWith(':') && !SKIPPED_HEADERS.has(str(h['name']).toLowerCase()))
      .map((h) => ({ key: str(h['name']), value: str(h['value']) }))
    const post = isObject(req['postData']) ? req['postData'] : null
    let body: Json | undefined
    if (post) {
      const mime = str(post['mimeType'])
      const params = Array.isArray(post['params']) ? post['params'].filter(isObject) : []
      if (/x-www-form-urlencoded/i.test(mime)) {
        const fields = params.length > 0 ? params.map((p) => ({ key: str(p['name']), value: str(p['value']) })) : [...new URLSearchParams(str(post['text']))].map(([key, value]) => ({ key, value }))
        body = { mode: 'urlencoded', urlencoded: fields }
      } else if (/multipart\/form-data/i.test(mime) && params.length > 0) {
        body = {
          mode: 'formdata',
          formdata: params.map((p) => (p['fileName'] ? { key: str(p['name']), type: 'file', src: str(p['fileName']) } : { key: str(p['name']), value: str(p['value']), type: 'text' }))
        }
      } else if (post['text'] !== undefined) {
        body = { mode: 'raw', raw: str(post['text']), options: { raw: { language: languageOf(mime) } } }
      }
    }
    items.push({
      name: requestName(method, url),
      request: { method, header: headers, url, ...(body ? { body } : {}) }
    })
  }
  const pages = Array.isArray(log['pages']) ? log['pages'].filter(isObject) : []
  const title = str(pages[0]?.['title']) || fileName.replace(/\.har$/i, '') || 'Import HAR'
  return {
    info: { name: title, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: items
  }
}
