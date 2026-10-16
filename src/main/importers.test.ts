import { describe, expect, it } from 'vitest'
import { DEFAULT_IMPORT_OPTIONS, type ImportConversion } from '@shared/api'
import { importCollection } from '@shared/collection-v21'
import { emptyDraft, newRow, walkRequests, type Collection, type RequestItem } from '@shared/model'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { newVariable } from '@shared/variables'
import { codegenLanguages, codegenOptions, generateCode } from './codegen'
import { convertImport } from './importers'

const opts = DEFAULT_IMPORT_OPTIONS

async function collectionOf(name: string, text: string, format: string): Promise<Collection> {
  const r: ImportConversion = await convertImport(name, text, opts)
  if (!r.ok) throw new Error(r.message)
  expect(r.format).toBe(format)
  const c = importCollection(r.collections[0])
  if (!c.ok) throw new Error(c.message)
  return c.collection
}

const requests = (c: Collection): RequestItem[] => [...walkRequests(c.items)]
const summary = (c: Collection) => requests(c).map((r) => `${r.request.method} ${r.request.url}`)

describe('import : spécifications d’API', () => {
  it('OpenAPI 3.0 en YAML, regroupé par tags', async () => {
    const yaml = `openapi: 3.0.0
info: {title: Boutique, version: '1'}
servers: [{url: 'https://api.ex.com/v1'}]
paths:
  /produits:
    get: {summary: Lister, tags: [produits], parameters: [{name: page, in: query, schema: {type: integer}}], responses: {'200': {description: ok}}}
    post:
      summary: Créer
      tags: [produits]
      requestBody: {content: {application/json: {schema: {type: object, properties: {nom: {type: string}}}}}}
      responses: {'201': {description: ok}}
`
    const r = await convertImport('boutique.yaml', yaml, { ...opts, folderStrategy: 'Tags' })
    expect(r).toMatchObject({ ok: true, format: 'openapi3' })
    const c = importCollection((r as Extract<ImportConversion, { ok: true }>).collections[0])
    if (!c.ok) throw new Error(c.message)
    expect(c.collection.name).toBe('Boutique')
    expect(c.collection.items[0]).toMatchObject({ type: 'folder', name: 'produits' })
    const [list, create] = requests(c.collection)
    expect(list!.request.method).toBe('GET')
    expect(list!.request.params.map((p) => p.key)).toContain('page')
    expect(create!.request.body.mode).toBe('raw')
    expect(create!.request.body.raw).toContain('nom')
    expect(c.collection.variables.some((v) => v.key === 'baseUrl')).toBe(true)
  })

  it('OpenAPI 3.1 et Swagger 2.0 en JSON', async () => {
    const oas31 = JSON.stringify({ openapi: '3.1.0', info: { title: 'Neuf', version: '1' }, paths: { '/a': { get: { responses: { 200: { description: 'ok' } } } } } })
    expect((await collectionOf('a.json', oas31, 'openapi31')).name).toBe('Neuf')
    const sw2 = JSON.stringify({ swagger: '2.0', info: { title: 'Ancien', version: '1' }, host: 'ex.com', basePath: '/api', paths: { '/a': { get: { responses: { 200: { description: 'ok' } } } } } })
    expect(summary(await collectionOf('s.json', sw2, 'swagger2'))[0]).toMatch(/^GET .*\/a$/)
  })

  it('RAML 1.0 et 0.8', async () => {
    expect(summary(await collectionOf('a.raml', '#%RAML 1.0\ntitle: Neuf\nbaseUri: http://ex.com\n/livres:\n  get:\n  post:\n', 'raml10'))).toHaveLength(2)
    const old = await collectionOf('b.raml', '#%RAML 0.8\ntitle: Vieux\nbaseUri: http://ex.com\n/livres:\n  get:\n', 'raml08')
    expect(old.name).toBe('Vieux')
    expect(summary(old)[0]).toMatch(/^GET .*livres/)
  })

  it('schéma GraphQL', async () => {
    const c = await collectionOf('schema.graphql', 'type Query { livre(id: ID!): Livre }\ntype Livre { id: ID titre: String }', 'graphql')
    expect(c.name).toBe('schema')
    expect(requests(c).length).toBeGreaterThan(0)
  })
})

describe('import : collections, environnements, archives', () => {
  it('collection v1 et sauvegarde complète', async () => {
    const v1 = { id: 'c1', name: 'V1', order: ['r1'], requests: [{ id: 'r1', name: 'R', url: 'http://ex.com/x', method: 'POST', headers: 'A: 1', collectionId: 'c1', dataMode: 'raw', rawModeData: '{}' }] }
    const c = await collectionOf('v1.json', JSON.stringify(v1), 'collection-v1')
    expect(summary(c)).toEqual(['POST http://ex.com/x'])
    expect(requests(c)[0]!.request.headers.map((h) => `${h.key}:${h.value}`)).toEqual(['A:1'])

    const dump = await convertImport('backup.json', JSON.stringify({ version: 1, collections: [v1], environments: [{ name: 'E', values: [] }], globals: [] }), opts)
    expect(dump).toMatchObject({ ok: true, format: 'dump', environments: [{ name: 'E' }] })
  })

  it('environnement, globales et collection v2.1 sont transmis tels quels', async () => {
    expect(await convertImport('e.json', JSON.stringify({ name: 'Prod', values: [{ key: 'a', value: '1' }] }), opts)).toMatchObject({ ok: true, format: 'environment' })
    expect(await convertImport('g.json', JSON.stringify([{ key: 'a', value: '1' }]), opts)).toMatchObject({ ok: true, format: 'globals' })
    expect(
      await convertImport('c.json', JSON.stringify({ info: { name: 'X', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [] }), opts)
    ).toMatchObject({ ok: true, format: 'collection-v2' })
  })

  it('HAR : requêtes, query, en-têtes filtrés, bodies', async () => {
    const har = {
      log: {
        version: '1.2',
        pages: [{ title: 'Session de test' }],
        entries: [
          {
            request: {
              method: 'GET',
              url: 'https://ex.com/a?b=1',
              headers: [
                { name: ':authority', value: 'ex.com' },
                { name: 'Accept', value: 'application/json' },
                { name: 'Content-Length', value: '0' }
              ]
            }
          },
          { request: { method: 'POST', url: 'https://ex.com/form', headers: [], postData: { mimeType: 'application/x-www-form-urlencoded', text: 'x=1&y=deux' } } },
          { request: { method: 'PUT', url: 'https://ex.com/json', headers: [], postData: { mimeType: 'application/json', text: '{"a":1}' } } }
        ]
      }
    }
    const c = await collectionOf('trace.har', JSON.stringify(har), 'har')
    expect(c.name).toBe('Session de test')
    const [get, form, put] = requests(c)
    expect(get!.name).toBe('GET /a')
    expect(get!.request.headers.map((h) => h.key)).toEqual(['Accept'])
    expect(get!.request.params.map((p) => `${p.key}=${p.value}`)).toEqual(['b=1'])
    expect(form!.request.body.urlencoded.map((f) => `${f.key}=${f.value}`)).toEqual(['x=1', 'y=deux'])
    expect(put!.request.body).toMatchObject({ mode: 'raw', language: 'json', raw: '{"a":1}' })
  })

  it('cURL donne une requête isolée ; un contenu inconnu est refusé', async () => {
    expect(await convertImport('c.txt', "curl -X DELETE 'https://ex.com/x'", opts)).toMatchObject({ ok: true, format: 'curl', requests: [{ request: { method: 'DELETE' } }] })
    expect(await convertImport('x.txt', 'bonjour', opts)).toMatchObject({ ok: false })
    expect(await convertImport('x.txt', '   ', opts)).toMatchObject({ ok: false })
  })
})

describe('import : SOAP et WADL', () => {
  const wsdl11 = `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:xs="http://www.w3.org/2001/XMLSchema"
  xmlns:tns="http://www.dataaccess.com/webservicesserver/" name="NumberConversion" targetNamespace="http://www.dataaccess.com/webservicesserver/">
  <wsdl:types>
    <xs:schema elementFormDefault="qualified" targetNamespace="http://www.dataaccess.com/webservicesserver/">
      <xs:element name="NumberToWords"><xs:complexType><xs:sequence><xs:element name="ubiNum" type="xs:unsignedLong"/></xs:sequence></xs:complexType></xs:element>
      <xs:element name="Commande"><xs:complexType><xs:sequence><xs:element name="client" type="tns:Client"/><xs:element name="urgent" type="xs:boolean"/></xs:sequence></xs:complexType></xs:element>
      <xs:complexType name="Client"><xs:sequence><xs:element name="nom" type="xs:string"/><xs:element name="age" type="xs:int"/></xs:sequence></xs:complexType>
    </xs:schema>
  </wsdl:types>
  <wsdl:message name="NumberToWordsSoapRequest"><wsdl:part name="parameters" element="tns:NumberToWords"/></wsdl:message>
  <wsdl:message name="CommandeRequest"><wsdl:part name="parameters" element="tns:Commande"/></wsdl:message>
  <wsdl:portType name="ConversionPortType">
    <wsdl:operation name="NumberToWords"><wsdl:input message="tns:NumberToWordsSoapRequest"/></wsdl:operation>
    <wsdl:operation name="Commande"><wsdl:input message="tns:CommandeRequest"/></wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="ConversionSoapBinding" type="tns:ConversionPortType">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="NumberToWords"><soap:operation soapAction="urn:NumberToWords" style="document"/></wsdl:operation>
    <wsdl:operation name="Commande"><soap:operation soapAction="urn:Commande" style="document"/></wsdl:operation>
  </wsdl:binding>
  <wsdl:binding name="ConversionSoapBinding12" type="tns:ConversionPortType">
    <soap12:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="NumberToWords"><soap12:operation soapAction="urn:NumberToWords" style="document"/></wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="NumberConversion">
    <wsdl:port name="ConversionSoap" binding="tns:ConversionSoapBinding"><soap:address location="https://www.dataaccess.com/NumberConversion.wso"/></wsdl:port>
    <wsdl:port name="ConversionSoap12" binding="tns:ConversionSoapBinding12"><soap12:address location="https://www.dataaccess.com/NumberConversion.wso"/></wsdl:port>
  </wsdl:service>
</wsdl:definitions>`

  it('WSDL 1.1 : une requête SOAP 1.1 et 1.2 par opération, avec enveloppe', async () => {
    const c = await collectionOf('conv.wsdl', wsdl11, 'wsdl1')
    expect(c.name).toBe('NumberConversion')
    expect(c.items.map((f) => f.name)).toEqual(['ConversionSoap (SOAP 1.1)', 'ConversionSoap12 (SOAP 1.2)'])
    const [toWords, commande, toWords12] = requests(c)
    expect(toWords!.request.method).toBe('POST')
    expect(toWords!.request.headers.map((h) => `${h.key}: ${h.value}`)).toEqual(['Content-Type: text/xml; charset=utf-8', 'SOAPAction: "urn:NumberToWords"'])
    expect(toWords!.request.body.raw).toContain('<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">')
    expect(toWords!.request.body.raw).toContain('<NumberToWords xmlns="http://www.dataaccess.com/webservicesserver/">')
    expect(toWords!.request.body.raw).toContain('<ubiNum>0</ubiNum>')
    expect(commande!.request.body.raw).toMatch(/<client>\s*<nom>string<\/nom>\s*<age>0<\/age>\s*<\/client>\s*<urgent>true<\/urgent>/)
    expect(toWords12!.request.headers[0]!.value).toBe('application/soap+xml; charset=utf-8; action="urn:NumberToWords"')
    expect(toWords12!.request.body.raw).toContain('http://www.w3.org/2003/05/soap-envelope')
  })

  it('WSDL 2.0', async () => {
    const wsdl2 = `<?xml version="1.0"?>
<description xmlns="http://www.w3.org/ns/wsdl" xmlns:wsoap="http://www.w3.org/ns/wsdl/soap" xmlns:tns="urn:hotel" xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:hotel">
  <types><xs:schema targetNamespace="urn:hotel"><xs:element name="checkAvailability"><xs:complexType><xs:sequence><xs:element name="checkInDate" type="xs:date"/></xs:sequence></xs:complexType></xs:element></xs:schema></types>
  <interface name="reservationInterface"><operation name="opCheckAvailability"><input element="tns:checkAvailability"/></operation></interface>
  <binding name="reservationSOAPBinding" interface="tns:reservationInterface" type="http://www.w3.org/ns/wsdl/soap" wsoap:version="1.2"/>
  <service name="reservationService" interface="tns:reservationInterface"><endpoint name="reservationEndpoint" binding="tns:reservationSOAPBinding" address="http://greath.example.com/2004/reservation"/></service>
</description>`
    const c = await collectionOf('hotel.wsdl', wsdl2, 'wsdl2')
    const [op] = requests(c)
    expect(op!.request.url).toBe('http://greath.example.com/2004/reservation')
    expect(op!.request.body.raw).toContain('<checkInDate>2024-01-01</checkInDate>')
  })

  it('WADL : ressources imbriquées, paramètres de chemin et de requête', async () => {
    const wadl = `<?xml version="1.0"?>
<application xmlns="http://wadl.dev.java.net/2009/02">
  <resources base="https://api.ex.com/">
    <resource path="users">
      <method name="GET" id="listUsers"><request><param name="page" style="query" default="1"/></request></method>
      <resource path="{id}">
        <param name="id" style="template"/>
        <method name="DELETE"><request><param name="X-Token" style="header"/></request></method>
      </resource>
    </resource>
  </resources>
</application>`
    const c = await collectionOf('api.wadl', wadl, 'wadl')
    expect(summary(c)).toEqual(['GET https://api.ex.com/users?page=1', 'DELETE https://api.ex.com/users/{{id}}'])
    expect(requests(c)[1]!.request.headers.map((h) => h.key)).toEqual(['X-Token'])
  })
})

describe('génération de code', () => {
  const input = (patch: Partial<RequestItem['request']> = {}) => ({
    requestId: 'r',
    name: 'Test',
    draft: { ...emptyDraft(), method: 'POST', url: '{{base}}/items?x=1', headers: [newRow('X-Id', '{{id}}')], ...patch },
    chain: [{ kind: 'collection' as const, name: 'C', auth: { type: 'bearer' as const, params: { token: '{{tok}}' } }, scripts: { prerequest: '', test: '' } }],
    variables: { environment: [newVariable('base', 'https://api.ex.com'), newVariable('id', '42'), newVariable('tok', 'secret')], globals: [], collection: [] },
    settings: DEFAULT_SETTINGS.general
  })

  it('liste les langages sans ceux propres à la marque de référence', async () => {
    const langs = await codegenLanguages()
    expect(langs.find((l) => l.key === 'python')?.variants).toContain('Requests')
    expect(langs.some((l) => l.key === 'postman-cli')).toBe(false)
    expect((await codegenOptions('nodejs', 'Axios')).map((o) => o.id)).toContain('indentCount')
  })

  it('résout les variables et applique l’auth héritée', async () => {
    const r = await generateCode(input({ body: { ...emptyDraft().body, mode: 'raw', language: 'json', raw: '{"a":"{{id}}"}' } }), 'python', 'Requests', {}, true)
    if (!r.ok) throw new Error(r.message)
    expect(r.snippet).toContain('url = "https://api.ex.com/items?x=1"')
    expect(r.snippet).toContain("'X-Id': '42'")
    expect(r.snippet).toContain("'Authorization': 'Bearer secret'")
    expect(r.snippet).toContain("'Content-Type': 'application/json'")
    expect(r.snippet).toContain('"a": "42"')
  })

  it('peut garder les variables telles quelles', async () => {
    const r = await generateCode(input(), 'shell', 'Httpie', {}, false)
    if (!r.ok) throw new Error(r.message)
    expect(r.snippet).toContain('{{base}}')
  })

  it('génère du form-data avec fichier et rapporte un langage inconnu', async () => {
    const f = { ...newRow('fichier', '/tmp/a.png'), kind: 'file' as const }
    const r = await generateCode(input({ body: { ...emptyDraft().body, mode: 'formdata', formdata: [newRow('n', 'v'), f] } }), 'curl', 'cURL', {}, true)
    if (!r.ok) throw new Error(r.message)
    expect(r.snippet).toContain("--form 'fichier=@\"/tmp/a.png\"'")
    expect(await generateCode(input(), 'cobol', 'x', {}, true)).toMatchObject({ ok: false })
  })
})
