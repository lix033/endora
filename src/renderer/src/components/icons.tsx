// Icônes de l'interface : tracés simples, couleur héritée du texte (`currentColor`).

import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

export const GearIcon = () => (
  <Icon>
    <path d="M18.77 9.56 L21.39 10.02 L21.39 13.98 L18.77 14.44 L18.51 15.07 L20.04 17.25 L17.25 20.04 L15.07 18.51 L14.44 18.77 L13.98 21.39 L10.02 21.39 L9.56 18.77 L8.93 18.51 L6.75 20.04 L3.96 17.25 L5.49 15.07 L5.23 14.44 L2.61 13.98 L2.61 10.02 L5.23 9.56 L5.49 8.93 L3.96 6.75 L6.75 3.96 L8.93 5.49 L9.56 5.23 L10.02 2.61 L13.98 2.61 L14.44 5.23 L15.07 5.49 L17.25 3.96 L20.04 6.75 L18.51 8.93 Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)

export const BellIcon = () => (
  <Icon>
    <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9" />
    <path d="M10 19a2 2 0 0 0 4 0" />
  </Icon>
)

export const ServicesIcon = () => (
  <Icon>
    <rect x="3" y="4" width="18" height="6" rx="1.5" />
    <rect x="3" y="14" width="18" height="6" rx="1.5" />
    <path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" />
  </Icon>
)

export const WorkspaceIcon = () => (
  <Icon>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </Icon>
)
