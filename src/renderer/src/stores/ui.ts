// Dialogues modaux (avec API à promesse) et notifications éphémères.

import { create } from 'zustand'
import { newId } from '@shared/model'

export interface SaveTarget {
  collectionId: string
  parentId: string | null
  name: string
}

export interface ConfirmButton {
  label: string
  value: string
  variant?: 'primary' | 'danger'
}

export type Dialog =
  | { kind: 'confirm'; title: string; message: string; buttons: ConfirmButton[]; resolve: (value: string) => void }
  | { kind: 'save'; title: string; defaultName: string; resolve: (target: SaveTarget | null) => void }
  | { kind: 'import'; initialText?: string }

export interface Toast {
  id: string
  message: string
  tone: 'info' | 'error'
}

interface UiState {
  dialog: Dialog | null
  toasts: Toast[]
  openDialog: (d: Dialog) => void
  closeDialog: () => void
  toast: (message: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
}

export const useUi = create<UiState>((set, get) => ({
  dialog: null,
  toasts: [],
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  toast: (message, tone = 'info') => {
    const id = newId()
    set({ toasts: [...get().toasts, { id, message, tone }] })
    setTimeout(() => get().dismissToast(id), tone === 'error' ? 6000 : 2500)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

/** Une seule boîte de dialogue à la fois : une demande en cours est annulée par la suivante. */
function cancelCurrent(): void {
  const current = useUi.getState().dialog
  if (current?.kind === 'confirm') current.resolve('cancel')
  if (current?.kind === 'save') current.resolve(null)
}

export function confirmDialog(title: string, message: string, buttons: ConfirmButton[]): Promise<string> {
  cancelCurrent()
  return new Promise((resolve) => {
    useUi.getState().openDialog({
      kind: 'confirm',
      title,
      message,
      buttons,
      resolve: (value) => {
        useUi.getState().closeDialog()
        resolve(value)
      }
    })
  })
}

export function saveDialog(defaultName: string, title = 'Enregistrer la requête'): Promise<SaveTarget | null> {
  cancelCurrent()
  return new Promise((resolve) => {
    useUi.getState().openDialog({
      kind: 'save',
      title,
      defaultName,
      resolve: (target) => {
        useUi.getState().closeDialog()
        resolve(target)
      }
    })
  })
}

export function openImportDialog(initialText?: string): void {
  cancelCurrent()
  useUi.getState().openDialog({ kind: 'import', initialText })
}

export const toast = (message: string, tone?: Toast['tone']): void => useUi.getState().toast(message, tone)
