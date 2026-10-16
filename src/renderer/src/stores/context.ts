// Contexte d'une requête : parents (auth et scripts hérités) et portées de variables.

import type { ExecutionInput, ParentContext } from '@shared/execution'
import { folderPath, type Collection, type PersistedTab } from '@shared/model'
import type { Scope } from '@shared/variables'
import { useEnvironments } from './environments'
import { useSettings } from './settings'
import { useWorkspace } from './workspace'

/** Collection d'un onglet : celle de l'élément enregistré, ou celle indiquée par une vue. */
export function tabCollection(tab: PersistedTab | null | undefined): Collection | null {
  const id = tab?.source?.kind === 'collection' ? tab.source.collectionId : tab?.view && 'collectionId' in tab.view ? tab.view.collectionId : null
  return id ? (useWorkspace.getState().collections.find((c) => c.id === id) ?? null) : null
}

/** Parents d'un élément, du plus proche à la collection. */
export function parentChain(collectionId: string, itemId: string): ParentContext[] {
  const c = useWorkspace.getState().collections.find((x) => x.id === collectionId)
  if (!c) return []
  const folders = folderPath(c.items, itemId) ?? []
  return [
    ...[...folders].reverse().map((f) => ({ kind: 'folder' as const, name: f.name, auth: f.auth, scripts: f.scripts })),
    { kind: 'collection' as const, name: c.name, auth: c.auth, scripts: c.scripts }
  ]
}

export function tabChain(tab: PersistedTab): ParentContext[] {
  if (tab.source?.kind === 'collection') return parentChain(tab.source.collectionId, tab.source.itemId)
  return []
}

/** Portées visibles pour la coloration et l'autocomplétion des variables. */
export function scopesFor(collection: Collection | null): Scope[] {
  const { environments, activeId, globals } = useEnvironments.getState()
  const env = environments.find((e) => e.id === activeId)
  return [
    ...(env ? [{ name: 'environment' as const, label: env.name, values: env.values }] : []),
    ...(collection ? [{ name: 'collection' as const, label: collection.name, values: collection.variables }] : []),
    { name: 'globals' as const, values: globals }
  ]
}

export function buildExecutionInput(tab: PersistedTab, requestId: string, name: string): ExecutionInput {
  const { environments, activeId, globals } = useEnvironments.getState()
  const env = environments.find((e) => e.id === activeId)
  const collection = tabCollection(tab)
  return {
    requestId,
    name,
    itemId: tab.source?.kind === 'collection' ? tab.source.itemId : undefined,
    draft: tab.draft,
    chain: tabChain(tab),
    variables: {
      environment: env?.values ?? [],
      environmentName: env?.name,
      globals,
      collection: collection?.variables ?? []
    },
    settings: useSettings.getState().settings.general
  }
}
