import { describe, it, expect } from 'vitest'
import type { LibraryAuthor, MinistrySection } from '../shared/ministry'
import {
  cleanseAuthor, cleanseContents, cleanseLetterMeta, cleanseSection, collectionHidden, isSubheading, notesHidden, remapPara, stripBraces,
  stripCallers, stripCallersAt, subheadingIndices,
} from '../shared/cleanse'
import { cleanseRows, groupFromRows, worksInOrder, type RefsRow } from '../client/src/lib/offlineMinistryCore'
import { authorShown, hasChronology, noticeSections, peekCleanse, peekEdition, setCleanseState, setEditionState, withEdition } from '../client/src/lib/editionCore'

describe('the rules (shared/cleanse.ts, the same as rs/src/cleanse.rs)', () => {
  it('names the hidden collections and the noteless ones', () => {
    expect(['other', 'misc', 'letters', 'synopsis', 'cw'].map(collectionHidden)).toEqual([true, true, false, false, false])
    expect(['cw', 'notes-comments', 'notes-jottings', 'synopsis', 'letters', 'other'].map(notesHidden)).toEqual([true, true, true, false, false, false])
  })
  it('knows a sub-heading and renumbers the paragraphs past it', () => {
    expect(isSubheading('<i>Creation with man as head: God’s work and God’s rest</i>')).toBe(true)
    expect(isSubheading('<i>Partly</i> italic')).toBe(false)
    expect(isSubheading('Plain')).toBe(false)
    expect(subheadingIndices('<i>A</i>\n\nOne\n\n<i>B</i>\n\nTwo\n\n\n\nThree')).toEqual([0, 2])
    expect([0, 1, 2, 3, 4].map(i => remapPara(i, [0, 2]))).toEqual([null, 0, null, 1, 2])
  })
  it('takes the callers out and moves a span with them', () => {
    expect(stripCallers('[1] When a man[2] speaks.[3] More')).toBe(' When a man speaks. More')
    const plain = 'Compare verses 14–18 of the chapter.[1] See John 3:16.[2]'
    const at = plain.indexOf('John 3:16')
    const r = stripCallersAt(plain, at, at + 9)
    expect(r.text).toBe('Compare verses 14–18 of the chapter. See John 3:16.')
    expect(r.text.slice(r.start, r.end)).toBe('John 3:16')
    // a caller after the span moves nothing
    expect(stripCallersAt('See John 3:16.[2]', 4, 13)).toEqual({ text: 'See John 3:16.', start: 4, end: 13 })
  })
  it('takes the braces out', () => {
    expect(stripBraces('Words {Christian Friend 1893.} here.\n\n{Ed.} Next')).toBe('Words here.\n\nNext')
    expect(stripBraces('Nothing to do')).toBe('Nothing to do')
  })
  it('drops a letter\'s topics and keeps its recipient and title (Hodgett\'s list, credited)', () => {
    const m = { title: 'To B. & S. Plymouth · Dublin, May, 1832', subtitle: 'Prayer; Union', passages: [], date: 'Dublin, May, 1832', to: 'B. & S. Plymouth' }
    expect(cleanseLetterMeta(m)).toEqual({ title: 'To B. & S. Plymouth · Dublin, May, 1832', passages: [], date: 'Dublin, May, 1832', to: 'B. & S. Plymouth' })
    const c = cleanseContents({ author: 'darby', work: { id: 'letters-1', title: 'Letters 1', kind: 'letters', collection: 'letters' }, sections: [m] })
    expect(c.sections[0].title).toBe('To B. & S. Plymouth · Dublin, May, 1832')
    expect('subtitle' in c.sections[0]).toBe(false)
  })
  it('cleanses a section by its collection', () => {
    const syn: MinistrySection = { title: 'Genesis 1', passages: [[1, 1, 1, 1, 31]], text: '<i>Creation</i>\n\nIn the beginning.[1]\n\n<i>Rest</i>\n\nGod rested.', notes: ['A note of the Synopsis.'] }
    const s = cleanseSection(syn, 'synopsis', 1)
    expect(s.text).toBe('In the beginning.[1]\n\nGod rested.')
    expect(s.notes).toEqual(['A note of the Synopsis.'])
    const cw: MinistrySection = { title: 'On John 3', passages: [], text: '[1] God so loved.[2] Compare verses.', notes: ['One', 'Two'] }
    const c = cleanseSection(cw, 'cw', 1)
    expect(c.text).toBe('God so loved. Compare verses.')
    expect(c.notes).toBeUndefined()
    const letter: MinistrySection = { title: 'To G. V. Wigram · Pau, 1876', subtitle: 'Topics', passages: [], text: 'Dear brother, [1876]', date: 'Pau, 1876', to: 'G. V. Wigram' }
    expect(cleanseSection(letter, 'letters', 3)).toEqual({ title: 'To G. V. Wigram · Pau, 1876', passages: [], text: 'Dear brother, [1876]', date: 'Pau, 1876', to: 'G. V. Wigram' })
    const other: MinistrySection = { title: 'Deliverance', passages: [], text: '{Christian Friend vol. 12.} Words here.' }
    expect(cleanseSection(other, 'other', 1).text).toBe('Words here.')
    // nothing to change: the same object
    const plain: MinistrySection = { title: 'Plain', passages: [], text: 'Text.' }
    expect(cleanseSection(plain, 'notes-comments', 1)).toBe(plain)
  })
})

const darby: LibraryAuthor = { id: 'darby', name: 'J. N. Darby', short: 'Darby', born: 1800, died: 1882, source: 'Darby source', collections: [
  { id: 'synopsis', title: 'Synopsis', works: [{ id: 'genesis', title: 'Genesis', kind: 'outline', count: 1 }] },
  { id: 'cw', title: 'Collected Writings', works: [{ id: 'cw-doctrinal-1', title: 'Doctrinal 1', kind: 'papers', count: 1 }] },
  { id: 'letters', title: 'Letters', works: [{ id: 'letters-1', title: 'Letters 1', kind: 'letters', count: 1 }] },
  { id: 'other', title: 'Other writings', works: [{ id: 'other-x', title: 'X', kind: 'papers', count: 1 }] },
] }
const sections: Record<string, MinistrySection> = {
  'genesis/1': { title: 'Genesis 1', passages: [[1, 1, 1, 1, 31]], text: '<i>Creation</i>\n\nIn the beginning (Genesis 1:1).\n\n<i>Heading on Genesis 1:1</i>\n\nAnd God said (Genesis 1:3).' },
  'cw-doctrinal-1/1': { title: 'On John 3', passages: [], text: 'God so loved[1] the world (John 3:16).', notes: ['See John 3:16 again.'] },
  'letters-1/1': { title: 'To G. V. Wigram · Pau, 1876', passages: [], text: 'Read John 3:16.', date: 'Pau, 1876', to: 'G. V. Wigram' },
  'other-x/1': { title: 'X', passages: [], text: 'John 3:16 here too.' },
}
const read = async (work: string, n: number) => sections[`${work}/${n}`] ?? null
// rows: [verse, rank, work, n, para, note, start, end]; works in pack order: genesis 0, cw-doctrinal-1 1, letters-1 2, other-x 3
const rows: RefsRow[] = [
  [16, 1_001_000, 1, 1, 0, 0, 27, 36],   // the cw paragraph, its reference after the caller
  [16, 11_001_000, 1, 1, 0, 1, 4, 13],   // the cw footnote
  [16, 11_001_000, 2, 1, 0, 0, 5, 14],   // the letter
  [16, 11_001_000, 3, 1, 0, 0, 0, 9],    // the hidden work
]
const genesisRows: RefsRow[] = [
  [1, 11_001_000, 0, 1, 1, 0, 18, 29],   // a paragraph after one sub-heading
  [1, 11_001_000, 0, 1, 2, 0, 11, 22],   // the sub-heading itself
  [3, 11_001_000, 0, 1, 3, 0, 14, 25],   // after two sub-headings
]

describe('the offline layer under the cleanse', () => {
  it('drops the rows into hidden material and keeps the works order whole', () => {
    expect(worksInOrder(darby).map(w => w.id)).toEqual(['genesis', 'cw-doctrinal-1', 'letters-1', 'other-x'])
    expect(cleanseRows(rows, darby)).toEqual([rows[0], rows[2]])
    expect(cleanseAuthor(darby).collections.map(c => c.id)).toEqual(['synopsis', 'cw', 'letters'])
    const once = cleanseAuthor(darby)
    expect(cleanseAuthor(once)).toBe(once)
  })
  it('answers a verse without the hidden work, the footnote or the callers; the letter keeps its title', async () => {
    const plain = await groupFromRows(darby, rows, [16], 1, read)
    expect(plain.total).toBe(4)
    expect(plain.items.map(i => i.snippet)).toEqual(['God so loved[1] the world (John 3:16).', 'See John 3:16 again.', 'Read John 3:16.', 'John 3:16 here too.'])
    const g = await groupFromRows(darby, rows, [16], 1, read, true)
    expect(g.total).toBe(2)
    expect(g.items.map(i => [i.work.id, i.section, i.snippet, i.snippet.slice(...i.hl)])).toEqual([
      ['cw-doctrinal-1', 'On John 3', 'God so loved the world (John 3:16).', 'John 3:16'],
      ['letters-1', 'To G. V. Wigram · Pau, 1876', 'Read John 3:16.', 'John 3:16'],
    ])
  })
  it('renumbers the Synopsis’s paragraphs past its sub-headings and drops a row into one', async () => {
    const plain = await groupFromRows(darby, genesisRows, [1, 3], 1, read)
    expect(plain.items.map(i => i.para)).toEqual([1, 2, 3])
    const g = await groupFromRows(darby, genesisRows, [1, 3], 1, read, true)
    expect(g.total).toBe(2)
    expect(g.items.map(i => [i.para, i.snippet.slice(...i.hl)])).toEqual([[0, 'Genesis 1:1'], [1, 'Genesis 1:3']])
  })
})

describe('the flag in the app', () => {
  it('is off by default, hides Coates and the table when on, and marks the reads', () => {
    expect(peekCleanse()).toBe(false)
    expect(withEdition('/ministry', '1961')).toBe('/ministry?ed=1961')
    expect(setCleanseState(true)).toBe(true)
    expect([peekCleanse(), peekEdition()]).toEqual([true, '1890'])
    expect([authorShown('coates'), authorShown('darby'), hasChronology('1961'), hasChronology('1890')]).toEqual([false, true, false, false])
    expect(noticeSections('1961', { sections: [{ title: 'Introductory notice (1961)', html: '' }, { title: 'Preface to the 1871 edition', html: '' }] }, null).map(s => s.title)).toEqual(['Preface to the 1871 edition'])
    expect(withEdition('/ministry', '1890')).toBe('/ministry?ed=1890&cl=1')
    expect(withEdition('/me', '1890')).toBe('/me')
    expect(setCleanseState(true)).toBe(false)
    // undo: everything as before
    setCleanseState(false); setEditionState('1961')
    expect([peekCleanse(), authorShown('coates'), hasChronology('1961')]).toEqual([false, true, true])
    expect(withEdition('/ministry', '1961')).toBe('/ministry?ed=1961')
  })
})
