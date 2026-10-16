// Import : détection du format puis conversion en collection v2.1 (ou environnement, globales,
// requête). Ordre et critères de détection repris de la référence (importeurs observés) :
// cURL (première ligne), collections v1/v2/v2.1 et API cloud, environnements, globales, sauvegarde
// complète, Swagger 1.2/2.0, OpenAPI 3.0/3.1, RAML 0.8/1.0, GraphQL, HAR, WSDL 1.1/2.0, WADL.
// Convertisseurs : bibliothèques Apache-2.0 publiées par Postman ; HAR, WSDL et WADL sont des
// implémentations propres (aucune bibliothèque publique disponible).

import { load } from 'js-yaml'
import type { ImportConversion, ImportFormat, ImportOptions } from '@shared/api'
import { isCurlCommand } from '@shared/curl'
import { parseCurl } from './curl'
import { harToCollection, isHar } from './converters/har'
import { looksLikeWadl, wadlToCollection } from './converters/wadl'
import { looksLikeWsdl, wsdlToCollection } from './converters/wsdl'
import { executeHttp } from './http'
import { t } from '@shared/i18n'

type Json = Record<string, unknown>

// Convertisseurs chargés à la première utilisation : ils sont lourds et ralentiraient le démarrage.
const lazy = <T>(load: () => Promise<{ default: T }>) => {
  let cached: Promise<T> | null = null
  return () => (cached ??= load().then((m) => m.default))
}
const openapi = lazy(() => import('openapi-to-postmanv2'))
const swagger1 = lazy(() => import('swagger1-to-postman'))
const raml08 = lazy(() => import('raml-to-postman'))
const raml10 = lazy(() => import('raml1-to-postman'))
const graphql = lazy(() => import('graphql-to-postman'))
const collectionTransformer = lazy(() => import('postman-collection-transformer'))

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Nom du format détecté (traduit à l'appel). */
const labels = (): Record<ImportFormat, string> => ({
  curl: 'cURL',
  'collection-v1': 'Collection v1',
  'collection-v2': 'Collection v2 / v2.1',
  environment: t('importer.environment'),
  globals: t('importer.globals'),
  dump: t('importer.dump'),
  openapi3: 'OpenAPI 3.0',
  openapi31: 'OpenAPI 3.1',
  swagger2: 'Swagger 2.0',
  swagger1: 'Swagger 1.2',
  raml08: 'RAML 0.8',
  raml10: 'RAML 1.0',
  graphql: t('importer.graphql'),
  har: 'HTTP Archive (HAR)',
  wsdl1: 'WSDL 1.1',
  wsdl2: 'WSDL 2.0',
  wadl: 'WADL'
})

/** YAML lu sans lever (`undefined` si ce n'est pas du YAML). */
function loadYaml(text: string): unknown {
  try {
    return load(text)
  } catch {
    return undefined
  }
}

const empty = (format: ImportFormat) => ({ ok: true as const, format, formatLabel: labels()[format], collections: [], environments: [], globals: [], requests: [] })
const fail = (message: string): ImportConversion => ({ ok: false, message })

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

async function v1ToV21(collection: unknown): Promise<Json> {
  const transformer = await collectionTransformer()
  return new Promise((resolve, reject) => {
    transformer.convert(collection, { inputVersion: '1.0.0', outputVersion: '2.1.0', retainIds: false }, (err, result) => (err ? reject(err) : resolve(result)))
  })
}

const isV1Collection = (v: unknown): boolean => isObject(v) && !('item' in v) && ('requests' in v || 'folders' in v || 'order' in v)

/** Exécute un convertisseur à callback ; une sortie v1 est convertie en v2.1. */
function runConverter(converter: PostmanConverter, data: string, options: Json): Promise<Json[]> {
  return new Promise((resolve, reject) => {
    try {
      converter.convert({ type: 'string', data }, options, (err, res) => {
        if (err) return reject(err)
        if (!res?.result) return reject(new Error(res?.reason ?? t('importer.failed')))
        const collections = (res.output ?? []).filter((o) => o.type === 'collection').map((o) => o.data)
        Promise.all(collections.map((c) => (isV1Collection(c) ? v1ToV21(c) : Promise.resolve(c)))).then(resolve, reject)
      })
    } catch (err) {
      reject(err)
    }
  })
}

function openapiOptions(options: ImportOptions): Json {
  return { folderStrategy: options.folderStrategy, requestParametersResolution: options.parametersResolution, exampleParametersResolution: options.parametersResolution }
}

/** Version de la spécification, ou `null` si ce n'est pas un document OpenAPI/Swagger 2. */
async function openapiVersion(text: string): Promise<ImportFormat | null> {
  try {
    const v = (await openapi()).validate({ type: 'string', data: text })
    if (!v.result) return null
    if (v.specificationVersion === '2.0') return 'swagger2'
    if (v.specificationVersion === '3.1.x') return 'openapi31'
    if (v.specificationVersion?.startsWith('3.0')) return 'openapi3'
    return null
  } catch {
    return null
  }
}

export async function convertImport(name: unknown, text: unknown, options: ImportOptions): Promise<ImportConversion> {
  if (typeof text !== 'string' || typeof name !== 'string') return fail(t('error.invalidParams'))
  const trimmed = text.replace(/^﻿/, '').trim()
  if (trimmed === '') return fail(t('importer.empty'))
  try {
    // 1. cURL
    if (isCurlCommand(trimmed)) {
      const r = await parseCurl(trimmed)
      if (!r.ok) return fail(`cURL non reconnu : ${r.message}`)
      return { ...empty('curl'), requests: [{ name: r.name, request: r.request }] }
    }

    // 2. Formats JSON de collections, environnements et archives
    const json = parseJson(trimmed)
    if (json !== undefined) {
      const root = isObject(json) && isObject(json['collection']) && isObject((json['collection'] as Json)['info']) ? json['collection'] : json
      if (isObject(root) && isObject(root['info']) && Array.isArray(root['item'])) return { ...empty('collection-v2'), collections: [root] }
      if (isV1Collection(root)) return { ...empty('collection-v1'), collections: [await v1ToV21(root)] }
      if (isObject(json) && Array.isArray(json['collections']) && 'version' in json) {
        const collections = await Promise.all((json['collections'] as unknown[]).map((c) => (isV1Collection(c) ? v1ToV21(c) : Promise.resolve(c))))
        return {
          ...empty('dump'),
          collections,
          environments: Array.isArray(json['environments']) ? json['environments'] : [],
          globals: Array.isArray(json['globals']) ? json['globals'] : []
        }
      }
      if (isObject(json) && Array.isArray(json['values']) && json['_postman_variable_scope'] === 'globals') return { ...empty('globals'), globals: [json] }
      const env = isObject(json) && isObject(json['environment']) ? json['environment'] : json
      if (isObject(env) && Array.isArray(env['values']) && typeof env['name'] === 'string') return { ...empty('environment'), environments: [env] }
      if (Array.isArray(json) && json.length > 0 && json.every((e) => isObject(e) && 'key' in e && 'value' in e)) {
        return { ...empty('globals'), globals: [{ name: 'Globales', values: json, _postman_variable_scope: 'globals' }] }
      }
      if (isHar(json)) return { ...empty('har'), collections: [harToCollection(json, name)] }
      if (isObject(json) && 'swaggerVersion' in json) return { ...empty('swagger1'), collections: await runConverter(await swagger1(), trimmed, {}) }
    }

    // 3. Spécifications (JSON ou YAML)
    const spec = await openapiVersion(trimmed)
    if (spec) return { ...empty(spec), collections: await runConverter(await openapi(), trimmed, openapiOptions(options)) }
    const yaml = json === undefined ? loadYaml(trimmed) : undefined
    if (isObject(yaml) && 'swaggerVersion' in yaml) return { ...empty('swagger1'), collections: await runConverter(await swagger1(), JSON.stringify(yaml), {}) }

    if (/^#%RAML\s+1\.0/.test(trimmed)) return { ...empty('raml10'), collections: await runConverter(await raml10(), trimmed, {}) }
    if (/^#%RAML\s+0\.8/.test(trimmed)) return { ...empty('raml08'), collections: await runConverter(await raml08(), trimmed, {}) }

    // 4. XML
    const wsdl = looksLikeWsdl(trimmed)
    if (wsdl) return { ...empty(wsdl === 1 ? 'wsdl1' : 'wsdl2'), collections: [wsdlToCollection(trimmed, name)] }
    if (looksLikeWadl(trimmed)) return { ...empty('wadl'), collections: [wadlToCollection(trimmed, name)] }

    // 5. Schéma GraphQL (SDL ou résultat d'introspection)
    try {
      const graphqlConverter = await graphql()
      if (graphqlConverter.validate({ type: 'string', data: trimmed }).result) {
        const collections = await runConverter(graphqlConverter, trimmed, {})
        // Le convertisseur nomme la collection d'après la marque de référence : nom neutre.
        for (const c of collections) if (isObject(c['info'])) (c['info'] as Json)['name'] = name.replace(/\.(graphql|gql|json|txt)$/i, '') || t('importer.graphql')
        return { ...empty('graphql'), collections }
      }
    } catch {
      // Pas un schéma GraphQL.
    }
    return fail(t('importer.unknown'))
  } catch (err) {
    return fail(`Conversion impossible : ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** Télécharge un fichier d'import (lien public) puis le convertit. */
export async function fetchImport(url: unknown, options: ImportOptions): Promise<ImportConversion> {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) return fail(t('importer.needUrl'))
  const res = await executeHttp(
    { method: 'GET', url: url.trim(), params: [], headers: [{ id: 'a', key: 'Accept', value: 'application/json, application/yaml, text/plain, */*', enabled: true }], body: { mode: 'none' }, timeoutMs: 30_000 },
    undefined,
    { maxResponseBytes: 50 * 1024 * 1024 }
  )
  if (!res.ok) return fail(res.message)
  if (res.status >= 400) return fail(t('importer.status', { status: res.status }))
  const name = decodeURIComponent(new URL(res.finalUrl).pathname.split('/').pop() || 'import')
  return convertImport(name, Buffer.from(res.bodyBase64, 'base64').toString('utf8'), options)
}
