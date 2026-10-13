import { describe, expect, it } from 'vitest'
import { isLettered, letterAt, relabel } from '../client/src/lib/noteLetters'

const n = (id: number, marker: string, text: string) => ({ id, marker, text })

describe('footnote letters', () => {
  it('counts a–z then aa, ab', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(letterAt)).toEqual(['a', 'b', 'z', 'aa', 'ab', 'az', 'ba'])
    expect(isLettered({ marker: 'aa' })).toBe(true)
    expect(isLettered({ marker: '·' })).toBe(false)
  })
  it('letters a chapter once through, the printed restart gone, a repeated note keeping its letter', () => {
    // Leviticus 1 as printed: a (Corban, at two words of verse 2 and one of verse 3), b, c … i, then a new page: a, b …
    const verses = [
      { v: 2, notes: [n(714, 'a', 'Corban'), n(715, 'a', 'Corban')] },
      { v: 3, notes: [n(716, 'a', 'Corban'), n(717, 'b', 'four offerings'), n(718, 'c', 'Perfect')] },
      { v: 8, notes: [n(724, 'h', 'fat'), n(1, '·', 'El')] },
      { v: 9, notes: [n(725, 'i', 'burn'), n(726, 'a', 'odour')] },
      { v: 10, notes: [n(727, 'b', 'Corban, see ver. 2')] },
      { v: 11 },
    ]
    const out = relabel(verses, 'chapter')
    expect(out.map(v => (v.notes ?? []).map(x => x.marker).join(''))).toEqual(['aa', 'abc', 'd·', 'ef', 'g', ''])
    expect(out[5]).toBe(verses[5])
    expect(out[2].notes![1]).toBe(verses[2].notes![1])
  })
  it('leaves the printed letters alone, and a chapter already in order untouched', () => {
    const verses = [{ v: 1, notes: [n(1, 'a', 'x'), n(2, 'b', 'y')] }]
    expect(relabel(verses, 'printed')).toBe(verses)
    expect(relabel(verses, 'chapter')).toBe(verses)
  })
})
