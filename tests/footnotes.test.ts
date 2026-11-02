import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { buildFootnoteIndex, footnoteKeys, footnotesOn, footnoteWord, noteAt, wordKey, type FootnoteIndex, type FootnoteIndexFile, type FootnotePlace } from '../shared/footnotes'
import type { Chapter } from '../shared/types'
import { HAS_TEXTS } from './_texts'

const at = (p: FootnotePlace) => `${p.book} ${p.chapter}:${p.verse}`
const places = (ix: FootnoteIndex, word: string, scope?: string) => footnotesOn(ix, word, scope)?.groups.flatMap(g => g.places.map(at)) ?? null

const CHILIARCH = ['41 6:21', '43 18:12', '44 21:31']
const ix = buildFootnoteIndex({
  chiliarch: [[43, 18, 12, 0, 2], [44, 21, 31, 0, 3]],
  chiliarchs: [[41, 6, 21, 1, 1]],
  man: [[1, 2, 7, 0, 4]],
  men: [[1, 6, 4, 1, 5]],
  gods: [[2, 20, 3, 0, 6]],
  sons: [[1, 6, 2, 0, 7]],
  'Nazaræan': [[40, 2, 23, 0, 8]],
  an: [[40, 2, 23, 0, 8]],
  'Beer-sheba': [[1, 21, 31, 0, 9]],
  sheba: [[1, 21, 31, 0, 9]],
  'Lord’s': [[19, 24, 1, 0, 10]],
  ass: [[4, 22, 23, 0, 11]],
})

describe('the fold', () => {
  it('chiliarch, chiliarchs and Chiliarch each find the same three notes, in Bible order', () => {
    for (const w of ['chiliarch', 'chiliarchs', 'Chiliarch', 'CHILIARCHS']) expect(places(ix, w), w).toEqual(CHILIARCH)
  })
  it('meets singular and plural, regular and irregular, either way', () => {
    expect(places(ix, 'man')).toEqual(['1 2:7', '1 6:4'])
    expect(places(ix, 'men')).toEqual(['1 2:7', '1 6:4'])
    expect(places(ix, 'god')).toEqual(['2 20:3'])
    expect(places(ix, 'son')).toEqual(['1 6:2'])
  })
  it('spells ligatures out, joins hyphenated names and takes the possessive off', () => {
    expect(places(ix, 'Nazaraean')).toEqual(['40 2:23'])
    expect(places(ix, 'Nazaræan')).toEqual(['40 2:23'])
    expect(places(ix, 'beersheba')).toEqual(['1 21:31'])
    expect(places(ix, 'Beer-sheba')).toEqual(['1 21:31'])
    expect(places(ix, 'lord')).toEqual(['19 24:1'])
    expect([wordKey('Nazaræan'), wordKey('Beer-sheba'), wordKey('Lord’s')]).toEqual(['nazaraean', 'beersheba', 'lord'])
  })
  it('never takes a letter off: "as" never finds "ass"', () => {
    expect(places(ix, 'as')).toBeNull()
    expect(footnoteKeys('ass')).not.toContain('as')
    expect(footnoteKeys('has')).not.toContain('ha')
  })
  it('a word’s own key comes first', () => {
    for (const w of ['chiliarchs', 'Men', 'god', 'Nazaræan', 'Beer-sheba', 'Lord’s', 'witnesses', 'cities']) expect(footnoteKeys(w)[0], w).toBe(wordKey(w))
  })
})

describe('footnoteWord', () => {
  it('is one word of letters that can be looked up, quotes off', () => {
    for (const q of ['of', 'the', 'chiliarch tribune', 'G5506', '1000', '', '  ']) expect(footnoteWord(q), q).toBeNull()
    expect(['chiliarch', '"chiliarch"', '“chiliarch”', ' Beer-sheba ', 'Lord’s', 'Nazaræan'].map(footnoteWord)).toEqual(['chiliarch', 'chiliarch', 'chiliarch', 'Beer-sheba', 'Lord’s', 'Nazaræan'])
  })
})

describe('footnotesOn', () => {
  it('lists a note under two words once', () => {
    const two = buildFootnoteIndex({ 'Nazaræan': [[40, 2, 23, 0, 0]], Nazaraean: [[40, 2, 23, 0, 0]] })
    expect(footnotesOn(two, 'Nazaraean')).toEqual({ notes: 1, groups: [{ places: [{ book: 40, chapter: 2, verse: 23, note: 0 }] }] })
  })
  it('groups notes of one text, the most places first, then by the first place', () => {
    const many = buildFootnoteIndex({ man: [[1, 2, 7, 0, 20], [19, 8, 4, 0, 21], [18, 4, 17, 0, 21]], men: [[1, 1, 26, 1, 22], [18, 7, 1, 0, 21]] })
    const f = footnotesOn(many, 'man')
    expect(f?.notes).toBe(5)
    expect(f?.groups.map(g => g.places.map(at))).toEqual([['18 4:17', '18 7:1', '19 8:4'], ['1 1:26'], ['1 2:7']])
  })
  it('follows the search’s scope', () => {
    expect(places(ix, 'chiliarch', 'OT')).toBeNull()
    expect(places(ix, 'chiliarch', 'NT')).toEqual(CHILIARCH)
    expect(places(ix, 'chiliarch', '44')).toEqual(['44 21:31'])
    expect(footnotesOn(ix, 'chiliarch', 'NT')?.notes).toBe(3)
  })
  it('finds nothing for a word with no footnote', () => {
    expect(footnotesOn(ix, 'tribune')).toBeNull()
  })
})

describe('noteAt', () => {
  const chapter: Pick<Chapter, 'verses'> = { verses: [
    { v: 21, t: '', notes: [{ id: 1, marker: 'c', text: 'The meaning is doubtful.' }, { id: 2, marker: 'd', text: 'Commanders of 1,000 men.' }] },
    { v: 22, t: '', notes: [{ id: 3, marker: '·', text: 'El' }] },
  ] }
  it('reads the lettered note a place names, and nothing else', () => {
    expect(noteAt(chapter, { book: 41, chapter: 6, verse: 21, note: 1 })).toBe('Commanders of 1,000 men.')
    expect(noteAt(chapter, { book: 41, chapter: 6, verse: 22, note: 0 })).toBeNull()
    expect(noteAt(chapter, { book: 41, chapter: 6, verse: 21, note: 2 })).toBeNull()
    expect(noteAt(chapter, { book: 41, chapter: 6, verse: 23, note: 0 })).toBeNull()
  })
})

describe.skipIf(!HAS_TEXTS)('the shipped index (client/public/bible)', () => {
  let file: FootnoteIndexFile
  let chapters: Map<string, Chapter>
  beforeAll(() => {
    const read = (p: string) => JSON.parse(readFileSync(path.resolve(__dirname, '../client/public/bible', p), 'utf8')) as unknown
    file = read('footnotes.json') as FootnoteIndexFile
    const all = read('all.json') as { chapters: (Chapter & { book: number })[] }
    chapters = new Map(all.chapters.map(c => [`${c.book}.${c.c}`, c]))
  })
  const text = (p: FootnotePlace) => { const c = chapters.get(`${p.book}.${p.chapter}`); return c ? noteAt(c, p) : null }
  it('lists the three footnotes on chiliarch and chiliarchs, with their texts', () => {
    const index = buildFootnoteIndex(file)
    for (const w of ['chiliarch', 'chiliarchs']) {
      expect(footnotesOn(index, w)?.groups.flatMap(g => g.places.map(p => [at(p), text(p)])), w).toEqual([
        ['41 6:21', 'Commanders of 1,000 men.'],
        ['43 18:12', 'Strictly, \'the commander of a thousand men\' (a military tribune).'],
        ['44 21:31', 'Commander of 1,000 men.'],
      ])
    }
  })
  it('names a lettered note of the chapter files with every entry', () => {
    const entries = Object.values(file).flat()
    expect(entries.length).toBeGreaterThan(9000)
    const bad = entries.filter(([book, chapter, verse, note]) => text({ book, chapter, verse, note }) === null)
    expect(bad).toEqual([])
  })
})
