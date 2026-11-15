// Native verse positions (ChapterView's reportRun, numbers off): the offset of each verse in the paragraph's
// laid-out text. A zero-size marker never reports on Android, so the position is this search.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Verse } from '../shared/types'
import { nativeVerseAts } from '../client/src/lib/nativeVerseAt'

const mark9 = JSON.parse(readFileSync(resolve(__dirname, '../client/public/bible/41/9.json'), 'utf8')) as { verses: Verse[] }
const going = mark9.verses.filter(v => v.v >= 30 && v.v <= 32)
const at = (hits: { v: number; at: number }[], v: number) => hits.find(h => h.v === v)!.at

describe('native verse positions', () => {
  it('finds each verse in its own words when numbers are off and the verses share a paragraph', () => {
    // Mark 9:30-32 is one paragraph; 9:31 begins "for" and 9:30 has "forth"
    const joined = going.map(v => v.t + ' ').join('')
    const hits = nativeVerseAts(joined, going, { showNumbers: false })
    expect(joined.slice(at(hits, 30), at(hits, 30) + 3)).toBe('And')
    expect(at(hits, 31)).toBe(going[0].t.length + 1)
    expect(joined.slice(at(hits, 31), at(hits, 31) + 3)).toBe('for')
    expect(at(hits, 32)).toBe(going[0].t.length + 1 + going[1].t.length + 1)
    expect(joined.slice(at(hits, 32), at(hits, 32) + 3)).toBe('But')
  })
  it('does not take a later verse’s first word from an earlier verse that uses that word', () => {
    const verses: Verse[] = [{ v: 1, t: 'He went for a walk' }, { v: 2, t: 'for the day was long' }]
    const joined = verses.map(v => v.t + ' ').join('')
    expect(at(nativeVerseAts(joined, verses, { showNumbers: false }), 2)).toBe(verses[0].t.length + 1)
  })
  it('does not take a verse number from a digit in the verse before it', () => {
    const verses: Verse[] = [{ v: 1, t: 'There were 2 of them' }, { v: 2, t: 'And he said' }]
    const joined = verses.map(v => `${v.v} ${v.t} `).join('')
    const hit = at(nativeVerseAts(joined, verses, { showNumbers: true }), 2)
    expect(hit).toBe(`1 ${verses[0].t} `.length)
    expect(joined[hit]).toBe('2')
  })
  it('finds a bookmarked verse by its number, after the verse before it', () => {
    const verses: Verse[] = [{ v: 1, t: 'There were 2 of them' }, { v: 2, t: 'And he said' }]
    const joined = `1 ${verses[0].t} 2▮ ${verses[1].t} `
    const hit = at(nativeVerseAts(joined, verses, { showNumbers: true }), 2)
    expect(hit).toBe(`1 ${verses[0].t} `.length)
    expect(joined.slice(hit, hit + 2)).toBe('2▮')
  })
  it('finds the next verse after a note letter on a word the next verse also begins with', () => {
    // a lettered note sits on the word before the one it precedes: "went" + joiner + "a"
    const verses: Verse[] = [
      { v: 1, t: 'He went for them', notes: [{ id: 1, marker: 'a', pos: 2, text: '' }] },
      { v: 2, t: 'for they asked' },
    ]
    const joined = 'He went\u2060a for them for they asked '
    const hit = at(nativeVerseAts(joined, verses, { showNumbers: false }), 2)
    expect(hit).toBe('He went\u2060a for them '.length)
    expect(joined.slice(hit, hit + 3)).toBe('for')
  })
  it('keeps a verse number that follows another number', () => {
    const verses: Verse[] = [{ v: 1, t: 'In the beginning' }, { v: 10, t: 'And the earth' }, { v: 21, t: 'And God said' }]
    const joined = verses.map(v => `${v.v} ${v.t} `).join('')
    const hits = nativeVerseAts(joined, verses, { showNumbers: true })
    expect(joined.slice(at(hits, 10), at(hits, 10) + 2)).toBe('10')
    expect(joined.slice(at(hits, 21), at(hits, 21) + 2)).toBe('21')
  })
})
