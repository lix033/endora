import { describe, expect, it } from 'vitest'
import { generateCurl, isCurlCommand, shellQuote } from './curl'
import { cloneItem, draftToSpec, duplicateName, emptyDraft, isWithin, newRow, sameDraft, type FolderItem, type RequestDraft } from './model'
import { paramsFromUrl, urlWithParams } from './url'

const draft = (patch: Partial<RequestDraft> = {}, body: Partial<RequestDraft['body']> = {}): RequestDraft => {
  const d = emptyDraft()
  return { ...d, ...patch, body: { ...d.body, ...body } }
}

describe('duplicateName', () => {
  it('ajoute Copy puis incrémente jusqu’à unicité', () => {
    expect(duplicateName([], 'Login')).toBe('Login Copy')
    expect(duplicateName(['Login Copy'], 'Login')).toBe('Login Copy 2')
    expect(duplicateName(['Login Copy', 'Login Copy 2'], 'Login')).toBe('Login Copy 3')
    expect(duplicateName([], 'Login Copy')).toBe('Login Copy 2')
    expect(duplicateName([], 'Login Copy 7')).toBe('Login Copy 8')
  })
})

describe('sameDraft', () => {
  it('ignore les identifiants de lignes et les lignes vides', () => {
    const a = draft({ headers: [newRow('A', '1'), newRow()] })
    const b = draft({ headers: [newRow('A', '1')] })
    expect(sameDraft(a, b)).toBe(true)
    expect(sameDraft(a, draft({ headers: [newRow('A', '2')] }))).toBe(false)
  })
})

describe('synchronisation URL / params', () => {
  it('extrait les params de l’URL et garde les params désactivés', () => {
    const prev = [newRow('a', '1'), { ...newRow('off', 'x'), enabled: false }]
    const next = paramsFromUrl('https://x.com/p?a=2&b&c=3#h', prev)
    expect(next.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['a', '2', true],
      ['b', '', true],
      ['c', '3', true],
      ['off', 'x', false]
    ])
    expect(next[0]!.id).toBe(prev[0]!.id)
  })

  it('reconstruit la query string à partir des params activés', () => {
    const params = [newRow('a', '1'), { ...newRow('off', 'x'), enabled: false }, newRow('{{k}}', '{{v}}')]
    expect(urlWithParams('https://x.com/p?old=1#h', params)).toBe('https://x.com/p?a=1&{{k}}={{v}}#h')
    expect(urlWithParams('https://x.com/p?old=1', [])).toBe('https://x.com/p')
  })

  it('n’ajoute pas les params une seconde fois à l’envoi', () => {
    const spec = draftToSpec(draft({ url: 'http://x/?a=1', params: [newRow('a', '1')] }))
    expect(spec.url).toBe('http://x/?a=1')
    expect(spec.params).toEqual([])
  })
})

describe('arbre', () => {
  it('clone en profondeur avec de nouveaux identifiants', () => {
    const folder: FolderItem = {
      type: 'folder',
      id: 'f',
      name: 'F',
      auth: null,
      scripts: { prerequest: '', test: '' },
      items: [{ type: 'request', id: 'r', name: 'R', request: draft({ headers: [newRow('A', '1')] }) }]
    }
    const copy = cloneItem(folder) as FolderItem
    expect(copy.id).not.toBe('f')
    expect(copy.items[0]!.id).not.toBe('r')
    expect(isWithin([folder], 'f', 'r')).toBe(true)
    expect(isWithin([folder], 'r', 'f')).toBe(false)
  })
})

describe('cURL', () => {
  it('détecte une commande cURL sur la première ligne', () => {
    expect(isCurlCommand("  curl 'https://x'")).toBe(true)
    expect(isCurlCommand('CURL https://x')).toBe(true)
    expect(isCurlCommand('curly')).toBe(false)
    expect(isCurlCommand('https://x\ncurl y')).toBe(false)
  })

  it('échappe les apostrophes', () => {
    expect(shellQuote("l'eau")).toBe(`'l'\\''eau'`)
  })

  it('génère GET sans --request', () => {
    expect(generateCurl(draft({ url: 'https://x.com/a?b=1', headers: [newRow('Accept', '*/*'), { ...newRow('X', '1'), enabled: false }] }))).toBe(
      "curl --location 'https://x.com/a?b=1' \\\n--header 'Accept: */*'"
    )
  })

  it('génère un POST raw JSON avec le content-type par défaut', () => {
    expect(generateCurl(draft({ method: 'POST', url: 'https://x' }, { mode: 'raw', raw: '{"a":"l\'x"}', language: 'json' }))).toBe(
      `curl --location 'https://x' \\\n--header 'Content-Type: application/json' \\\n--data-raw '{"a":"l'\\''x"}'`
    )
  })

  it('précise la méthode quand curl ne peut pas la déduire', () => {
    expect(generateCurl(draft({ method: 'DELETE', url: 'https://x' }))).toBe("curl --location --request DELETE 'https://x'")
    expect(generateCurl(draft({ method: 'PUT', url: 'https://x' }, { mode: 'urlencoded', urlencoded: [newRow('a', 'b c')] }))).toBe(
      "curl --location --request PUT 'https://x' \\\n--data-urlencode 'a=b c'"
    )
    expect(generateCurl(draft({ method: 'HEAD', url: 'https://x' }))).toBe("curl --location --head 'https://x'")
  })

  it('génère du form-data avec fichiers', () => {
    const f = { ...newRow('f', '/tmp/a b.png'), kind: 'file' as const }
    expect(generateCurl(draft({ method: 'POST', url: 'https://x' }, { mode: 'formdata', formdata: [newRow('n', 'v'), f] }))).toBe(
      `curl --location 'https://x' \\\n--form 'n="v"' \\\n--form 'f=@"/tmp/a b.png"'`
    )
  })
})
