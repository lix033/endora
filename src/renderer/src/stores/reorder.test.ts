import { describe, expect, it } from 'vitest'
import { moveBefore } from './reorder'

const list = (...ids: string[]) => ids.map((id) => ({ id }))
const ids = (items: { id: string }[]) => items.map((i) => i.id).join('')

describe('moveBefore', () => {
  it('déplace vers la gauche', () => {
    expect(ids(moveBefore(list('a', 'b', 'c', 'd'), 'c', 'a'))).toBe('cabd')
  })

  it('déplace vers la droite', () => {
    expect(ids(moveBefore(list('a', 'b', 'c', 'd'), 'a', 'd'))).toBe('bcad')
  })

  it('déplace à la fin', () => {
    expect(ids(moveBefore(list('a', 'b', 'c'), 'a', null))).toBe('bca')
  })

  it('renvoie le même tableau quand la position ne change pas', () => {
    const items = list('a', 'b', 'c')
    expect(moveBefore(items, 'a', 'b')).toBe(items)
    expect(moveBefore(items, 'b', 'b')).toBe(items)
    expect(moveBefore(items, 'c', null)).toBe(items)
  })

  it('ignore un identifiant inconnu', () => {
    const items = list('a', 'b')
    expect(moveBefore(items, 'x', 'a')).toBe(items)
    expect(moveBefore(items, 'a', 'x')).toBe(items)
  })
})
