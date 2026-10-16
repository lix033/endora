// Mise en forme (« Beautify ») des bodies, scripts et réponses.
// - Bodies et scripts : Prettier (JSON, XML, HTML, JavaScript), chargé à la première utilisation.
// - Réponses JSON : réindentation rapide qui recopie chaînes et nombres tels quels (un grand entier
//   ne perd pas sa précision, contrairement à JSON.stringify(JSON.parse(…))).
// Les variables {{nom}} sont protégées pendant la mise en forme et restituées à l'identique.
// Comportement de référence observé : bouton « Beautify » dans la barre du body brut et raccourci
// `mod+b` dans l'éditeur qui a le focus. Choix Endora : les objets JSON sont toujours dépliés, les
// tableaux courts de valeurs simples restent sur une ligne.

export type FormatLanguage = 'json' | 'xml' | 'html' | 'javascript'
export type FormatResult = { ok: true; code: string } | { ok: false; message: string }

const LANGUAGES: readonly string[] = ['json', 'xml', 'html', 'javascript'] satisfies FormatLanguage[]
export const isFormatLanguage = (v: unknown): v is FormatLanguage => typeof v === 'string' && LANGUAGES.includes(v)

const VARIABLE = /\{\{[^{}]+?\}\}/g

interface Prettier {
  format: (code: string, options: Record<string, unknown>) => Promise<string>
  plugins: unknown[]
}

let loading: Promise<Prettier> | null = null

/** Prettier et ses greffons, chargés une fois (morceaux séparés du bundle de l'interface). */
function loadPrettier(): Promise<Prettier> {
  loading ??= Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/babel'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/html'),
    import('prettier/plugins/postcss'),
    import('@prettier/plugin-xml')
  ]).then(
    ([prettier, babel, estree, html, postcss, xml]) => ({
      format: prettier.format as Prettier['format'],
      plugins: [babel, estree, html, postcss, 'default' in xml ? xml.default : xml]
    }),
    (err: unknown) => {
      loading = null
      throw err
    }
  )
  return loading
}

/** Protège les {{variables}} : chaque occurrence devient un marqueur restitué après coup. */
function protect(code: string, nonce: string, quoteBareJson: boolean): { code: string; restore: (out: string) => string } {
  const tokens: string[] = []
  const mark = (token: string) => `__endora_${nonce}_${tokens.push(token) - 1}__`
  const prepared = quoteBareJson ? prepareJson(code, mark) : code.replace(VARIABLE, mark)
  return {
    code: prepared,
    restore: (out) =>
      tokens.reduce((acc, token, i) => {
        const m = `__endora_${nonce}_${i}__`
        // En JSON, une variable hors chaîne a été remplacée par une chaîne : on retire ses guillemets.
        return (quoteBareJson ? acc.split(`"${m}"`).join(token) : acc).split(m).join(token)
      }, out)
  }
}

/**
 * Prépare un JSON pour Prettier : les variables hors chaîne deviennent des chaînes (Prettier refuse
 * `{{id}}` comme valeur), et un saut de ligne après chaque `{` force le dépliage des objets
 * (Prettier garde un objet sur une ligne s'il tient, sauf s'il était déjà déplié).
 */
function prepareJson(code: string, mark: (token: string) => string): string {
  let out = ''
  let i = 0
  while (i < code.length) {
    const c = code[i]
    if (c === '"') {
      let j = i + 1
      while (j < code.length && code[j] !== '"') j += code[j] === '\\' ? 2 : 1
      out += code.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (c === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) {
      const line = code[i + 1] === '/'
      const j = code.indexOf(line ? '\n' : '*/', i + 2)
      const end = j === -1 ? code.length : line ? j : j + 2
      out += code.slice(i, end)
      i = end
      continue
    }
    if (c === '{' && code[i + 1] === '{') {
      const m = /^\{\{[^{}]+?\}\}/.exec(code.slice(i, i + 512))
      if (m) {
        out += `"${mark(m[0])}"`
        i += m[0].length
        continue
      }
    }
    out += c === '{' ? '{\n' : c
    i++
  }
  return out
}

function options(language: FormatLanguage, plugins: unknown[]): Record<string, unknown> {
  const parser = { json: 'json', xml: 'xml', html: 'html', javascript: 'babel' }[language]
  return { parser, plugins, ...(language === 'xml' ? { xmlWhitespaceSensitivity: 'ignore' } : {}) }
}

/** Première ligne du message de Prettier (le reste est un extrait du code). */
const firstLine = (err: unknown): string => (err instanceof Error ? err.message : String(err)).split('\n')[0]!.trim()

/** Met en forme du code avec Prettier ; un code invalide donne une erreur lisible, jamais d'exception. */
export async function formatCode(code: string, language: FormatLanguage): Promise<FormatResult> {
  if (code.trim() === '') return { ok: true, code }
  let prettier: Prettier
  try {
    prettier = await loadPrettier()
  } catch (err) {
    return { ok: false, message: firstLine(err) }
  }
  const nonce = Math.random().toString(36).slice(2, 8)
  const p = protect(code, nonce, language === 'json')
  try {
    const out = await prettier.format(p.code, options(language, prettier.plugins))
    return { ok: true, code: p.restore(out).replace(/\n$/, '') }
  } catch (err) {
    if (language !== 'json') return { ok: false, message: firstLine(err) }
    // Les sauts de ligne ajoutés décalent les positions : l'erreur est recalculée sur le code d'origine.
    const plain = code.replace(VARIABLE, '0')
    try {
      await prettier.format(plain, options(language, prettier.plugins))
      return { ok: false, message: firstLine(err) }
    } catch (plainErr) {
      return { ok: false, message: firstLine(plainErr) }
    }
  }
}

const SPACE = new Set([' ', '\t', '\n', '\r'])
const STOP = new Set([',', ':', '{', '}', '[', ']', '"', ' ', '\t', '\n', '\r'])

/** Réindente un JSON valide sans réécrire ses valeurs ; null si le texte n'est pas du JSON. */
export function indentJson(text: string, indent = '  '): string | null {
  try {
    JSON.parse(text)
  } catch {
    return null
  }
  const parts: string[] = []
  let depth = 0
  let i = 0
  const newline = () => '\n' + indent.repeat(depth)
  while (i < text.length) {
    const c = text[i]!
    if (SPACE.has(c)) {
      i++
    } else if (c === '"') {
      let j = i + 1
      while (text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      parts.push(text.slice(i, j + 1))
      i = j + 1
    } else if (c === '{' || c === '[') {
      let j = i + 1
      while (SPACE.has(text[j] ?? '')) j++
      if (text[j] === (c === '{' ? '}' : ']')) {
        parts.push(c + text[j])
        i = j + 1
      } else {
        depth++
        parts.push(c + newline())
        i++
      }
    } else if (c === '}' || c === ']') {
      depth--
      parts.push(newline() + c)
      i++
    } else if (c === ',') {
      parts.push(',' + newline())
      i++
    } else if (c === ':') {
      parts.push(': ')
      i++
    } else {
      let j = i
      while (j < text.length && !STOP.has(text[j]!)) j++
      parts.push(text.slice(i, j))
      i = j
    }
  }
  return parts.join('')
}
