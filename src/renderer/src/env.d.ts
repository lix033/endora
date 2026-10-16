import type { EndoraApi } from '@shared/api'

declare global {
  interface Window {
    endora: EndoraApi
  }
}

export {}
