// Conversion d'une commande cURL en requête v2.1, via la bibliothèque Apache-2.0 curl-to-postmanv2.

import curlConverter from 'curl-to-postmanv2'
import type { CurlParseResult } from '@shared/api'
import { isCurlCommand } from '@shared/curl'
import { t } from '@shared/i18n'

const MAX_CURL_LENGTH = 1_000_000

export function parseCurl(text: unknown): Promise<CurlParseResult> {
  if (typeof text !== 'string' || !isCurlCommand(text)) {
    return Promise.resolve({ ok: false, message: t('curl.notCurl') })
  }
  if (text.length > MAX_CURL_LENGTH) return Promise.resolve({ ok: false, message: t('curl.tooLong') })
  return new Promise((resolve) => {
    try {
      curlConverter.convert({ type: 'string', data: text }, (err, result) => {
        if (err) return resolve({ ok: false, message: err.message || t('curl.invalid') })
        const data = result?.output?.[0]?.data
        if (!result?.result || !data) return resolve({ ok: false, message: result?.reason ?? t('curl.invalid') })
        // La description générée par le convertisseur n'est pas reprise.
        const { name, description: _description, ...request } = data
        resolve({ ok: true, name: typeof name === 'string' ? name : '', request })
      })
    } catch (err) {
      resolve({ ok: false, message: err instanceof Error ? err.message : String(err) })
    }
  })
}
