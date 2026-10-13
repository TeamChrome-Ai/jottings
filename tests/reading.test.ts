import { describe, it, expect } from 'vitest'
import { READ_MAX_SECONDS, READ_MIN_SECONDS, atEnd, chapterWords, requiredSeconds, wordCount } from '../shared/reading'
import { MAX_BEAT_MS, earned, msToCredit, newVisit } from '../client/src/lib/readCredit'

describe('word count', () => {
  it('counts runs of letters, digits and apostrophes, as the scripture build does', () => {
    expect(wordCount('In the beginning God created the heavens and the earth.')).toBe(10)
    expect(wordCount('Jehovah’s word, and man\'s: 2 or 3 — “yea”.')).toBe(8)
    expect(wordCount('Κύριος ἐστιν')).toBe(2)
    expect(wordCount('  — ; ')).toBe(0)
    expect(chapterWords([{ t: 'Jesus wept.' }, { t: 'Praise ye Jah!' }])).toBe(5)
  })
})

describe('time a chapter needs', () => {
  it('is its length at 250 words a minute, held to 45 s and 10 min', () => {
    expect(requiredSeconds(0)).toBe(READ_MIN_SECONDS)
    expect(requiredSeconds(100)).toBe(45)
    expect(requiredSeconds(600)).toBe(144)
    expect(requiredSeconds(2000)).toBe(480)
    expect(requiredSeconds(5000)).toBe(READ_MAX_SECONDS)
  })
})

describe('the end of the chapter', () => {
  it('is the bottom of the scroll, or a chapter that fits', () => {
    expect(atEnd(0, 800, 3000)).toBe(false)
    expect(atEnd(2200, 800, 3000)).toBe(true)
    expect(atEnd(2197, 800, 3000)).toBe(true) // sub-pixel rounding at the bottom
    expect(atEnd(2100, 800, 3000)).toBe(false)
    expect(atEnd(0, 800, 640)).toBe(true)
  })
})

describe('a visit', () => {
  it('earns the time since the last beat, capped at 20 s, only while active', () => {
    expect(earned(null, 10_000, true)).toBe(0)
    // a second short, in whole seconds: the server sees 15 s beats arrive 14.99 s apart
    expect(earned(0, 15_000, true)).toBe(14_000)
    expect(earned(0, 12_900, true)).toBe(11_000)
    expect(earned(0, 500, true)).toBe(0)
    expect(earned(0, 60_000, true)).toBe(MAX_BEAT_MS)
    expect(earned(0, 12_000, false)).toBe(0)
  })
  it('waits for the end before counting down, then for the time its length asks', () => {
    const v = newVisit(19, 117)
    // Psalm 117, 33 words: the 45 s floor
    expect(msToCredit(v, 33, 0, 5_000, true)).toBeNull()
    v.reached = true
    expect(msToCredit(v, 33, 0, 5_000, true)).toBe(41_000)
    v.dwellMs = 39_000
    expect(msToCredit(v, 33, 15_000, 22_000, true)).toBe(0)
    // idle since the last beat: the time since then does not count
    expect(msToCredit(v, 33, 15_000, 22_000, false)).toBe(6_000)
    expect(msToCredit(v, undefined, 15_000, 20_000, true)).toBeNull()
    v.credited = true
    expect(msToCredit(v, 33, 15_000, 20_000, true)).toBeNull()
  })
  it('a scroll blast reaches the end with the time still owed', () => {
    const v = { ...newVisit(19, 119), reached: true, dwellMs: 5_000 }
    expect(msToCredit(v, 2000, 5_000, 7_000, true)).toBe(480_000 - 6_000)
  })
})
