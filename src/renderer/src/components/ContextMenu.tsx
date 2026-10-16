import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'

export interface MenuEntry {
  label: string
  onSelect: () => void
  danger?: boolean
  disabled?: boolean
}

interface MenuState {
  menu: { x: number; y: number; entries: Array<MenuEntry | 'separator'> } | null
  show: (x: number, y: number, entries: Array<MenuEntry | 'separator'>) => void
  hide: () => void
}

export const useContextMenu = create<MenuState>((set) => ({
  menu: null,
  show: (x, y, entries) => set({ menu: { x, y, entries } }),
  hide: () => set({ menu: null })
}))

/** Ouvre un menu à la position d'un clic droit ou sous un bouton « ⋯ ». */
export function openMenu(e: { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }, entries: Array<MenuEntry | 'separator'>): void {
  e.preventDefault()
  e.stopPropagation()
  useContextMenu.getState().show(e.clientX, e.clientY, entries)
}

export function ContextMenuHost() {
  const { menu, hide } = useContextMenu()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  // Garde le menu dans la fenêtre.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 4), y: Math.min(menu.y, window.innerHeight - r.height - 4) })
  }, [menu])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) hide()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', hide)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', hide)
    }
  }, [menu, hide])

  if (!menu) return null
  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }} role="menu">
      {menu.entries.map((entry, i) =>
        entry === 'separator' ? (
          <div key={i} className="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={entry.danger ? 'danger-text' : ''}
            disabled={entry.disabled}
            onClick={() => {
              hide()
              entry.onSelect()
            }}
          >
            {entry.label}
          </button>
        )
      )}
    </div>
  )
}
