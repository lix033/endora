// « Beautify » dans l'interface : met en forme un éditeur CodeMirror avec Prettier. Chaque éditeur
// qui le permet déclare son langage ; le bouton et le raccourci (`mod+b`) agissent sur l'éditeur qui
// a le focus, sinon sur le body brut de la requête active.

import { Facet } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { formatCode, type FormatLanguage } from '@shared/format'
import { t } from '@shared/i18n'
import { toast } from './stores/ui'

/** Langage de mise en forme d'un éditeur ; absent : l'éditeur ne se met pas en forme. */
export const formatLanguage = Facet.define<FormatLanguage, FormatLanguage | null>({
  combine: (values) => values[values.length - 1] ?? null
})

/** Met en forme le code d'un éditeur ; la modification s'annule avec ⌘Z comme une saisie. */
export async function beautifyView(view: EditorView): Promise<void> {
  const language = view.state.facet(formatLanguage)
  if (!language) return
  const code = view.state.doc.toString()
  const r = await formatCode(code, language)
  if (!r.ok) {
    toast(t('format.failed', { message: r.message }), 'error')
    return
  }
  // Éditeur fermé ou modifié pendant la mise en forme : rien à appliquer.
  if (r.code === code || view.state.doc.toString() !== code || !view.dom.isConnected) return
  const head = Math.min(view.state.selection.main.head, r.code.length)
  view.dispatch({ changes: { from: 0, to: code.length, insert: r.code }, selection: { anchor: head }, userEvent: 'input.format' })
}

/** Met en forme un texte hors éditeur (ex. le body d'une requête dont l'éditeur n'est pas affiché). */
export async function beautifyText(code: string, language: FormatLanguage): Promise<string | null> {
  const r = await formatCode(code, language)
  if (r.ok) return r.code
  toast(t('format.failed', { message: r.message }), 'error')
  return null
}

/** Éditeur CodeMirror qui a le focus, s'il se met en forme. */
export function focusedFormattableEditor(): EditorView | null {
  const el = document.activeElement instanceof HTMLElement ? document.activeElement.closest('.cm-editor') : null
  const view = el instanceof HTMLElement ? EditorView.findFromDOM(el) : null
  return view && view.state.facet(formatLanguage) ? view : null
}
