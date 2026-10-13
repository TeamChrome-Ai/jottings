import { describe, expect, it } from 'vitest'
import { bookPage, concordanceLine, groupByBook, OCCURRENCE_PAGE, renderingKey, strongsCode, type StrongsBook, type StrongsOccurrence } from '../shared/concordance'

const occ = (book: number, chapter: number, verse: number): StrongsOccurrence => ({ book, chapter, verse, text: '', w: [] })
const books: StrongsBook[] = [{ book: 40, occurrences: 12, verses: 12 }, { book: 43, occurrences: 25, verses: 24 }, { book: 45, occurrences: 3, verses: 3 }]

describe('occurrence pages', () => {
  it('finds the page holding a book’s first verse', () => {
    expect(OCCURRENCE_PAGE).toBe(30)
    expect(bookPage(books, 40)).toBe(1)
    expect(bookPage(books, 43)).toBe(1)
    // 12 + 24 verses before Romans: the 37th, on page 2
    expect(bookPage(books, 45)).toBe(2)
    expect(bookPage(books, 45, 10)).toBe(4)
  })
  it('groups a page by book, marking a book that began on an earlier page', () => {
    const first = groupByBook([...Array.from({ length: 12 }, (_, i) => occ(40, i + 1, 1)), ...Array.from({ length: 18 }, (_, i) => occ(43, i + 1, 1))], books, 0)
    expect(first.map(g => [g.book, g.items.length, g.occurrences, g.continued])).toEqual([[40, 12, 12, false], [43, 18, 25, false]])
    const second = groupByBook([...Array.from({ length: 6 }, (_, i) => occ(43, 19 + i, 1)), occ(45, 1, 1), occ(45, 2, 1), occ(45, 3, 1)], books, 30)
    expect(second.map(g => [g.book, g.items.length, g.verses, g.continued])).toEqual([[43, 6, 24, true], [45, 3, 3, false]])
    expect(groupByBook([], books, 0)).toEqual([])
  })
})

describe('concordanceLine', () => {
  const join = (parts: { text: string; hit: boolean }[]) => parts.map(p => (p.hit ? `[${p.text}]` : p.text)).join('')
  it('sets the tagged words apart in the whole verse', () => {
    const text = 'he came to him by night, and said to him, Rabbi, we know that thou art come a teacher from God'
    expect(join(concordanceLine(text, [18]))).toBe('he came to him by night, and said to him, Rabbi, we know that thou art come a [teacher] from God')
    expect(join(concordanceLine('God said, Let there be light. And God saw', [0, 7]))).toBe('[God] said, Let there be light. And [God] saw')
    expect(join(concordanceLine('Jesus’ word; thou didst it.', []))).toBe('Jesus’ word; thou didst it.')
  })
  it('cuts a long verse around the first tagged word', () => {
    const words = Array.from({ length: 60 }, (_, i) => `w${i}`)
    const text = words.join(' ') + '.'
    // 40 words, 10 of them before w30
    expect(join(concordanceLine(text, [30]))).toBe(`… ${words.slice(20, 30).join(' ')} [w30] ${words.slice(31, 60).join(' ')}.`)
    // near the start: from the start, cut at the end
    expect(join(concordanceLine(text, [2]))).toBe(`w0 w1 [w2] ${words.slice(3, 40).join(' ')} …`)
    // near the end: the last 40 words
    expect(join(concordanceLine(text, [58], 40))).toBe(`… ${words.slice(20, 58).join(' ')} [w58] w59.`)
    expect(join(concordanceLine(text, [5, 50], 20))).toBe(`w0 w1 w2 w3 w4 [w5] ${words.slice(6, 20).join(' ')} …`)
  })
})

describe('renderingKey', () => {
  it('explains only the marks a list uses', () => {
    expect(renderingKey('doctor, master, teacher')).toBe('')
    expect(renderingKey('× exceeding, God, god(-ly, -ward)')).toBe('× an idiom of the original')
    expect(renderingKey('also, + champion, × mighty')).toBe('× an idiom of the original · + with another word')
    expect(renderingKey(null)).toBe('')
  })
})

describe('strongsCode: a Strong’s number typed in Search', () => {
  it('reads G and H numbers in any case, zero-padded or spaced, as the tags spell them', () => {
    expect(strongsCode('G1320')).toBe('G1320')
    expect(strongsCode('h0430')).toBe('H430')
    expect(strongsCode(' g 26 ')).toBe('G26')
    expect(strongsCode('H8674')).toBe('H8674')
  })
  it('leaves references, words and other numbers alone', () => {
    for (const q of ['jn 3:16', 'God', 'G', 'G0', 'Gen 1', 'G123456', 'H43a', '1320']) expect(strongsCode(q), q).toBeNull()
  })
})
