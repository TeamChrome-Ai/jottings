// The sources of one of Ask's answers (client/src/lib/askSources.ts): the paragraphs it rests on, numbered as a
// reader meets them, and whether the conversation still follows its newest words (client/src/lib/askScroll.ts).
import { describe, it, expect } from 'vitest'
import { sourcesOf } from '../client/src/lib/askSources'
import { NEAR_END, follows } from '../client/src/lib/askScroll'
import { keyboardCover } from '../client/src/lib/keyboard'

const all = () => true

describe('the sources of an answer', () => {
  it('are numbered by first appearance: the first paragraph a sentence names is 1', () => {
    expect(sourcesOf([{ ids: [40] }, { ids: [12] }, { ids: [77] }], all)).toEqual([40, 12, 77])
  })
  it('the same paragraph keeps the same number, however often it is named', () => {
    // the answer in the owner's screenshot: 1; 2; 1 and 3; 2; nothing
    const answer = [{ ids: [40] }, { ids: [12] }, { ids: [40, 77] }, { ids: [12] }, { ids: [] }]
    expect(sourcesOf(answer, all)).toEqual([40, 12, 77])
  })
  it('two paragraphs after one sentence are numbered in the order they stand', () => {
    expect(sourcesOf([{ ids: [9, 3] }, { ids: [3, 5, 9] }], all)).toEqual([9, 3, 5])
    expect(sourcesOf([{ ids: [9, 9] }], all)).toEqual([9])
  })
  it('a paragraph the conversation cannot place is no source and takes no number', () => {
    expect(sourcesOf([{ ids: [99] }, { ids: [40, 99, 12] }], id => id !== 99)).toEqual([40, 12])
  })
  it('an answer that rests on nothing has none', () => {
    expect(sourcesOf([{ ids: [] }, { ids: [] }], all)).toEqual([])
    expect(sourcesOf([], all)).toEqual([])
  })
})

describe('whether the conversation follows its newest words', () => {
  // a screen 600 high
  const at = (y: number, content: number) => ({ y, view: 600, content })
  it('at the end, or within a little of it, it follows', () => {
    expect(follows(false, 0, at(1400, 2000))).toBe(true)
    expect(follows(false, 1300, at(1400 - NEAR_END, 2000))).toBe(true)
  })
  it('the reader scrolls up to read: it leaves them alone', () => {
    expect(follows(true, 1400, at(1000, 2000))).toBe(false)
    // and goes on leaving them alone while they read on, up or down, short of the end
    expect(follows(false, 1000, at(700, 2000))).toBe(false)
    expect(follows(false, 700, at(900, 2000))).toBe(false)
  })
  it('the answer grows under a reader who has not moved: it still follows', () => {
    // 300 px of new words: the end is further off, but the reader did not scroll away from it
    expect(follows(true, 1400, at(1400, 2300))).toBe(true)
    // and its own move to the new end, part of the way there, is not the reader's
    expect(follows(true, 1400, at(1550, 2300))).toBe(true)
  })
  it('the reader comes back to the end: it follows again', () => {
    expect(follows(false, 900, at(1700 - NEAR_END, 2300))).toBe(true)
  })
  it('a conversation shorter than the screen is always at its end', () => {
    expect(follows(false, 0, at(0, 300))).toBe(true)
  })
})

describe('what the keyboard covers, on the web', () => {
  it('is nothing while the keyboard is down, or for a browser’s bar', () => {
    expect(keyboardCover(915, 915)).toBe(0)
    expect(keyboardCover(915, 859)).toBe(0)
  })
  it('is the foot of the window that no longer shows', () => {
    expect(keyboardCover(915, 560)).toBe(355)
  })
  it('is less by what the browser has already moved the page up to show the field', () => {
    expect(keyboardCover(915, 560, 300)).toBe(55)
    expect(keyboardCover(915, 560, 355)).toBe(0)
  })
  it('is not a pinch zoom', () => {
    expect(keyboardCover(915, 457.5, 0, 2)).toBe(0)
  })
})
