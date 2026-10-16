// Import WADL (spécification W3C publique) → collection v2.1. Détection observée dans la référence :
// première ligne XML et « <application » (éventuellement préfixé wadl: ou ns2:) dans les 400
// premiers caractères. Les paramètres de chemin deviennent des {{variables}}.

import { attr, kids, parseXml, root as rootOf, type XNode } from './xml'
import { t } from '@shared/i18n'

type Json = Record<string, unknown>

export function looksLikeWadl(text: string): boolean {
  const head = text.trimStart().slice(0, 400)
  return head.startsWith('<') && /<(\w+:)?application[\s>]/.test(head)
}

const join = (a: string, b: string) => (b ? `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}` : a)

function walk(resource: XNode, base: string, inherited: XNode[]): Json[] {
  const path = join(base, attr(resource, 'path')).replace(/\{([^}]+)\}/g, '{{$1}}')
  const scoped = [...inherited, ...kids(resource, 'param')]
  const items: Json[] = []
  for (const method of kids(resource, 'method')) {
    const req = kids(method, 'request')[0]
    const all = [...scoped, ...kids(req, 'param')]
    const query = all.filter((p) => attr(p, 'style') === 'query')
    const headers = all.filter((p) => attr(p, 'style') === 'header')
    const mediaType = attr(kids(req, 'representation')[0], 'mediaType')
    const url = query.length > 0 ? `${path}?${query.map((q) => `${attr(q, 'name')}=${attr(q, 'default')}`).join('&')}` : path
    items.push({
      name: attr(method, 'id') || `${attr(method, 'name')} ${attr(resource, 'path')}`,
      request: {
        method: attr(method, 'name').toUpperCase() || 'GET',
        header: [...headers.map((h) => ({ key: attr(h, 'name'), value: attr(h, 'default') })), ...(mediaType ? [{ key: 'Content-Type', value: mediaType }] : [])],
        url,
        ...(mediaType
          ? { body: { mode: 'raw', raw: '', options: { raw: { language: /json/.test(mediaType) ? 'json' : /xml/.test(mediaType) ? 'xml' : 'text' } } } }
          : {})
      }
    })
  }
  return [...items, ...kids(resource, 'resource').flatMap((child) => walk(child, path, scoped))]
}

export function wadlToCollection(text: string, fileName: string): Json {
  const app = rootOf(parseXml(text), 'application')
  if (!app) throw new Error(t('importer.wadlInvalid'))
  const folders: Json[] = []
  for (const resources of kids(app, 'resources')) {
    const base = attr(resources, 'base')
    for (const resource of kids(resources, 'resource')) {
      const items = walk(resource, base, [])
      if (items.length > 0) folders.push({ name: attr(resource, 'path') || '/', item: items })
    }
  }
  const title = attr(kids(app, 'doc')[0], 'title')
  return {
    info: { name: title || fileName.replace(/\.(wadl|xml)$/i, '') || 'Import WADL', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    item: folders
  }
}
