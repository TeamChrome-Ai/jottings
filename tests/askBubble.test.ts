import { describe, it, expect } from 'vitest'
import { ASK_MAX, askDraft, askTarget, draftOf, takeDraft } from '../client/src/lib/askDraft'
import { readField } from '../client/src/lib/searchField'
import { KEYBOARD_MIN, keyboardUp } from '../client/src/lib/keyboard'

describe('the search field, as Go reads it', () => {
  it('a Strong’s number, in the tags’ spelling', () => {
    expect(readField('g1320')).toEqual({ kind: 'strongs', code: 'G1320' })
    expect(readField(' H0430 ')).toEqual({ kind: 'strongs', code: 'H430' })
  })
  it('a reference, a misspelt book forgiven when a chapter follows it', () => {
    expect(readField('jn 3:16')).toEqual({ kind: 'ref', ref: { book: 43, chapter: 3, v1: 16 }, near: false })
    expect(readField('1 cor 13')).toMatchObject({ kind: 'ref', ref: { book: 46, chapter: 13 }, near: false })
    expect(readField('Jhon 3:16')).toMatchObject({ kind: 'ref', ref: { book: 43, chapter: 3, v1: 16 }, near: true })
  })
  it('words: a question, a book’s name alone (the book offered), a misspelt name alone, a number that makes no reference', () => {
    expect(readField('how can I be sure I am saved')).toEqual({ kind: 'words', book: undefined })
    expect(readField('song')).toMatchObject({ kind: 'words', book: { n: 22 } })
    expect(readField('Pslams')).toEqual({ kind: 'words', book: undefined })
    expect(readField('the 144 thousand')).toEqual({ kind: 'words', book: undefined })
  })
  it('nothing', () => {
    expect(readField('   ')).toEqual({ kind: 'empty' })
  })
})

describe('the draft the Ask bubble carries from Search', () => {
  it('is the words in the field, as typed and trimmed', () => {
    expect(askDraft('  how can I be sure I am saved ')).toBe('how can I be sure I am saved')
    expect(askDraft('love in the gospels')).toBe('love in the gospels')
    expect(askDraft('“grace of God”')).toBe('“grace of God”')
  })
  it('is nothing for what Search opens itself: a reference, a misspelt one, a Strong’s number', () => {
    for (const q of ['jn 3:16', 'rom 8:28', '1 cor 13:4-7', 'Jhon 3:16', 'G1320', 'h430']) expect(askDraft(q), q).toBe('')
  })
  it('is nothing for an empty field', () => {
    expect(askDraft('')).toBe('')
    expect(askDraft('  \n ')).toBe('')
  })
  it('is no longer than Ask’s field takes', () => {
    expect(askDraft('grace '.repeat(500))).toHaveLength(ASK_MAX)
  })
})

describe('where the bubble goes', () => {
  it('signed out: sign-in, as Ask’s row on Home, and no words go with it', () => {
    expect(askTarget(false, '')).toBe('/login')
    expect(askTarget(false, 'how can I be sure I am saved')).toBe('/login')
  })
  it('signed in with an empty field, a reference or a Strong’s number: Ask, with no draft', () => {
    for (const q of ['', '  ', 'jn 3:16', 'G1320']) expect(askTarget(true, q), q).toBe('/ask')
  })
  it('signed in with words: Ask, the words as its draft', () => {
    expect(askTarget(true, 'how can I be sure I am saved')).toEqual({ pathname: '/ask', params: { draft: 'how can I be sure I am saved' } })
  })
})

describe('the draft on Ask’s route', () => {
  it('is its words; anything that is not text is none', () => {
    expect(draftOf(' what is grace ')).toBe('what is grace')
    expect(draftOf(undefined)).toBe('')
    expect(draftOf(['a', 'b'])).toBe('')
    expect(draftOf('x'.repeat(ASK_MAX + 50))).toHaveLength(ASK_MAX)
  })
  it('is read once: taking it clears the route, and a second reading finds none', () => {
    const route: { draft?: string } = { draft: 'how can I be sure I am saved' }
    let cleared = 0
    const take = () => takeDraft(route.draft, () => { cleared++; delete route.draft })
    expect(take()).toBe('how can I be sure I am saved')
    expect(route).toEqual({})
    expect(take()).toBe('')
    expect(cleared).toBe(1)
  })
  it('a draft of nothing but spaces is cleared from the route too', () => {
    let cleared = 0
    expect(takeDraft('   ', () => { cleared++ })).toBe('')
    expect(cleared).toBe(1)
  })
})

describe('the keyboard, on the web', () => {
  it('is up when the window shows at least a keyboard’s height less than it has', () => {
    expect(keyboardUp(915, 915)).toBe(false)
    expect(keyboardUp(915, 915 - KEYBOARD_MIN)).toBe(true)
    expect(keyboardUp(915, 560)).toBe(true)
  })
  it('is not a browser’s bar going, nor a pinch zoom', () => {
    expect(keyboardUp(915, 859)).toBe(false)
    expect(keyboardUp(915, 457.5, 2)).toBe(false)
    expect(keyboardUp(915, 280, 2)).toBe(true)
  })
})
