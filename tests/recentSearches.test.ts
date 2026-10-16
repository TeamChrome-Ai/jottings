import { describe, it, expect } from 'vitest'
import { dropRecent, pushRecent } from '../client/src/lib/recentSearches'

describe('recent searches', () => {
  it('keep the last three, newest first, a repeat moved to the top rather than kept twice', () => {
    let r: string[] = []
    for (const q of ['grace', 'love in the gospels', '  Grace ', 'jn 3:16', 'prophecies']) r = pushRecent(r, q)
    expect(r).toEqual(['prophecies', 'jn 3:16', 'Grace'])
    expect(pushRecent(r, '   ')).toEqual(r)
  })
  it('lose one crossed off', () => {
    expect(dropRecent(['a', 'b', 'c'], 'b')).toEqual(['a', 'c'])
  })
})
