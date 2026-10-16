// Éditeur CodeMirror qui se souvient de sa position d'un affichage à l'autre de l'onglet : curseur,
// sélection, défilement et, pour un éditeur modifiable, historique d'annulation.

import { useLayoutEffect, useRef } from 'react'
import CodeMirror, { type ReactCodeMirrorProps } from '@uiw/react-codemirror'
import { historyField } from '@codemirror/commands'
import type { StateEffect } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { editorStates } from '../stores/tabui'

interface Saved {
  /** État complet (éditeur modifiable) : document, sélection et historique. */
  json?: unknown
  anchor: number
  head: number
  scroll: StateEffect<unknown>
}

type Props = ReactCodeMirrorProps & {
  /** Clé de mémoire (voir `memoryKey`) ; sans clé, l'éditeur ne mémorise rien. */
  memory?: string
}

/** Recréé à chaque changement de clé : l'état mémorisé ne s'applique qu'à la création. */
export function CodeEditor(props: Props) {
  return <RememberingEditor key={props.memory ?? ''} {...props} />
}

function RememberingEditor({ memory, onCreateEditor, ...props }: Props) {
  const view = useRef<EditorView | null>(null)
  const saved = memory ? (editorStates.get(memory) as Saved | undefined) : undefined
  const editable = props.editable !== false

  // Effet de mise en page : nettoyé avant le retrait du DOM, quand le défilement est encore lisible.
  useLayoutEffect(
    () => () => {
      const v = view.current
      if (!memory || !v) return
      const { anchor, head } = v.state.selection.main
      editorStates.set(memory, {
        ...(editable ? { json: v.state.toJSON({ history: historyField }) } : {}),
        anchor,
        head,
        scroll: v.scrollSnapshot()
      } satisfies Saved)
    },
    [memory, editable]
  )

  return (
    <CodeMirror
      {...props}
      initialState={saved?.json ? { json: saved.json, fields: { history: historyField } } : undefined}
      onCreateEditor={(v, state) => {
        view.current = v
        if (saved) {
          const length = v.state.doc.length
          v.dispatch({
            ...(saved.json ? {} : { selection: { anchor: Math.min(saved.anchor, length), head: Math.min(saved.head, length) } }),
            effects: saved.scroll
          })
        }
        onCreateEditor?.(v, state)
      }}
    />
  )
}
