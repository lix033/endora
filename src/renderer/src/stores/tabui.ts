// Mémoire d'affichage de chaque onglet : sous-onglet actif (Body, Pretty, Post-response…), filtres,
// position des zones défilantes et des éditeurs. Revenir sur un onglet le retrouve tel qu'on l'a
// quitté. En mémoire seulement ; oubliée à la fermeture de l'onglet.

import { useCallback } from 'react'
import { create } from 'zustand'
import { useTabs } from './tabs'

const SEP = '\u0000'
const keyOf = (tabId: string, key: string) => `${tabId}${SEP}${key}`

const useTabUi = create<{ values: Record<string, unknown> }>(() => ({ values: {} }))

/** Positions de défilement et états d'éditeurs : lus au montage, sans provoquer de rendu. */
const scrolls = new Map<string, { top: number; left: number }>()
export const editorStates = new Map<string, unknown>()

/** Valeur d'affichage propre à un onglet, comme un `useState` qui survit au changement d'onglet. */
export function useTabState<T>(tabId: string, key: string, initial: T): [T, (value: T) => void] {
  const k = keyOf(tabId, key)
  const value = useTabUi((s) => (k in s.values ? (s.values[k] as T) : initial))
  const set = useCallback((v: T) => useTabUi.setState((s) => ({ values: { ...s.values, [k]: v } })), [k])
  return [value, set]
}

/** Clé de mémoire d'un éditeur ou d'une zone de l'onglet. */
export const memoryKey = keyOf

/** Ref à poser sur une zone défilante : sa position est restaurée au montage et suivie ensuite. */
export function useScrollMemory<T extends HTMLElement>(tabId: string, key: string) {
  const k = keyOf(tabId, key)
  return useCallback(
    (el: T | null) => {
      if (!el) return
      const saved = scrolls.get(k)
      if (saved) {
        el.scrollTop = saved.top
        el.scrollLeft = saved.left
      }
      const onScroll = () => scrolls.set(k, { top: el.scrollTop, left: el.scrollLeft })
      el.addEventListener('scroll', onScroll, { passive: true })
      return () => el.removeEventListener('scroll', onScroll)
    },
    [k]
  )
}

let nextVersion = 1
const versions = new WeakMap<object, number>()

/** Identifiant stable d'un objet (ex. une réponse), à inclure dans une clé de mémoire liée à son contenu. */
export function objectVersion(obj: object): string {
  let id = versions.get(obj)
  if (!id) versions.set(obj, (id = nextVersion++))
  return `v${id}`
}

// Un onglet fermé libère sa mémoire.
useTabs.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return
  const open = new Set(s.tabs.map((t) => t.id))
  const closed = (k: string) => !open.has(k.slice(0, k.indexOf(SEP)))
  const values = useTabUi.getState().values
  const stale = Object.keys(values).filter(closed)
  if (stale.length) useTabUi.setState({ values: Object.fromEntries(Object.entries(values).filter(([k]) => !closed(k))) })
  for (const map of [scrolls, editorStates]) for (const k of map.keys()) if (closed(k)) map.delete(k)
})
