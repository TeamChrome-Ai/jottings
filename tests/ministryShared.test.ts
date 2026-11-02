import { describe, it, expect } from 'vitest'
import { wholeWord } from '@shared/cbd'
import { WORD_RE_EN } from '@shared/texts'
import { MAX_PICKED, pickedPhrase, pickedSpan, pickWords, refsPath, selectionKey, type WordPick } from '../client/src/lib/ministryShared'

// Genesis 6:2, by word: that(0) the(1) sons(2) of(3) God(4) saw(5) the(6) daughters(7) of(8) men(9) …
const GEN_6_2 = 'that the sons of God saw the daughters of men that they were fair and took themselves wives of all that they chose'.split(' ')
const tap = (picked: WordPick | null, wi: number, verse = 2) => pickWords(picked, verse, wi, GEN_6_2[wi])

describe('the words of a verse picked to look for', () => {
  it('picks the tapped word, then the run from it to the next word tapped, either way', () => {
    const sons = tap(null, 2)
    expect(sons).toEqual({ verse: 2, from: 2, to: 2 })
    expect(tap(sons, 4)).toEqual({ verse: 2, from: 2, to: 4 })
    expect(tap(tap(null, 4), 2)).toEqual({ verse: 2, from: 2, to: 4 })
  })
  it('clears when the one word picked is tapped again', () => {
    expect(tap(tap(null, 2), 2)).toBeNull()
  })
  it('starts over at the tapped word after a run, or in another verse', () => {
    const run = tap(tap(null, 2), 4)
    expect(tap(run, 7)).toEqual({ verse: 2, from: 7, to: 7 })
    expect(tap(run, 3)).toEqual(run)
    expect(tap(tap(null, 2), 7, 3)).toEqual({ verse: 3, from: 7, to: 7 })
  })
  it('never picks a small word alone, but takes one into a run', () => {
    expect(tap(null, 1)).toBeNull()
    expect(tap(tap(null, 2), 1)).toEqual({ verse: 2, from: 1, to: 2 })
    const run = tap(tap(null, 2), 4)
    expect(tap(run, 6)).toBe(run)
    expect(tap(tap(null, 2), 1, 3)).toEqual({ verse: 2, from: 2, to: 2 })
    expect(pickWords(null, 2, 0, 'LORD’s')).toEqual({ verse: 2, from: 0, to: 0 })
    expect(pickWords(null, 2, 0, 'Unto')).toBeNull()
    expect(pickWords(null, 2, 0, '120')).toBeNull()
  })
  it('runs at most MAX_PICKED words, from the first word toward the tap', () => {
    expect(tap(tap(null, 2), 22)).toEqual({ verse: 2, from: 2, to: 2 + MAX_PICKED - 1 })
    expect(tap(tap(null, 22), 2)).toEqual({ verse: 2, from: 22 - MAX_PICKED + 1, to: 22 })
  })
})

/** A verse's tokens as bible.ts `tokenize` cuts the English. */
const tokens = (text: string) => {
  let wi = 0
  return [...text.matchAll(WORD_RE_EN)].map(m => m[1] ? { tok: m[1], wi: wi++, word: true } : { tok: m[2], wi: -1, word: false })
}
const phrase = (text: string, from: number, to = from) => pickedPhrase(tokens(text), { verse: 1, from, to })
const SONS = 'that the sons of God saw the daughters of men, that they were fair; and they took themselves wives'
// baptising(0) in(1) " Æ" non(2) near(3) the(4) land(5) of(6) Jud(7) "æ" a(8)
const LIGATURES = 'baptising in Ænon, near the land of Judæa.'

describe('the words picked, as asked for', () => {
  it('asks for one word, or a run with what stands between its words', () => {
    expect(phrase(SONS, 2)).toBe('sons')
    expect(phrase(SONS, 2, 4)).toBe('sons of God')
    expect(phrase(SONS, 9, 10)).toBe('men, that')
    expect(phrase(SONS, 13, 15)).toBe('fair; and they')
  })
  it('asks for a word split at a ligature whole, from either part and at either end of a run', () => {
    expect(phrase(LIGATURES, 7)).toBe('Judæa')
    expect(phrase(LIGATURES, 8)).toBe('Judæa')
    expect(phrase(LIGATURES, 5, 7)).toBe('land of Judæa')
    expect(phrase(LIGATURES, 5, 8)).toBe('land of Judæa')
    expect(phrase(LIGATURES, 2)).toBe('Ænon')
    expect(phrase(LIGATURES, 1, 2)).toBe('in Ænon')
    expect(phrase(LIGATURES, 2, 3)).toBe('Ænon, near')
  })
  it('asks for nothing when the pick names no word of the verse', () => {
    expect(phrase(SONS, 40)).toBe('')
    expect(pickedSpan(tokens(SONS), { verse: 1, from: 40, to: 40 })).toBeNull()
  })
  it('stands where it is asked for, so the sheet paints what it asks: a ligature in, the space before it out', () => {
    const at = (from: number, to = from) => pickedSpan(tokens(LIGATURES), { verse: 1, from, to })
    expect(at(2)).toEqual({ start: LIGATURES.indexOf('Ænon'), end: LIGATURES.indexOf('Ænon') + 4 })
    expect(at(7)).toEqual({ start: LIGATURES.indexOf('Judæa'), end: LIGATURES.indexOf('Judæa') + 5 })
    expect(at(5, 7)).toEqual(at(5, 8))
  })
  it('asks for one word as the word sheet asks for the word tapped', () => {
    const toks = tokens(LIGATURES)
    toks.forEach((k, i) => { if (k.word) expect(pickedPhrase(toks, { verse: 1, from: k.wi, to: k.wi })).toBe(wholeWord(toks, i)) })
  })
})

describe('the request for a selection', () => {
  it('names the verses in runs and carries the author, the page and the words', () => {
    expect(selectionKey([7, 1, 3, 8, 9, 3])).toBe('1,3,7-9')
    expect(refsPath(1, 6, [2])).toBe('/ministry/refs/1/6/2')
    expect(refsPath(1, 6, [2], { author: 'darby', page: 2 })).toBe('/ministry/refs/1/6/2?author=darby&page=2')
    expect(refsPath(1, 6, [2], { q: 'sons of God' })).toBe('/ministry/refs/1/6/2?q=sons%20of%20God')
    expect(refsPath(1, 6, [2, 3], { author: 'darby', q: 'LORD’s' })).toBe('/ministry/refs/1/6/2-3?author=darby&page=1&q=LORD%E2%80%99s')
  })
})
