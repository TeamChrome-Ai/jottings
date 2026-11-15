// The desktop book pane's chapter cells: the number printed on each, and the English chapter and verse it opens.
import { afterEach, describe, expect, it } from 'vitest'
import { bookPaneChapters } from '../client/src/lib/bookPaneChapters'
import { setShownText, setVerseMap, type VerseMap } from '../shared/texts'

const FR: VerseMap = {
  '19.51': [[1, 19, 51, 3]],
  '29.2': [[28, 5, 3, 1]],
  '29.3': [[1, 21, 4, 1]],
  '39.4': [[1, 6, 3, 19]],
}

afterEach(() => { setShownText('en') })

describe('the book pane’s chapters', () => {
  it('lists French Joel by the chapters it prints, and opens each where that chapter begins', () => {
    // printed 3 begins at English 2:28; English 3 is printed 4
    setVerseMap('fr', FR)
    setShownText('fr')
    expect(bookPaneChapters(29)).toEqual([
      { label: '1', chapter: 1 },
      { label: '2', chapter: 2 },
      { label: '3', chapter: 2, verse: 28 },
      { label: '4', chapter: 3 },
    ])
  })
  it('lists an English book as its own chapters, from verse 1', () => {
    const cells = bookPaneChapters(1)
    expect(cells.map(c => c.label)).toEqual(Array.from({ length: 50 }, (_, i) => String(i + 1)))
    expect(cells.every(c => c.chapter === Number(c.label) && c.verse === undefined)).toBe(true)
  })
})
