// Import WSDL 1.1 et 2.0 → collection v2.1 de requêtes SOAP (implémentation propre, spécifications
// W3C publiques). Une requête par opération et par point d'accès SOAP ; l'enveloppe contient
// l'élément d'entrée avec ses sous-éléments (types XSD simples remplacés par des exemples).
//
// Détection (comportement de référence observé) : XML valide contenant « definitions> » (1.1) ou
// « description> » (2.0).

import { attr, kids, kidsWithPrefix, local, namespaceOf, parseXml, root as rootOf, type XNode } from './xml'

type Json = Record<string, unknown>
type SoapVersion = '1.1' | '1.2'

const SOAP11_ENV = 'http://schemas.xmlsoap.org/soap/envelope/'
const SOAP12_ENV = 'http://www.w3.org/2003/05/soap-envelope'
const MAX_DEPTH = 4

export function looksLikeWsdl(text: string): 1 | 2 | null {
  const head = text.slice(0, 4000)
  if (!/^\s*</.test(text) || !/wsdl/i.test(head)) return null
  if (/<(\w+:)?definitions[\s>]/.test(head)) return 1
  if (/<(\w+:)?description[\s>]/.test(head)) return 2
  return null
}

const SAMPLE: Record<string, string> = {
  string: 'string',
  int: '0',
  integer: '0',
  long: '0',
  short: '0',
  decimal: '0.0',
  double: '0.0',
  float: '0.0',
  boolean: 'true',
  date: '2024-01-01',
  dateTime: '2024-01-01T00:00:00Z',
  unsignedLong: '0',
  unsignedInt: '0',
  base64Binary: 'AA=='
}

class SchemaIndex {
  elements = new Map<string, XNode>()
  complexTypes = new Map<string, XNode>()
  simpleTypes = new Map<string, XNode>()

  constructor(schemas: XNode[]) {
    for (const s of schemas) {
      for (const e of kids(s, 'element')) this.elements.set(attr(e, 'name'), e)
      for (const t of kids(s, 'complexType')) this.complexTypes.set(attr(t, 'name'), t)
      for (const t of kids(s, 'simpleType')) this.simpleTypes.set(attr(t, 'name'), t)
    }
  }

  /** Enfants d'un type complexe : séquence, tout, premier choix, extensions. */
  private children(complex: XNode): XNode[] {
    const out: XNode[] = []
    for (const group of ['sequence', 'all', 'choice']) {
      for (const g of kids(complex, group)) {
        const elements = kids(g, 'element')
        out.push(...(group === 'choice' ? elements.slice(0, 1) : elements))
      }
    }
    for (const cc of kids(complex, 'complexContent')) {
      for (const ext of kids(cc, 'extension')) {
        const base = this.complexTypes.get(local(attr(ext, 'base')))
        if (base) out.push(...this.children(base))
        out.push(...this.children(ext))
      }
    }
    return out
  }

  render(el: XNode, indent: string, depth: number, nsAttr = ''): string {
    const ref = attr(el, 'ref')
    if (ref) {
      const target = this.elements.get(local(ref))
      return target ? this.render(target, indent, depth, nsAttr) : ''
    }
    const name = attr(el, 'name')
    const typeName = local(attr(el, 'type'))
    const complex = kids(el, 'complexType')[0] ?? this.complexTypes.get(typeName)
    if (complex && depth < MAX_DEPTH) {
      const children = this.children(complex)
        .map((k) => this.render(k, `${indent}  `, depth + 1))
        .filter(Boolean)
      if (children.length === 0) return `${indent}<${name}${nsAttr} />`
      return `${indent}<${name}${nsAttr}>\n${children.join('\n')}\n${indent}</${name}>`
    }
    const simple = this.simpleTypes.get(typeName)
    const enumeration = simple ? kids(kids(simple, 'restriction')[0], 'enumeration')[0] : undefined
    const sample = enumeration ? attr(enumeration, 'value') : (SAMPLE[typeName] ?? '?')
    return `${indent}<${name}${nsAttr}>${sample}</${name}>`
  }
}

function envelope(version: SoapVersion, body: string): string {
  const ns = version === '1.2' ? SOAP12_ENV : SOAP11_ENV
  return `<?xml version="1.0" encoding="utf-8"?>\n<soap:Envelope xmlns:soap="${ns}">\n  <soap:Body>\n${body}\n  </soap:Body>\n</soap:Envelope>`
}

function soapRequest(name: string, url: string, version: SoapVersion, action: string, body: string): Json {
  const header =
    version === '1.2'
      ? [{ key: 'Content-Type', value: `application/soap+xml; charset=utf-8${action ? `; action="${action}"` : ''}` }]
      : [
          { key: 'Content-Type', value: 'text/xml; charset=utf-8' },
          { key: 'SOAPAction', value: `"${action}"` }
        ]
  return {
    name,
    request: { method: 'POST', header, url, body: { mode: 'raw', raw: envelope(version, body), options: { raw: { language: 'xml' } } } }
  }
}

const collectionOf = (name: string, folders: Json[]): Json => ({
  info: { name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: folders
})

function wsdl11(rootNode: XNode, fileName: string): Json {
  const tns = attr(rootNode, 'targetNamespace')
  const index = new SchemaIndex(kids(rootNode, 'types').flatMap((t) => kids(t, 'schema')))
  const messages = new Map(kids(rootNode, 'message').map((m) => [attr(m, 'name'), m]))
  const portTypes = new Map(kids(rootNode, 'portType').map((p) => [attr(p, 'name'), p]))
  const bindings = new Map(kids(rootNode, 'binding').map((b) => [attr(b, 'name'), b]))
  const folders: Json[] = []

  for (const service of kids(rootNode, 'service')) {
    for (const port of kids(service, 'port')) {
      const binding = bindings.get(local(attr(port, 'binding')))
      const address = kidsWithPrefix(port, 'address')[0]
      if (!binding || !address) continue
      const url = attr(address.node, 'location')
      const addressNs = namespaceOf(rootNode, address.prefix)
      // Point d'accès HTTP (non SOAP) : ignoré.
      if (!url || /wsdl\/http\/?$/.test(addressNs)) continue
      const version: SoapVersion = /soap12/.test(addressNs) ? '1.2' : '1.1'
      const style = attr(kids(binding, 'binding')[0], 'style') || 'document'
      const portType = portTypes.get(local(attr(binding, 'type')))
      const items: Json[] = []
      for (const op of kids(binding, 'operation')) {
        const opName = attr(op, 'name')
        const action = attr(kids(op, 'operation')[0], 'soapAction')
        const abstract = kids(portType, 'operation').find((o) => attr(o, 'name') === opName)
        const message = messages.get(local(attr(kids(abstract, 'input')[0], 'message')))
        const parts = kids(message, 'part')
        let body: string
        if (style === 'rpc') {
          const inner = parts.map((p) => `      <${attr(p, 'name')}>${SAMPLE[local(attr(p, 'type'))] ?? '?'}</${attr(p, 'name')}>`).join('\n')
          body = `    <${opName} xmlns="${tns}">\n${inner}\n    </${opName}>`
        } else {
          body =
            parts
              .map((p) => {
                const el = index.elements.get(local(attr(p, 'element')))
                return el ? index.render(el, '    ', 0, ` xmlns="${tns}"`) : ''
              })
              .filter(Boolean)
              .join('\n') || `    <${opName} xmlns="${tns}" />`
        }
        items.push(soapRequest(opName, url, version, action, body))
      }
      if (items.length > 0) folders.push({ name: `${attr(port, 'name')} (SOAP ${version})`, item: items })
    }
  }
  const name = attr(rootNode, 'name') || attr(kids(rootNode, 'service')[0], 'name') || fileName.replace(/\.(wsdl|xml)$/i, '') || 'Service SOAP'
  return collectionOf(name, folders)
}

function wsdl20(rootNode: XNode, fileName: string): Json {
  const tns = attr(rootNode, 'targetNamespace')
  const index = new SchemaIndex(kids(rootNode, 'types').flatMap((t) => kids(t, 'schema')))
  const interfaces = new Map(kids(rootNode, 'interface').map((i) => [attr(i, 'name'), i]))
  const bindings = new Map(kids(rootNode, 'binding').map((b) => [attr(b, 'name'), b]))
  const folders: Json[] = []
  for (const service of kids(rootNode, 'service')) {
    const iface = interfaces.get(local(attr(service, 'interface')))
    for (const endpoint of kids(service, 'endpoint')) {
      const url = attr(endpoint, 'address')
      const binding = bindings.get(local(attr(endpoint, 'binding')))
      if (!url || !iface) continue
      const version: SoapVersion = /1\.1/.test(attr(binding, 'wsoap:version') || attr(binding, 'version')) ? '1.1' : '1.2'
      const items = kids(iface, 'operation').map((op) => {
        const el = index.elements.get(local(attr(kids(op, 'input')[0], 'element')))
        const bound = kids(binding, 'operation').find((b) => local(attr(b, 'ref')) === attr(op, 'name'))
        const action = attr(bound, 'wsoap:action') || attr(bound, 'action')
        const body = el ? index.render(el, '    ', 0, ` xmlns="${tns}"`) : `    <${attr(op, 'name')} xmlns="${tns}" />`
        return soapRequest(attr(op, 'name'), url, version, action, body)
      })
      if (items.length > 0) folders.push({ name: `${attr(endpoint, 'name')} (SOAP ${version})`, item: items })
    }
  }
  const name = attr(kids(rootNode, 'service')[0], 'name') || fileName.replace(/\.(wsdl|xml)$/i, '') || 'Service SOAP'
  return collectionOf(name, folders)
}

export function wsdlToCollection(text: string, fileName: string): Json {
  const doc = parseXml(text)
  const v1 = rootOf(doc, 'definitions')
  if (v1) return wsdl11(v1, fileName)
  const v2 = rootOf(doc, 'description')
  if (v2) return wsdl20(v2, fileName)
  throw new Error('Document WSDL sans élément definitions (1.1) ni description (2.0).')
}
