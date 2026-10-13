import { describe, it, expect } from 'vitest'
import { formatRef } from '../shared/ref'
import { parseSection, sentenceCase, type Block, type IntroSection, type Span } from '../client/src/lib/intro'
import intro from '../data/ccel/intro.json'
import { HAS_TEXTS } from './_texts'

const sections: IntroSection[] = intro.sections.map(s => parseSection(s.title, s.html))
const spansOf = (b: Block): Span[] =>
  b.kind === 'p' ? b.spans
  : b.kind === 'defs' ? b.items.flatMap(i => [...i.term, ...i.def])
  : b.kind === 'refs' ? b.entries.flatMap(e => e.spans)
  : b.kind === 'table' ? b.rows.flatMap(r => r.kind === 'row' ? r.label : [])
  : []
const links = (s: IntroSection) => s.blocks.flatMap(spansOf).filter(x => x.ref)
const text = (sp: Span[]) => sp.map(s => s.text).join('')

describe.skipIf(!HAS_TEXTS)('intro document', () => {
  it('links every reference the notices print', () => {
    // counted by hand from the text; the 1871 preface includes the 154 entries of the Kurios list
    expect(sections.map(s => links(s).length)).toEqual([0, 6, 17, 181, 33])
    const refs = sections[3].blocks.find(b => b.kind === 'refs')!
    expect(spansOf(refs).filter(x => x.ref).length).toBe(154)
  })
  it('drops the capitalised heading that repeats the card title and keeps the others, in sentence case', () => {
    expect(sections.slice(0, 4).map(s => s.blocks[0].kind)).toEqual(['p', 'p', 'p', 'p'])
    expect(sections[4].blocks.slice(0, 3)).toEqual([
      { kind: 'chronology', title: 'Chronological table of the kings and prophets of Judah and Israel', hint: 'Subsequent to the reigns of Saul, David, and Solomon, which were of 40 years each (B.C. 1095–975)' },
      { kind: 'h', text: 'Note on the chronological dates' },
      { kind: 'p', muted: true, spans: [{ text: '(Translated from the French)' }] },
    ])
    expect(sentenceCase('EXTRACT FROM INTRODUCTORY NOTICE TO THE 1890 EDITION OF THE OLD TESTAMENT')).toBe('Extract from introductory notice to the 1890 edition of the Old Testament')
  })
  it('sets the names of God as a definition list', () => {
    const defs = sections[1].blocks.find(b => b.kind === 'defs')
    expect(defs?.kind === 'defs' && defs.items.map(i => [text(i.term), i.term[0].italic, text(i.def)])).toEqual([['Elohim', true, '‘God’'], ['Eloah', true, '‘+God’'], ['El', true, '‘·God’']])
  })
  it('sets the Kurios passages one book per entry, the book named in full and dropped from the text', () => {
    const refs = sections[3].blocks.find(b => b.kind === 'refs')
    if (refs?.kind !== 'refs') throw new Error('no refs block')
    expect(refs.entries.map(e => e.book)).toEqual(['Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Hebrews', 'James', '1 Peter', '2 Peter', 'Jude', 'Revelation'])
    const mark = refs.entries[1].spans
    expect(text(mark)).toBe('i. 3; xi. 3 (?), 9; xii. 11, 29 bis, 30, 36; xiii. 20; xvi. 20 (?)')
    expect(mark[0]).toEqual({ text: 'i. 3', ref: { book: 41, chapter: 1, v1: 3 } })
    expect(mark.find(s => s.text === 'bis')?.italic).toBe(true)
  })
  it('sets the year summary as a two-column table with its sum rules', () => {
    const t = sections[4].blocks.find(b => b.kind === 'table')
    if (t?.kind !== 'table') throw new Error('no table')
    expect(t.head).toBe('Years')
    const rows = t.rows.map(r => r.kind === 'rule' ? (r.double ? '====' : '----') : `${r.total ? '= ' : ''}${text(r.label)} | ${r.value}`)
    expect(rows).toEqual([
      'From the creation to the flood, when Noah was 600 years old (Gen. 5. 3–29; 7. 11) | 1,656',
      'From the flood to the birth of Terah (Gen. 11. 10–25) | 222',
      'When his father died at the age of 205 years, Abraham was 75 | 130',
      '----',
      '= Which fixes his birth, from the creation of the world | 2,008',
      'His entrance into the land of Canaan took place 75 years later (Gen. 12. 4) | 75',
      'Up to the exodus from Egypt (Gen. 15. 13, 16; Ex. 12. 40) | 430',
      'Up to the building of the temple 480 years later | 480',
      'Length of Solomon’s reign, less three years already past (1 Kings 6. 1) | 37',
      'Kings of Israel and Judah, up to the Babylonish captivity | 370',
      'Length of the captivity 70 years, and up to Nehemiah 80 years | 150',
      'Sixty-nine ‘weeks’ less 33 years (Dan. 9. 26) | 450',
      '----',
      '= From the creation to the birth of the Messiah | 4,000',
      '====',
    ])
    const first = t.rows[0]
    expect(first.kind === 'row' && first.label.filter(s => s.ref).map(s => formatRef(s.ref!))).toEqual(['Genesis 5:3-29', 'Genesis 7:11'])
  })
  it('turns footnote markers into callers with their notes', () => {
    const s = sections[3]
    expect(s.notes.map(n => n.id)).toEqual(['1', '2'])
    expect(text(s.notes[1].spans)).toMatch(/^For this reason there are only two tenses/)
    const p = s.blocks.find(b => b.kind === 'p' && b.spans.some(x => x.note === '2'))
    if (p?.kind !== 'p') throw new Error('no caller')
    const i = p.spans.findIndex(x => x.note === '2')
    expect(p.spans[i].text).toBe('²')
    expect(p.spans[i - 1].text.endsWith('accomplished act.')).toBe(true)
    expect(p.spans[i + 1].text.startsWith(' And as the latter')).toBe(true)
  })
  it('keeps italics, sets sigla, dashes and typographic quotes', () => {
    const all = sections.flatMap(s => s.blocks.flatMap(spansOf))
    expect(all.filter(s => s.italic).map(s => s.text)).toContain('Keri')
    const plain = text(all)
    expect(plain).not.toMatch(/\{aleph\}|--|'|<|>/)
    expect(plain).toContain('ℵ and B, as well as C L U Γ, all interpolate')
    expect(plain).toContain('Mr. Darby’s French Bible')
    expect(plain).toContain('Romans XV. 12, 13:')
    expect(plain).toContain('ix. 31 (?)')
    expect(plain).toContain('in I Cor. xv. 49')
  })
})
