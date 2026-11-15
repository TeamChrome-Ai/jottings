import { describe, expect, it } from 'vitest'
import { openingPlace, placeBeingRead } from '../client/src/lib/readAloudPlace'

// Where the reader opens when no chapter was asked for (/read: the app opened, the Read tab's first showing). A
// reading may be going that this screen never started: a car's, or one that moved on while no screen was up.
const idle = { status: 'idle' as const, book: 0, chapter: 0, spoken: null }
const john4 = (status: 'loading' | 'playing' | 'paused' | 'error' | 'idle', v: number | null = null) =>
  ({ status, book: 43, chapter: 4, spoken: v === null ? null : { book: 43, chapter: 4, v, off: null } })

describe('the place being read aloud', () => {
  it('is the chapter and the verse the voice is at', () => {
    expect(placeBeingRead(john4('playing', 7))).toEqual({ book: 43, chapter: 4, verse: 7 })
  })

  it('is there while the reading is paused or its chapter still loads, from the top until a verse is spoken', () => {
    expect(placeBeingRead(john4('paused', 12))).toEqual({ book: 43, chapter: 4, verse: 12 })
    expect(placeBeingRead(john4('loading'))).toEqual({ book: 43, chapter: 4, verse: 1 })
    expect(placeBeingRead(john4('playing', 0))).toEqual({ book: 43, chapter: 4, verse: 1 })   // the spoken heading
  })

  it('takes no verse from the chapter before, still named as spoken while the next one loads', () => {
    expect(placeBeingRead({ status: 'loading', book: 43, chapter: 5, spoken: { book: 43, chapter: 4, v: 54, off: null } })).toEqual({ book: 43, chapter: 5, verse: 1 })
  })

  it('is nowhere with nothing in hand: never started, stopped, ended or failed', () => {
    expect(placeBeingRead(idle)).toBeNull()
    expect(placeBeingRead(john4('idle'))).toBeNull()
    expect(placeBeingRead(john4('error'))).toBeNull()
  })
})

describe('where the reader opens with no chapter asked for', () => {
  const saved = { book: 43, chapter: 1, verse: 1 }
  it('at the chapter being read aloud, at its verse', () => {
    expect(openingPlace(saved, john4('playing', 7))).toEqual({ book: 43, chapter: 4, verse: 7 })
  })

  it('where the reader left off when nothing is being read', () => {
    expect(openingPlace(saved, idle)).toEqual(saved)
    expect(openingPlace(saved, john4('idle'))).toEqual(saved)
  })
})
