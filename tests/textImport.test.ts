// The King James Version and Young's Literal Translation as imported (data/text_<id>.json, tools/import_text.py):
// every verse of the source in the English Darby's slots, the words only, and the one place where they number
// differently. The edges are eBible's own plain-text file of each (the VPL), a second witness beside the USFM the
// import reads: tests/fixtures/text/edges_<id>.json, written by the import.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { VERSE_COUNTS } from '../shared/verseCounts'
import { HAS_TEXTS } from './_texts'

const ROOT = join(__dirname, '..')
interface Verse { v: number; t: string; h?: string; p?: 1; nv?: number; nc?: number }
interface Text { id: string; lang: string; name: string; source: { verses: number }; books: { n: number; name: string; chapters: { c: number; title?: string; verses: Verse[] }[] }[] }
interface Edges { verses: number; books: { n: number; first: [number, number, string]; last: [number, number, string] }[] }
const IDS = ['kjv', 'ylt'] as const
const texts = {} as Record<typeof IDS[number], Text>, edges = {} as Record<typeof IDS[number], Edges>
// read when the tests start, not as the file loads: where the texts are absent nothing is opened (tests/_texts.ts)
beforeAll(() => {
  if (!HAS_TEXTS) return
  for (const id of IDS) {
    texts[id] = JSON.parse(readFileSync(join(ROOT, `data/text_${id}.json`), 'utf8')) as Text
    edges[id] = JSON.parse(readFileSync(join(ROOT, `tests/fixtures/text/edges_${id}.json`), 'utf8')) as Edges
  }
})
const verse = (id: typeof IDS[number], b: number, c: number, v: number) => texts[id].books[b - 1].chapters[c - 1].verses[v - 1]
const all = (id: typeof IDS[number]) => texts[id].books.flatMap(b => b.chapters.flatMap(ch => ch.verses.map(v => ({ ...v, ref: `${b.n}.${ch.c}.${v.v}` }))))

describe.skipIf(!HAS_TEXTS || !existsSync(join(ROOT, 'tests/fixtures/text')))('the texts read beside Darby, as imported', () => {
  it.each(IDS)('%s is an English Bible that is not the English Bible: its id is not its language', id => {
    expect([texts[id].id, texts[id].lang]).toEqual([id, 'en'])
  })
  it.each(IDS)('%s fills the 66 books, 1,189 chapters and 31,103 verses of the English Darby, in order', id => {
    expect(texts[id].books.map(b => b.chapters.map(ch => ch.verses.length))).toEqual(VERSE_COUNTS)
    for (const b of texts[id].books) for (const ch of b.chapters) expect(ch.verses.map(v => v.v), `${b.n}.${ch.c}`).toEqual(ch.verses.map((_, i) => i + 1))
  })
  it.each(IDS)('%s has every verse of its source, 31,102, and no slot left empty: one verse lies over two of Darby’s', id => {
    expect(texts[id].source.verses).toBe(31102)
    expect(edges[id].verses).toBe(31102)
    expect(all(id).filter(v => !v.t.trim()).map(v => v.ref)).toEqual([])
  })
  it.each(IDS)('%s begins and ends each book as eBible’s plain-text file of it does', id => {
    expect(edges[id].books.length).toBe(66)
    for (const { n, first, last } of edges[id].books) {
      expect(verse(id, n, first[0], first[1]).t, `book ${n} first`).toBe(first[2])
      // Revelation's last verse is in the last slot; no book ends on the verse that is split
      const ch = texts[id].books[n - 1].chapters[last[0] - 1]
      expect(ch.verses[ch.verses.length - 1].t, `book ${n} last`).toBe(last[2])
    }
  })
  it.each(IDS)('%s holds the words only: no markup, no Strong’s number, no paragraph mark, no note', id => {
    const bad = all(id).filter(v => /[\\|¶<>{}]|strong=|\b[GH]\d{3,5}\b/.test(v.t) || (v.h !== undefined && v.h.replace(/<\/?i>/g, '') !== v.t))
    expect(bad.map(v => v.ref)).toEqual([])
  })
  it.each(IDS)('%s shows the three verses Darby omits as it has them', id => {
    for (const [b, c, v] of [[40, 23, 14], [44, 8, 37], [44, 15, 34]]) expect(verse(id, b, c, v).t.length, `${b}.${c}.${v}`).toBeGreaterThan(20)
  })

  // the one place either text and Darby number differently: Darby's Revelation 12:18 is the opening of their 13:1
  it.each(IDS)('%s numbers “And I stood upon the sand of the sea” as its own 13:1, in Darby’s 12:18', id => {
    const [a, b] = [verse(id, 66, 12, 18), verse(id, 66, 13, 1)]
    expect(a.t).toBe('And I stood upon the sand of the sea,')
    expect([a.nc, a.nv]).toEqual([13, 1])
    expect([b.nc, b.nv]).toEqual([undefined, undefined])
    expect(b.t.startsWith('and ')).toBe(true)
    // nothing else carries a number of its own
    expect(all(id).filter(v => v.nv !== undefined || v.nc !== undefined).map(v => v.ref)).toEqual(['66.12.18'])
  })
  it('the King James Version’s 13:1 is whole across the two slots', () => {
    expect(`${verse('kjv', 66, 12, 18).t} ${verse('kjv', 66, 13, 1).t}`).toBe('And I stood upon the sand of the sea, and saw a beast rise up out of the sea, having seven heads and ten horns, and upon his horns ten crowns, and upon his heads the name of blasphemy.')
  })

  it('reads John 3:16 and Psalm 23:1 as the sources do', () => {
    expect(verse('kjv', 43, 3, 16).t).toBe('For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.')
    expect(verse('ylt', 43, 3, 16).t).toBe('for God did so love the world, that His Son — the only begotten — He gave, that every one who is believing in him may not perish, but may have life age-during.')
    expect(verse('kjv', 19, 23, 1).t).toBe('The LORD is my shepherd; I shall not want.')
    expect(verse('kjv', 19, 23, 1).h).toBe('The LORD <i>is</i> my shepherd; I shall not want.')
    // Young prints a psalm's title in its first verse and marks a supplied word with brackets: both as the source has them
    expect(verse('ylt', 19, 23, 1).t).toBe('A Psalm of David. Jehovah [is] my shepherd, I do not lack,')
  })
  it('keeps the King James Version’s psalm titles as chapter titles; Young’s stay in his first verses', () => {
    expect(texts.kjv.books[18].chapters[2].title).toBe('A Psalm of David, when he fled from Absalom his son.')
    expect(texts.kjv.books[18].chapters.filter(ch => ch.title).length).toBe(116)
    expect(texts.ylt.books[18].chapters.filter(ch => ch.title).length).toBe(0)
  })
})
