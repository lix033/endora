// Outils communs pour les formats XML (WSDL, WADL). Les préfixes d'espaces de noms sont conservés
// pour distinguer par exemple soap:binding (SOAP 1.1) de soap12:binding (SOAP 1.2) ; les enfants
// sont recherchés par nom local.

import { XMLParser } from 'fast-xml-parser'

export type XNode = Record<string, unknown>

const ROOTS = ['definitions', 'description', 'application']
const localName = (qname: string): string => qname.slice(qname.indexOf(':') + 1)

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: false,
  // Les éléments répétables sont toujours des tableaux, pour un parcours uniforme.
  isArray: (name, _path, _leaf, isAttribute) => !isAttribute && !ROOTS.includes(localName(name)),
  parseTagValue: false,
  parseAttributeValue: false
})

export function parseXml(text: string): XNode {
  return parser.parse(text) as XNode
}

/** Élément racine par nom local (« wsdl:definitions » ou « definitions »). */
export function root(doc: XNode, name: string): XNode | undefined {
  const key = Object.keys(doc).find((k) => localName(k) === name)
  return key ? (doc[key] as XNode) : undefined
}

/** Enfants d'un nom local donné, avec le préfixe utilisé. */
export function kidsWithPrefix(n: XNode | undefined, name: string): Array<{ prefix: string; node: XNode }> {
  if (!n) return []
  const out: Array<{ prefix: string; node: XNode }> = []
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith('@') || localName(k) !== name) continue
    const prefix = k.includes(':') ? k.slice(0, k.indexOf(':')) : ''
    const list = Array.isArray(v) ? v : [v]
    for (const node of list) if (node && typeof node === 'object') out.push({ prefix, node: node as XNode })
  }
  return out
}

export const kids = (n: XNode | undefined, name: string): XNode[] => kidsWithPrefix(n, name).map((k) => k.node)
export const attr = (n: XNode | undefined, name: string): string => (n && typeof n[`@${name}`] === 'string' ? (n[`@${name}`] as string) : '')
/** Nom local d'une référence qualifiée (« tns:Foo » → « Foo »). */
export const local = (qname: string): string => localName(qname)
/** Espace de noms associé à un préfixe, déclaré sur l'élément racine. */
export const namespaceOf = (rootNode: XNode, prefix: string): string => attr(rootNode, prefix ? `xmlns:${prefix}` : 'xmlns')
