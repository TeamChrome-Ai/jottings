import { describe, it, expect } from 'vitest'
import { AUTHORS, chipLabels, formatPassage, isWholeChapter, formatPassages, pageStarts, paragraphAnchors, paragraphFor, paragraphsOf, passageStart, searchCompanion, sectionForVerse, sectionsFor, titleIsPassage, undated, versesIn, workLine, type CompanionIndex, type Passage } from '../shared/companion'
import { inlineSpans } from '../client/src/lib/intro'

// small libraries shaped like data/coates/index.json and data/synopsis/index.json
const index: CompanionIndex = { author: 'coates', works: [
  { id: 'genesis', title: 'An Outline of Genesis', kind: 'outline', sections: [
    { title: 'Prefatory note', passages: [] },
    { title: 'Chapter 1', passages: [[1, 1, 1, 1, 0]] },
    { title: 'Chapters 29–35', passages: [[1, 29, 1, 35, 0]] },
  ] },
  { id: 'colossians', title: 'An Outline of Colossians', kind: 'outline', sections: [
    { title: 'Chapter 1:1–16', passages: [[51, 1, 1, 1, 16]] },
    { title: 'Chapter 1:9–24', passages: [[51, 1, 9, 1, 24]] },
    { title: 'Chapter 1:24 to 2:10', passages: [[51, 1, 24, 2, 10]] },
  ] },
  { id: 'romans', title: 'An Outline of the Epistle to the Romans', kind: 'outline', sections: [{ title: 'Chapter 15', passages: [[45, 15, 1, 15, 0]] }] },
  { id: 'believer-established', title: 'The Believer Established', kind: 'addresses', sections: [
    { title: 'The Believer Established', passages: [[45, 15, 13, 15, 13]] },
    { title: '“Stand fast”', passages: [[50, 4, 1, 4, 1]] },
    { title: 'The Nazarite’s vow', passages: [[4, 6, 1, 6, 21]] },
  ] },
] }
const darby: CompanionIndex = { author: 'darby', works: [
  { id: 'introduction', title: 'Preface and introduction', kind: 'introduction', sections: [{ title: 'Preface', passages: [] }] },
  { id: 'genesis', title: 'Genesis', kind: 'outline', sections: [
    { title: 'Introduction', passages: [] },
    { title: 'Genesis 1', passages: [[1, 1, 1, 1, 0]] },
    { title: 'Genesis 29–35', passages: [[1, 29, 1, 35, 0]] },
  ] },
  { id: 'romans', title: 'Romans', kind: 'outline', sections: [{ title: 'Romans 15', passages: [[45, 15, 1, 15, 0]] }] },
] }
const ids = (xs: { author?: string; work: { id: string }; n: number }[]) => xs.map(x => `${x.work.id}/${x.n}`)
const full = (xs: { author: string; work: { id: string }; n: number }[]) => xs.map(x => `${x.author}:${x.work.id}/${x.n}`)

describe('passages', () => {
  it('reads the verses of a chapter a passage covers', () => {
    expect(versesIn([1, 1, 1, 1, 0], 1, 1)).toEqual([1, Infinity])
    expect(versesIn([51, 1, 24, 2, 10], 51, 1)).toEqual([24, Infinity])
    expect(versesIn([51, 1, 24, 2, 10], 51, 2)).toEqual([1, 10])
    expect(versesIn([1, 29, 1, 35, 0], 1, 31)).toEqual([1, Infinity])
    expect(versesIn([1, 29, 1, 35, 0], 1, 36)).toBeNull()
    expect(versesIn([1, 1, 1, 1, 0], 2, 1)).toBeNull()
  })

  it('formats them as the house writes references', () => {
    expect(formatPassage([1, 1, 1, 1, 0])).toBe('Genesis 1')
    expect(formatPassage([1, 29, 1, 35, 0])).toBe('Genesis 29–35')
    expect(formatPassage([51, 1, 24, 2, 10])).toBe('Colossians 1:24–2:10')
    expect(formatPassage([45, 15, 13, 15, 13])).toBe('Romans 15:13')
    expect(formatPassage([51, 1, 19, 1, 0])).toBe('Colossians 1:19–end')
    expect(formatPassage([65, 1, 3, 1, 4])).toBe('Jude 3–4')
    expect(formatPassage([65, 1, 1, 1, 0])).toBe('Jude')
    expect(formatPassages([[15, 4, 1, 5, 0], [37, 1, 1, 2, 0]], 'abbr')).toBe('Ezra 4–5; Hag 1–2')
    expect(([[1, 1, 1, 1, 0], [1, 29, 1, 35, 0], [51, 1, 24, 2, 10], [51, 1, 1, 1, 16], [65, 1, 3, 1, 4], [65, 1, 5, 1, 5]] as Passage[]).map(p => formatPassage(p, 'bare')))
      .toEqual(['Chapter 1', 'Chapters 29–35', '1:24–2:10', '1:1–16', 'Verses 3–4', 'Verse 5'])
    expect(passageStart([1, 1, 1, 1, 0])).toEqual({ book: 1, chapter: 1, v1: undefined })
    expect(passageStart([51, 1, 24, 2, 10])).toEqual({ book: 51, chapter: 1, v1: 24 })
  })
})

describe('sections for a chapter', () => {
  it('lists the walks through the book in order, then the addresses on a verse in it, each with its author', () => {
    expect(full(sectionsFor(index, 45, 15))).toEqual(['coates:romans/1', 'coates:believer-established/1'])
    expect(full(sectionsFor(darby, 1, 30))).toEqual(['darby:genesis/3'])
    expect(ids(sectionsFor(index, 51, 1))).toEqual(['colossians/1', 'colossians/2', 'colossians/3'])
    expect(ids(sectionsFor(index, 1, 31))).toEqual(['genesis/3'])
    expect(sectionsFor(index, 18, 3)).toEqual([])
  })

  it('opens the reading for the verse in view: an Outline before an address, the narrowest, else the nearest', () => {
    const rom = sectionsFor(index, 45, 15)
    expect(sectionForVerse(rom, 45, 15, 13)).toBe(0)                        // the chapter's reading, not the address on the verse
    const col = sectionsFor(index, 51, 1)
    expect(sectionForVerse(col, 51, 1, 3)).toBe(0)                           // only 1:1–16 holds verse 3
    expect(sectionForVerse(col, 51, 1, 12)).toBe(0)                          // 1:1–16 (15 verses) is narrower than 1:9–24 (15)? equal: the first
    expect(sectionForVerse(col, 51, 1, 20)).toBe(1)                          // 1:9–24 holds 20; 1:24 to 2:10 does not
    expect(sectionForVerse(col, 51, 1, 26)).toBe(2)                          // only the reading running on into chapter 2
    const col2 = sectionsFor(index, 51, 2)
    expect(sectionForVerse(col2, 51, 2, 15)).toBe(0)                         // nearest: 2:10 is five verses back
    expect(sectionForVerse([], 1, 1, 1)).toBe(-1)
    // only an address treats the chapter
    const phil = sectionsFor(index, 50, 4)
    expect(sectionForVerse(phil, 50, 4, 7)).toBe(0)
  })
})

describe('choosing among a chapter’s sections', () => {
  it('names each by its passage in the chapter, an address by its title, a reading by its title where passages read alike', () => {
    expect(chipLabels(sectionsFor(index, 51, 1), 51, 1)).toEqual(['1:1–16', '1:9–24', '1:24–2:10'])
    expect(chipLabels(sectionsFor(index, 45, 15), 45, 15)).toEqual(['Chapter 15', 'The Believer Established'])
    const tim: CompanionIndex = { author: 'coates', works: [{ id: 'timothy', title: 'An Outline of 1 and 2 Timothy', kind: 'outline', sections: [
      { title: 'Chapter 1 (first reading)', passages: [[54, 1, 1, 1, 0]] },
      { title: 'Chapter 1 (second reading)', passages: [[54, 1, 1, 1, 0]] },
      { title: 'Chapter 1 verse 9 (Bridport, 11 July 1925)', passages: [[54, 1, 9, 1, 9]] },
    ] }] }
    expect(chipLabels(sectionsFor(tim, 54, 1), 54, 1)).toEqual(['Chapter 1 (first reading)', 'Chapter 1 (second reading)', '1:9'])
    expect(undated('Chapter 10 verses 1–22 (Teignmouth, 1943)')).toBe('Chapter 10 verses 1–22')
  })
})

describe('opening a reading at the verse', () => {
  const gen1: Passage[] = [[1, 1, 1, 1, 0]]
  const paras = [
    'In the book of Genesis we have brought before us the beginning of those things (Hebrews 11:3).',
    '“And the earth was waste and empty” (Genesis 1:2). In verse 2 we find the earth a scene of disorder.',
    'The light is called out in verse 3; faith brings Him in (Isaiah 45:18).',
    'Man is made in His image, verse 26. “Let us make man.”',
    'Looking back to verse 1 once more, all is of God.',
    'The seventh day, Genesis 2:2, is God’s rest.',
    'Then verse 31: “very good”.',
  ]
  it('places each paragraph by the first verse of the passage it names, keeping only the forward run', () => {
    // Hebrews 11:3 and Isaiah 45:18 are outside the passage; verse 1 glancing back and Genesis 2:2 beyond it are not kept
    expect(paragraphAnchors(paras, gen1)).toEqual([-1, 1002, 1003, 1026, -1, -1, 1031])
  })
  it('opens at the last paragraph placed at or before the verse, else the top', () => {
    const a = paragraphAnchors(paras, gen1)
    expect(paragraphFor(a, 1, 1)).toBe(0)
    // the first placed paragraph (verse 2) opens at the top: what comes before it introduces it
    expect(paragraphFor(a, 1, 2)).toBe(0)
    expect(paragraphFor(a, 1, 20)).toBe(2)
    expect(paragraphFor(a, 1, 27)).toBe(3)
    expect(paragraphFor(a, 1, 31)).toBe(6)
  })
  it('places a paragraph by the verse it quotes, given the chapter’s text', () => {
    const text = { chapter: 1, verses: [
      { v: 3, t: 'And God said, Let there be light. And there was light.' },
      { v: 4, t: 'And God saw the light that it was good; and God divided between the light and the darkness.' },
      { v: 10, t: 'And God called the dry land Earth. And God saw that it was good.' },
      { v: 12, t: 'And the earth brought forth grass. And God saw that it was good.' },
      { v: 26, t: 'And God said, Let us make man in our image, after our likeness.' },
    ] }
    const quoting = [
      'Then on the first day “God said, Let there be light.” God commanding light.',
      'This is a fundamental division: “God divided between the light and the darkness”.',
      'And at each step “God saw that it was good”.',
      'Again “God saw that it was good” of the fruit.',
      'The words “No man hath seen God at any time” are of another book.',
      'Man comes last: “Let us make man.”',
    ]
    // a refrain said of several verses goes to the first after the last place (10, then 12)
    expect(paragraphAnchors(quoting, gen1, text)).toEqual([1003, 1004, 1010, 1012, -1, 1026])
    // without the text, only references place a paragraph
    expect(paragraphAnchors(quoting, gen1)).toEqual([-1, -1, -1, -1, -1, -1])
  })
  it('follows the chapter named in a reading over several chapters', () => {
    const a = paragraphAnchors(['Jacob goes on to Haran (Genesis 29:1).', 'In chapter 31 he leaves.', 'Verse 13 of it: “I am the God of Bethel.”', 'Then Genesis 32:24, the wrestling.'], [[1, 29, 1, 35, 0]])
    expect(a).toEqual([29001, 31001, 31013, 32024])
    expect(paragraphFor(a, 31, 20)).toBe(2)
    expect(paragraphFor(a, 30, 5)).toBe(0)
    expect(isWholeChapter([[18, 3, 1, 3, 0]], 18, 3)).toBe(true)
    expect(isWholeChapter([[1, 6, 1, 8, 0]], 1, 7)).toBe(false)
  })
})

describe('typesetting', () => {
  it('reads block quotations and keeps their lines', () => {
    expect(paragraphsOf('One.\n\n> “Joyful now the wide creation\n> Rests in undisturbed repose.”\n\nTwo.')).toEqual([
      { quote: false, lines: ['One.'] },
      { quote: true, lines: ['“Joyful now the wide creation', 'Rests in undisturbed repose.”'] },
      { quote: false, lines: ['Two.'] },
    ])
  })
  it('links references in the reading as the notices do, italics kept', () => {
    const spans = inlineSpans('It is <i>faith</i> (Hebrews 11:3), and so Romans 3:10–18 and 25.')
    expect(spans.filter(s => s.ref).map(s => [s.text, s.ref])).toEqual([
      ['Hebrews 11:3', { book: 58, chapter: 11, v1: 3 }],
      ['Romans 3:10–18', { book: 45, chapter: 3, v1: 10, v2: 18 }],
    ])
    expect(spans.find(s => s.italic)?.text).toBe('faith')
    // no footnotes unless asked: "[2]" in the text stays text
    expect(inlineSpans('a word [2] here').some(s => s.note)).toBe(false)
    expect(inlineSpans('a word[2] here', true).some(s => s.note === '2')).toBe(true)
  })
  it('pages a long reading between paragraphs, the pages about even', () => {
    const paras = Array.from({ length: 40 }, (_, i) => 'x'.repeat(i % 3 ? 400 : 900))
    const starts = pageStarts(paras, 6000)
    const total = paras.reduce((n, p) => n + p.length, 0)
    expect(starts[0]).toBe(0)
    expect(starts.length).toBe(Math.round(total / 6000))
    const sizes = starts.map((s, k) => paras.slice(s, starts[k + 1]).reduce((n, p) => n + p.length, 0))
    for (const n of sizes) expect(Math.abs(n - total / starts.length)).toBeLessThan(900)
    expect(pageStarts(['short'], 6000)).toEqual([0])
  })
})

describe('search', () => {
  const both = [darby, index]
  it('finds sections of both authors by passage, Darby first', () => {
    expect(full(searchCompanion(both, 'col 1:20'))).toEqual(['coates:colossians/2', 'coates:colossians/1', 'coates:colossians/3'])
    expect(full(searchCompanion(both, 'Romans 15'))).toEqual(['darby:romans/1', 'coates:romans/1', 'coates:believer-established/1'])
    expect(full(searchCompanion(both, 'gen'))).toEqual(['darby:genesis/2', 'darby:genesis/3', 'coates:genesis/2', 'coates:genesis/3'])
  })
  it('finds titles by their words, never a title that is a passage', () => {
    expect(ids(searchCompanion(both, 'stand fast'))).toEqual(['believer-established/2'])
    expect(ids(searchCompanion(both, 'nazarite'))).toEqual(['believer-established/3'])
    expect(ids(searchCompanion(both, 'preface'))).toEqual(['introduction/1'])
    expect(searchCompanion(both, 'chapter')).toEqual([])
    expect(searchCompanion(both, '  ')).toEqual([])
  })
  it('knows a passage title and names a work with its series', () => {
    for (const t of ['Chapter 1', 'Chapters 29–35', 'Genesis 6–8', 'Psalm 42 and Psalm 44', 'Romans 15', '1 Timothy 2 (second reading)']) expect(titleIsPassage(t)).toBe(true)
    for (const t of ['The ark and the mercy-seat', 'Adam or Christ', 'Introduction', '“Stand fast”']) expect(titleIsPassage(t)).toBe(false)
    expect(workLine(sectionsFor(darby, 1, 1)[0])).toBe('Synopsis · Genesis')
    expect(workLine({ author: 'coates', work: { id: 'x', title: 'An Outline of Mark’s Gospel', kind: 'outline' }, section: { title: 'Chapter 1', part: 'An Outline of Ezra', passages: [] } })).toBe('An Outline of Mark’s Gospel · An Outline of Ezra')
    expect(AUTHORS.map(a => a.id)).toEqual(['darby', 'coates'])
  })
})
