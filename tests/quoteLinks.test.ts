import { describe, it, expect } from 'vitest'
import { quotedRefs, quoteLinks, quoteWords, refOfVerse } from '../client/src/lib/quoteLinks'
import { inlineSpans } from '../client/src/lib/intro'

/** A line as the reader shows it: its spans' text joined. */
const shown = (html: string, notes = true) => inlineSpans(html, notes).map(s => s.text).join('')
const at = (line: string, l: { a: number; b: number }) => line.slice(l.a, l.b)

describe('a quotation of Scripture in the ministry', () => {
  it('is found in the text as shown, whatever the typesetting changed', () => {
    // the index read straight quotes, "--" and a footnote caller; the reader shows curled quotes, a dash and a figure
    const line = shown(`He said, "the Lord's -- word"[1] and went on.`)
    const links = quoteLinks([line], [{ verse: 43003016, words: `the Lord's -- word"[1] and` }])
    expect(links).toHaveLength(1)
    expect(at(line, links[0])).toBe('the Lord’s — word”¹ and')
    expect(links[0].ref).toEqual({ book: 43, chapter: 3, v1: 16 })
  })

  it('links each quotation where it stands, in order, the same words twice included', () => {
    const line = 'I am the light of the world, he says; and again, I am the light of the world.'
    const links = quoteLinks([line], [{ verse: 43008012, words: 'I am the light of the world' }, { verse: 43009005, words: 'I am the light of the world' }])
    expect(links.map(l => [l.a, l.ref.chapter])).toEqual([[0, 8], [line.lastIndexOf('I am'), 9]])
  })

  it('is a link on each line it runs over', () => {
    const lines = ['The Lord is my shepherd;', 'I shall not want.']
    const links = quoteLinks(lines, [{ verse: 19023001, words: 'The Lord is my shepherd; I shall not want' }])
    expect(links.map(l => [l.line, at(lines[l.line], l)])).toEqual([[0, 'The Lord is my shepherd'], [1, 'I shall not want']])
  })

  it('takes a bare “(verse 8)” closing a quotation of a verse 8 to it, as the verse index reads it', () => {
    // Coates, reading Ezra 4, quotes Haggai and gives only the verse
    const spans = inlineSpans('“The silver is mine, and the gold is mine, saith the Lord of hosts” (verse 8). And (v. 9) after.', false, { book: 15, chapter: 4 })
    const quote = 'The silver is mine, and the gold is mine, saith the Lord of hosts'
    const refs = (verse: number) => quotedRefs([spans], quoteLinks([spans.map(s => s.text).join('')], [{ verse, words: quote }]))[0].filter(s => s.ref).map(s => [s.text, s.ref])
    expect(refs(37002008)).toEqual([['verse 8', { book: 37, chapter: 2, v1: 8 }], ['v. 9', { book: 15, chapter: 4, v1: 9 }]])
    // a quotation of another verse number leaves it
    expect(refs(37002007)).toEqual([['verse 8', { book: 15, chapter: 4, v1: 8 }], ['v. 9', { book: 15, chapter: 4, v1: 9 }]])
  })

  it('links nothing when the words are not there, and leaves the rest of the paragraph alone', () => {
    const line = 'Grace reigns through righteousness.'
    expect(quoteLinks([line], [{ verse: 45005021, words: 'grace might reign through righteousness' }])).toEqual([])
    expect(quoteLinks([line], [{ verse: 45005021, words: ' ' }])).toEqual([])
  })

  it('reads words as the verse index does: letters only, case and apostrophes aside', () => {
    expect(quoteWords('“Lord’s” -- the 2 Sons¹')).toEqual(['lords', 'the', 'sons'])
    expect(refOfVerse(1001001)).toEqual({ book: 1, chapter: 1, v1: 1 })
    expect(refOfVerse(66022021)).toEqual({ book: 66, chapter: 22, v1: 21 })
  })
})
