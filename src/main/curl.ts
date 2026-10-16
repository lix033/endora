// Conversion d'une commande cURL en requête v2.1, via la bibliothèque Apache-2.0 curl-to-postmanv2.

import curlConverter from 'curl-to-postmanv2'
import type { CurlParseResult } from '@shared/api'
import { isCurlCommand } from '@shared/curl'

const MAX_CURL_LENGTH = 1_000_000

export function parseCurl(text: unknown): Promise<CurlParseResult> {
  if (typeof text !== 'string' || !isCurlCommand(text)) {
    return Promise.resolve({ ok: false, message: "Le texte n'est pas une commande cURL." })
  }
  if (text.length > MAX_CURL_LENGTH) return Promise.resolve({ ok: false, message: 'Commande cURL trop longue.' })
  return new Promise((resolve) => {
    try {
      curlConverter.convert({ type: 'string', data: text }, (err, result) => {
        if (err) return resolve({ ok: false, message: err.message || 'Commande cURL invalide.' })
        const data = result?.output?.[0]?.data
        if (!result?.result || !data) return resolve({ ok: false, message: result?.reason ?? 'Commande cURL invalide.' })
        // La description générée par le convertisseur n'est pas reprise.
        const { name, description: _description, ...request } = data
        resolve({ ok: true, name: typeof name === 'string' ? name : '', request })
      })
    } catch (err) {
      resolve({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
  })
}
