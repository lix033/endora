// Vérification des mises à jour. Source configurable dans les paramètres :
//   - « propriétaire/dépôt » : dernière release GitHub publiée ;
//   - URL https : flux JSON `{ "version": "1.2.0", "url": "…", "notes": "…" }`.
// L'installation automatique viendra avec le packaging (phase 13) : seule la page de
// téléchargement est proposée.

import type { UpdateCheckResult } from '@shared/api'
import { executeHttp } from './http'

/** Compare deux versions semver (préfixe « v » toléré) ; une pré-version précède la version finale. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre = ''] = v.trim().replace(/^v/i, '').split('-', 2)
    return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0)
    if (d !== 0) return Math.sign(d)
  }
  if (x.pre === y.pre) return 0
  if (x.pre === '') return 1
  if (y.pre === '') return -1
  return x.pre < y.pre ? -1 : 1
}

export async function checkForUpdates(source: string, currentVersion: string): Promise<UpdateCheckResult> {
  const trimmed = source.trim()
  if (trimmed === '') return { ok: false, notConfigured: true, message: 'Aucune source de mises à jour configurée.' }
  const isRepo = /^[\w.-]+\/[\w.-]+$/.test(trimmed)
  if (!isRepo && !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, message: 'Source invalide : indiquez « propriétaire/dépôt » GitHub ou une URL https.' }
  }
  const url = isRepo ? `https://api.github.com/repos/${trimmed}/releases/latest` : trimmed
  const res = await executeHttp(
    {
      method: 'GET',
      url,
      params: [],
      headers: [
        { id: 'a', key: 'Accept', value: 'application/json', enabled: true },
        { id: 'u', key: 'User-Agent', value: `Endora/${currentVersion}`, enabled: true }
      ],
      body: { mode: 'none' },
      timeoutMs: 15_000
    },
    undefined,
    { maxResponseBytes: 2 * 1024 * 1024 }
  )
  if (!res.ok) return { ok: false, message: res.message }
  if (res.status === 404 && isRepo) return { ok: false, message: 'Aucune release publiée pour ce dépôt.' }
  if (res.status >= 400) return { ok: false, message: `La source a répondu ${res.status}.` }
  let data: Record<string, unknown>
  try {
    data = JSON.parse(Buffer.from(res.bodyBase64, 'base64').toString('utf8')) as Record<string, unknown>
  } catch {
    return { ok: false, message: 'Réponse illisible (JSON attendu).' }
  }
  const latest = String((isRepo ? data['tag_name'] : data['version']) ?? '').replace(/^v/i, '')
  if (!latest) return { ok: false, message: 'Version absente de la réponse.' }
  const link = isRepo ? data['html_url'] : data['url']
  const notes = isRepo ? data['body'] : data['notes']
  return {
    ok: true,
    current: currentVersion,
    latest,
    updateAvailable: compareVersions(latest, currentVersion) > 0,
    ...(typeof link === 'string' && /^https?:\/\//.test(link) ? { url: link } : {}),
    ...(typeof notes === 'string' ? { notes: notes.slice(0, 5000) } : {}),
    ...(typeof data['published_at'] === 'string' ? { publishedAt: data['published_at'] } : {})
  }
}
