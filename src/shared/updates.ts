// Mises à jour de l'application.
// Règle de publication : une « petite » mise à jour ne change que le numéro de correctif
// (0.2.2 → 0.2.3 : failles de sécurité, couleurs, petites fonctionnalités). Elle peut s'installer
// toute seule si le réglage le permet. Une « grosse » mise à jour change la version mineure ou
// majeure (0.2.x → 0.3.0, 1.x → 2.0) : l'utilisateur la déclenche lui-même.

export type UpdateSize = 'small' | 'major'

export type UpdaterStatus = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'downloaded' | 'error' | 'unsupported'

export interface UpdaterState {
  status: UpdaterStatus
  /** Version proposée (disponible, en téléchargement ou prête). */
  version?: string
  size?: UpdateSize
  /** Progression du téléchargement, 0 à 100. */
  percent?: number
  notes?: string
  releaseDate?: string
  /** Téléchargée automatiquement (petite mise à jour, réglage actif). */
  auto?: boolean
  message?: string
  checkedAt?: string
}

function parse(v: string): { nums: number[]; pre: string } {
  const [core = '', pre = ''] = v.trim().replace(/^v/i, '').split('-', 2)
  return { nums: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
}

/** Taille d'une mise à jour de `current` vers `latest` ; une pré-version est toujours « grosse ». */
export function updateSize(current: string, latest: string): UpdateSize {
  const a = parse(current)
  const b = parse(latest)
  if (b.pre !== '') return 'major'
  return a.nums[0] === b.nums[0] && a.nums[1] === b.nums[1] ? 'small' : 'major'
}

/** Notes de version en texte : le flux GitHub les fournit parfois en HTML. */
export function plainNotes(notes: unknown): string | undefined {
  const text = Array.isArray(notes)
    ? notes.map((n) => (typeof n === 'object' && n !== null && 'note' in n ? String((n as { note: unknown }).note ?? '') : '')).join('\n\n')
    : typeof notes === 'string'
      ? notes
      : ''
  const plain = text
    .replace(/<\s*br\s*\/?>\s*\n?/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return plain ? plain.slice(0, 5000) : undefined
}
