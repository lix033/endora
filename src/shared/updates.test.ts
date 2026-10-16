import { describe, expect, it } from 'vitest'
import { plainNotes, updateSize } from './updates'

describe('updateSize', () => {
  it('correctif seul : petite mise à jour', () => {
    expect(updateSize('0.2.2', '0.2.3')).toBe('small')
    expect(updateSize('1.4.0', 'v1.4.12')).toBe('small')
  })

  it('version mineure ou majeure : grosse mise à jour', () => {
    expect(updateSize('0.2.9', '0.3.0')).toBe('major')
    expect(updateSize('1.9.9', '2.0.0')).toBe('major')
  })

  it('pré-version : grosse mise à jour', () => {
    expect(updateSize('0.2.2', '0.2.3-beta.1')).toBe('major')
  })
})

describe('plainNotes', () => {
  it('convertit le HTML du flux GitHub en texte', () => {
    expect(plainNotes('<h3>Fixed</h3><ul><li>Bug &amp; crash</li></ul>')).toBe('Fixed\n- Bug & crash')
  })

  it('un retour à la ligne doublé par <br> n’en donne qu’un', () => {
    expect(plainNotes('<p>Ligne 1<br>\nLigne 2</p>')).toBe('Ligne 1\nLigne 2')
  })

  it('accepte une liste de notes et ignore le vide', () => {
    expect(plainNotes([{ version: '1', note: 'A' }, { version: '2', note: 'B' }])).toBe('A\n\nB')
    expect(plainNotes(null)).toBeUndefined()
  })
})
