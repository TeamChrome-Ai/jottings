// Native verse positions (ChapterView's reportRun, numbers off): the offset of each verse in the paragraph's
// laid-out text. A zero-size marker never reports on Android, so the position is this search.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isLettered } from '../shared/footnotes'
import { WORD_RE_EN } from '../shared/texts'
import type { Verse } from '../shared/types'
import { nativeVerseAts } from '../client/src/lib/nativeVerseAt'
import { HAS_TEXTS } from './_texts'

/** A chapter as the app ships it; no verses in a copy without the texts, where the tests of them are skipped. */
const chapter = (book: number, c: number): { verses: Verse[] } =>
  HAS_TEXTS ? JSON.parse(readFileSync(resolve(__dirname, `../client/public/bible/${book}/${c}.json`), 'utf8')) : { verses: [] }
const mark9 = chapter(41, 9)
const going = mark9.verses.filter(v => v.v >= 30 && v.v <= 32)
const at = (hits: { v: number; at: number }[], v: number) => hits.find(h => h.v === v)!.at

describe('native verse positions', () => {
  it.skipIf(!HAS_TEXTS)('finds each verse in its own words when numbers are off and the verses share a paragraph', () => {
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

// A lettered note at word 0 is drawn before the first word. The other markers are joined to their word with U+2060;
// 1.3.11 left this one bare, so "a" + "if" is the word "aif" and the search takes a later "if".
const deut30 = chapter(5, 30)
const jer39 = chapter(24, 39)
const deutRun = deut30.verses.filter(v => v.v >= 9 && v.v <= 11)
const jerRun = (() => {
  const out: Verse[] = []
  for (const v of jer39.verses) {
    if (out.length && (v.p || v.hd)) break
    out.push(v)
  }
  return out
})()

/** One verse as VerseSpan draws it with numbers off: lettered notes after the word they explain, symbols in front,
 *  each of those joined by U+2060, then the verse's trailing space. `leadJoiner` is that joiner on an opening letter. */
function drawVerse(v: Verse, leadJoiner: boolean): string {
  const toks: { tok: string; wi: number; word: boolean }[] = []
  let wi = 0
  for (const m of v.t.matchAll(new RegExp(WORD_RE_EN.source, WORD_RE_EN.flags))) {
    if (m[1]) toks.push({ tok: m[1], wi: wi++, word: true })
    else toks.push({ tok: m[2], wi: -1, word: false })
  }
  const at = new Map<number, { marker: string; letter: boolean }[]>()
  for (const n of v.notes ?? []) {
    const k = Math.min(n.pos ?? wi, wi)
    const list = at.get(k) ?? []
    list.push({ marker: n.marker, letter: isLettered(n) })
    at.set(k, list)
  }
  const marks = (k: number, letter: boolean) => (at.get(k) ?? []).filter(n => n.letter === letter).map(n => n.marker).join('')
  let s = ''
  const lead = marks(0, true)
  if (lead) s += lead + (leadJoiner ? '\u2060' : '')
  for (const t of toks) {
    if (!t.word) { s += t.tok; continue }
    const pre = marks(t.wi, false), post = marks(t.wi + 1, true)
    if (pre) s += pre + '\u2060'
    s += t.tok
    if (post) s += '\u2060' + post
  }
  const tail = marks(wi, false)
  if (tail) s += tail
  return s + ' '
}

/** Where each verse's own first word sits in the paragraph, and where the search lands. */
function placed(verses: readonly Verse[], leadJoiner: boolean): { got: (number | undefined)[]; want: number[] } {
  const parts = verses.map(v => drawVerse(v, leadJoiner))
  const joined = parts.join('')
  const hits = nativeVerseAts(joined, verses, { showNumbers: false })
  let cursor = 0
  const want: number[] = []
  for (let i = 0; i < verses.length; i++) {
    const lead = (verses[i].notes ?? []).filter(n => n.pos === 0 && isLettered(n)).map(n => n.marker).join('')
    const where = cursor + (lead ? lead.length + (leadJoiner ? 1 : 0) : 0)
    const key = verses[i].t.trim().split(/\s+/)[0]
    expect(joined.slice(where, where + key.length)).toBe(key)
    want.push(where)
    cursor += parts[i].length
  }
  return { got: verses.map(v => hits.find(h => h.v === v.v)?.at), want }
}

describe('a lettered note before the first word', () => {
  it.skipIf(!HAS_TEXTS)('keeps Deuteronomy 30:9-11 each on its own first word', () => {
    // 30:10 is "a" then "if thou shalt hearken", and the verse also says "if thou turn"
    expect(drawVerse(deutRun[1], true).startsWith('a\u2060if thou')).toBe(true)
    const laid = placed(deutRun, true)
    expect(laid.got).toEqual(laid.want)
    // drawn as 1.3.11 drew it, the letter against the word, the same search misses
    expect(drawVerse(deutRun[1], false).startsWith('aif thou')).toBe(true)
    expect(placed(deutRun, false).got).not.toEqual(placed(deutRun, false).want)
  })
  it.skipIf(!HAS_TEXTS)('keeps Jeremiah 39, whose first verse opens with note d, each on its own first word', () => {
    expect(jerRun.map(v => v.v)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(drawVerse(jerRun[0], true).startsWith('d\u2060And')).toBe(true)
    const laid = placed(jerRun, true)
    expect(laid.got).toEqual(laid.want)
    expect(drawVerse(jerRun[0], false).startsWith('dAnd')).toBe(true)
    expect(placed(jerRun, false).got).not.toEqual(placed(jerRun, false).want)
  })
})
