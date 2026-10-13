// The reader's side of a path (docs/PATHS.md rule 3), as pure decisions: where "next" goes from a chapter on the path,
// off it, and at its end; the portion a chapter belongs to; and read aloud's continue, which uses the same answer.
import { describe, it, expect } from 'vitest'
import { chapterKey, nextOnPath, portionOf, type PathState } from '../shared/paths'

const GOSPELS: PathState = { id: 'gospels', started_at: '2026-09-01T00:00:00Z', target_date: null, pace_per_week: null, with_ministry: false }
const LIFE: PathState = { ...GOSPELS, id: 'life-of-christ' }
const NONE = new Set<string>()
const MATTHEW = 40, MARK = 41, JOHN = 43, GENESIS = 1

describe('nextOnPath: the next target from a chapter', () => {
  it('on the path: the portion after this chapter, whether or not this one is credited yet', () => {
    expect(nextOnPath(GOSPELS, NONE, MATTHEW, 1)).toEqual({ book: MATTHEW, chapter: 2 })
    expect(nextOnPath(GOSPELS, new Set([chapterKey(MATTHEW, 1)]), MATTHEW, 1)).toEqual({ book: MATTHEW, chapter: 2 })
    // across a book boundary the path decides, not the canon
    expect(nextOnPath(GOSPELS, NONE, MATTHEW, 28)).toEqual({ book: MARK, chapter: 1 })
  })
  it('skips portions already read after this one: the next UNREAD portion', () => {
    const read = new Set([chapterKey(MATTHEW, 2), chapterKey(MATTHEW, 3)])
    expect(nextOnPath(GOSPELS, read, MATTHEW, 1)).toEqual({ book: MATTHEW, chapter: 4 })
  })
  it('off the path: null, so the canonical next applies', () => {
    expect(nextOnPath(GOSPELS, NONE, GENESIS, 1)).toBeNull()
    expect(nextOnPath(GOSPELS, NONE, 44, 1)).toBeNull()
  })
  it('at the last portion: null (the canonical next, Acts 1, without path wording), whatever is unread before it: a turn only goes forward', () => {
    expect(nextOnPath(GOSPELS, NONE, JOHN, 21)).toBeNull()
    expect(nextOnPath(GOSPELS, NONE, JOHN, 20)).toEqual({ book: JOHN, chapter: 21 })
    // every other portion read too
    const allButLast = new Set<string>()
    for (let c = 1; c <= 28; c++) allButLast.add(chapterKey(MATTHEW, c))
    for (let c = 1; c <= 16; c++) allButLast.add(chapterKey(MARK, c))
    for (let c = 1; c <= 24; c++) allButLast.add(chapterKey(42, c))
    for (let c = 1; c <= 20; c++) allButLast.add(chapterKey(JOHN, c))
    expect(nextOnPath(GOSPELS, allButLast, JOHN, 21)).toBeNull()
    // and from John 20 with everything else read, John 21 is what is left
    allButLast.delete(chapterKey(JOHN, 20))
    expect(nextOnPath(GOSPELS, allButLast, JOHN, 20)).toEqual({ book: JOHN, chapter: 21 })
  })
  it('follows an order that is not the canon (the life of Christ: Matthew 8 comes before Matthew 5)', () => {
    const n = nextOnPath(LIFE, NONE, MATTHEW, 4)
    expect(n).not.toBeNull()
    expect(n).not.toEqual({ book: MATTHEW, chapter: 5 })
  })
  it('never answers the chapter itself, even unread and before an unread run', () => {
    for (let c = 1; c <= 28; c++) expect(nextOnPath(GOSPELS, NONE, MATTHEW, c)).not.toEqual({ book: MATTHEW, chapter: c })
  })
})

describe('portionOf: the portion a chapter belongs to', () => {
  it('is the chapter, without ministry for a Scripture-only path; null off the path', () => {
    expect(portionOf(GOSPELS, MARK, 4)).toEqual({ book: MARK, chapter: 4 })
    expect(portionOf(GOSPELS, GENESIS, 1)).toBeNull()
  })
  it('a companion path without its index loaded stands the chapter alone (no `then` yet)', () => {
    expect(portionOf({ ...GOSPELS, id: 'synopsis', with_ministry: true }, GENESIS, 1)).toEqual({ book: GENESIS, chapter: 1 })
  })
})
