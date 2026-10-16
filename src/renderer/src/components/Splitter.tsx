// Séparateur déplaçable entre deux zones (barre latérale, requête/réponse, panneau de code).
// Souris : glisser ; double clic : taille par défaut. Clavier : flèches (pas de 16 px).

import { useRef } from 'react'

interface SplitterProps {
  /** `x` : séparateur vertical qu'on déplace horizontalement ; `y` : l'inverse. */
  axis: 'x' | 'y'
  /** Position du pointeur (clientX ou clientY) : le parent en déduit la nouvelle taille. */
  onDrag: (position: number) => void
  onReset: () => void
  label: string
  className?: string
}

export function Splitter({ axis, onDrag, onReset, label, className = '' }: SplitterProps) {
  const ref = useRef<HTMLDivElement>(null)
  const center = () => {
    const r = ref.current!.getBoundingClientRect()
    return axis === 'x' ? r.left + r.width / 2 : r.top + r.height / 2
  }
  return (
    <div
      ref={ref}
      className={`splitter ${axis} ${className}`}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={label}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        const el = e.currentTarget
        el.setPointerCapture(e.pointerId)
        document.body.classList.add(`resizing-${axis}`)
        const move = (ev: PointerEvent) => onDrag(axis === 'x' ? ev.clientX : ev.clientY)
        const end = () => {
          el.removeEventListener('pointermove', move)
          el.removeEventListener('pointerup', end)
          el.removeEventListener('pointercancel', end)
          document.body.classList.remove(`resizing-${axis}`)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', end)
        el.addEventListener('pointercancel', end)
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = { ArrowLeft: -16, ArrowUp: -16, ArrowRight: 16, ArrowDown: 16 }[e.key]
        if (step === undefined) return
        e.preventDefault()
        onDrag(center() + step)
      }}
    />
  )
}

/** Ref : la molette verticale fait défiler horizontalement une barre d'onglets qui déborde. */
export function horizontalWheel(el: HTMLElement | null): (() => void) | undefined {
  if (!el) return undefined
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return
    el.scrollLeft += e.deltaY
    e.preventDefault()
  }
  el.addEventListener('wheel', onWheel, { passive: false })
  return () => el.removeEventListener('wheel', onWheel)
}
