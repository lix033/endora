// Apparence des éditeurs CodeMirror : couleurs tirées des variables CSS du thème actif, pour
// que tous les éditeurs suivent le changement de thème sans être recréés.

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { Decoration, EditorView, MatchDecorator, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--bg)', height: '100%', fontSize: '12.5px' },
  '.cm-content': { caretColor: 'var(--accent)', fontFamily: 'ui-monospace, Menlo, monospace' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--bg-3) 45%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-3)', border: 'none', color: 'var(--muted)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-2)', border: '1px solid var(--border)', color: 'var(--text)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--selection)', color: 'var(--text)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--warn) 30%, transparent)' },
  '.cm-panels': { backgroundColor: 'var(--bg-2)', color: 'var(--text)' },
  '.cm-var': { color: 'var(--var)', fontWeight: '600' }
})

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.propertyName, t.attributeName, t.tagName], color: 'var(--syn-property)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--accent)' },
  { tag: [t.definition(t.variableName), t.typeName, t.className], color: 'var(--info)' },
  { tag: [t.punctuation, t.bracket, t.separator], color: 'var(--muted)' },
  { tag: t.invalid, color: 'var(--fail)' }
])

const varMatcher = new MatchDecorator({ regexp: /\{\{[^{}]+?\}\}/g, decoration: Decoration.mark({ class: 'cm-var' }) })

/** Met en évidence les `{{variables}}` dans un éditeur. */
export const variableHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = varMatcher.createDeco(view)
    }
    update(u: ViewUpdate) {
      this.decorations = varMatcher.updateDeco(u, this.decorations)
    }
  },
  { decorations: (v) => v.decorations }
)

export const editorTheme = [theme, syntaxHighlighting(highlight)]
