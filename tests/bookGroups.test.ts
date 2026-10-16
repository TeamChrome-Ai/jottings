import { describe, it, expect } from 'vitest'
import { groupBooks, groupNamed, groupScope, inScopeRanges, scopeRanges, splitScope } from '../shared/bookGroups'
import { searchIndex } from '../shared/search'
import { clip, outlineLines, matchOutline, searchWords } from '../client/src/lib/outlineMatch'

describe('groups of books', () => {
  it('are named the ways readers name them', () => {
    expect(groupNamed('prophecies')?.id).toBe('prophecy')
    expect(groupNamed('The Prophets')?.id).toBe('prophets')
    expect(groupNamed('the gospels')?.id).toBe('gospels')
    expect(groupNamed("Paul's epistles")?.id).toBe('paul')
    expect(groupNamed('Paul’s letters')?.id).toBe('paul')
    expect(groupNamed('minor prophets')?.id).toBe('minor')
    expect(groupNamed('the twelve')?.id).toBe('minor')
    expect(groupNamed('grace')).toBeUndefined()
  })
  it('hold their books, prophecy with Revelation', () => {
    expect(groupBooks(groupNamed('gospels')!)).toEqual([40, 41, 42, 43])
    const prophecy = groupBooks(groupNamed('prophecies')!)
    expect([prophecy[0], prophecy.length, prophecy.at(-1)]).toEqual([23, 18, 66])
    expect(groupScope(groupNamed('prophecy')!)).toBe('23-39,66')
  })
})

describe('a search scope', () => {
  it('reads every form the server reads', () => {
    expect(scopeRanges('all')).toBeNull()
    expect(scopeRanges('OT')).toEqual([[1, 39]])
    expect(scopeRanges('43')).toEqual([[43, 43]])
    expect(scopeRanges('23-39,66')).toEqual([[23, 39], [66, 66]])
    expect(scopeRanges('40-99')).toBeNull()
    expect(scopeRanges('nonsense')).toBeNull()
    expect([inScopeRanges(66, '23-39,66'), inScopeRanges(40, '23-39,66'), inScopeRanges(5, 'all')]).toEqual([true, false, true])
  })
  it('comes from a query that ends with a group or a book', () => {
    expect(splitScope('love in the gospels')).toEqual({ query: 'love', scope: '40-43', label: 'The gospels' })
    expect(splitScope('comfort in Isaiah')).toEqual({ query: 'comfort', scope: '23', label: 'Isaiah' })
    expect(splitScope('joy in Job')?.scope).toBe('18')
    // not a group nor a book, a phrase in quotes, or a short form that is also a word
    expect(splitScope('in the beginning')).toBeNull()
    expect(splitScope('faith in Christ')).toBeNull()
    expect(splitScope('"rest in the Lord"')).toBeNull()
    expect(splitScope('what he is in he')).toBeNull()
  })
  it('narrows the device’s own search', () => {
    const rows = [{ book: 23, chapter: 1, verse: 1, text: 'Comfort ye my people' }, { book: 43, chapter: 14, verse: 1, text: 'Let not your heart be troubled; comfort' }]
    expect(searchIndex).toBeTypeOf('function')
    expect(rows.filter(r => inScopeRanges(r.book, splitScope('comfort in the prophets')!.scope)).map(r => r.book)).toEqual([23])
  })
})

describe('the reader’s own jottings', () => {
  const o = { id: 7, title: 'Love', description: null, updated_at: '2026-10-14', items: [
    { id: 1, outline_id: 7, position: 0, kind: 'verse' as const, book: 43, chapter: 3, v1: 16, depth: 0 },
    { id: 2, outline_id: 7, position: 1, kind: 'note' as const, text: 'God so loved the world that he gave', depth: 0 },
  ] }
  it('are matched on every word, in title, notes and passages by book', () => {
    expect(outlineLines(o)).toEqual(['Love', '', 'John 3:16', 'God so loved the world that he gave'])
    expect(matchOutline(o, searchWords('Loved WORLD'))?.snippet).toBe('God so loved the world that he gave')
    expect(matchOutline(o, searchWords('john'))?.snippet).toBe('John 3:16')
    expect(matchOutline(o, searchWords('loved heaven'))).toBeNull()
  })
  it('show a short piece of the line around the word', () => {
    const long = 'a '.repeat(80) + 'grace ' + 'b '.repeat(80)
    const s = clip(long, 'grace')
    expect(s.startsWith('…') && s.endsWith('…') && s.includes('grace')).toBe(true)
    expect([...s].length).toBeLessThanOrEqual(122)
  })
})
