import { describe, it, expect } from 'vitest'
import type { LibraryAuthor, MinistrySection } from '../shared/ministry'
import {
  authorPaths, companionIndexFrom, companionWorksOf, deriveStatus, formatBytes, groupFromRows, libraryFromStored, notePlain, packTotal, parseListing,
  parseStoredAuthor, progressOf, refsFromStored, statusDetail, versesOfRows, worksInOrder, type PackAuthor, type RefsRow, type StoredAuthor,
} from '../client/src/lib/offlineMinistryCore'

const darbyPack: PackAuthor = { id: 'darby', name: 'J. N. Darby', short: 'Darby', version: 'v1', bytes: 15_000_000, rawBytes: 52_000_000, sections: 2, refs: true, refsBytes: 1_000_000, works: [{ id: 'cw-doctrinal-1', bytes: 40_000_000, sections: 2 }, { id: 'letters-1', bytes: 12_000_000, sections: 0 }] }
const darby: LibraryAuthor = { id: 'darby', name: 'J. N. Darby', short: 'Darby', born: 1800, died: 1882, source: 'Darby source', collections: [
  { id: 'cw', title: 'Collected Writings', works: [{ id: 'cw-doctrinal-1', title: 'Collected Writings 3: Doctrinal 1', kind: 'papers', count: 2 }] },
  { id: 'letters', title: 'Letters', works: [{ id: 'letters-1', title: 'Letters 1', kind: 'letters', count: 0 }] },
] }
const coates: LibraryAuthor = { id: 'coates', name: 'C. A. Coates', short: 'Coates', born: 1862, died: 1945, source: 'Coates source', collections: [
  { id: 'outlines', title: 'Outlines', works: [{ id: 'romans', title: 'An Outline of Romans', kind: 'outline', count: 1 }] },
  { id: 'addresses', title: 'Addresses', works: [{ id: 'believer', title: 'The Believer Established', kind: 'addresses', count: 3 }] },
] }
const stored = (author: LibraryAuthor, refs = true): StoredAuthor => ({ version: 'v1', bytes: 1, rawBytes: 52_000_000, sections: 2, refs, author, downloadedAt: 0 })

describe('the server listing', () => {
  it('reads the listing and refuses anything else', () => {
    expect(parseListing({ authors: [darbyPack] })).toEqual({ authors: [darbyPack] })
    expect(parseListing({ authors: [darbyPack, { id: 'x' }] })?.authors.map(a => a.id)).toEqual(['darby'])
    expect(parseListing('<html>')).toBeNull()
    expect(parseListing({})).toBeNull()
  })
  it('totals the works and the index when it rides along', () => {
    expect(packTotal(darbyPack)).toBe(53_000_000)
    expect(packTotal({ ...darbyPack, refs: false })).toBe(52_000_000)
  })
  it('measures progress in the listing bytes, never past 1', () => {
    expect(progressOf(0, 0, 100)).toBe(0)
    expect(progressOf(40, 10, 100)).toBe(0.5)
    expect(progressOf(90, 20, 100)).toBe(1)
    expect(progressOf(0, -5, 100)).toBe(0)
    expect(progressOf(0, 0, 0)).toBe(0)
  })
})

describe('the phone\'s files', () => {
  it('puts an author under ministry/<author>/ with the marker last', () => {
    const p = authorPaths('darby')
    expect(p.dir).toEqual(['ministry', 'darby'])
    expect(p.marker).toEqual(['ministry', 'darby', 'author.json'])
    expect(p.work('cw-doctrinal-1')).toEqual(['ministry', 'darby', 'works', 'cw-doctrinal-1.json'])
    expect(p.refs(43)).toEqual(['ministry', 'darby', 'refs', '43.json'])
    expect(p.companion).toEqual(['ministry', 'darby', 'companion.json'])
  })
  it('reads a marker and refuses a broken one', () => {
    expect(parseStoredAuthor(stored(darby))).toEqual(stored(darby))
    expect(parseStoredAuthor({ version: 'v1' })).toBeNull()
    expect(parseStoredAuthor(null)).toBeNull()
  })
  it('makes a library of the stored authors in registry order', () => {
    expect(libraryFromStored([])).toBeNull()
    expect(libraryFromStored([stored(coates), stored(darby)])?.authors.map(a => a.id)).toEqual(['darby', 'coates'])
  })
  it('knows the companion\'s works: Darby\'s Synopsis, all of Coates', () => {
    expect(companionWorksOf(darby)).toEqual([])
    expect(companionWorksOf({ ...darby, collections: [{ id: 'synopsis', title: 'Synopsis', works: [{ id: 'genesis', title: 'Genesis', kind: 'outline', count: 1 }] }, ...darby.collections] })).toEqual(['genesis'])
    expect(companionWorksOf(coates)).toEqual(['romans', 'believer'])
    const idx = companionIndexFrom([{ author: 'coates', work: { id: 'romans', title: 'An Outline of Romans', kind: 'outline', collection: 'outlines' }, sections: [{ title: 'Chapter 8', passages: [[45, 8, 1, 8, 0]] }] }])
    expect(idx.works).toEqual([{ id: 'romans', title: 'An Outline of Romans', kind: 'outline', sections: [{ title: 'Chapter 8', passages: [[45, 8, 1, 8, 0]] }] }])
  })
})

describe('a row\'s status', () => {
  it('is downloading while in flight, stored with the marker, none otherwise', () => {
    expect(deriveStatus(null, null)).toEqual({ kind: 'none' })
    expect(deriveStatus(stored(darby), 0.43)).toEqual({ kind: 'downloading', fraction: 0.43 })
    expect(deriveStatus(stored(darby), null, darbyPack)).toEqual({ kind: 'stored', bytes: 52_000_000, version: 'v1', refs: true })
    expect(deriveStatus(stored(darby), null, { version: 'v2' })).toMatchObject({ kind: 'stored', stale: true })
  })
  it('formats sizes and the detail line', () => {
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB')
    expect(formatBytes(52_000_000)).toBe('50 MB')
    expect(formatBytes(820 * 1024)).toBe('820 KB')
    expect(statusDetail({ kind: 'none' }, darbyPack)).toBe('Download · 14 MB')
    expect(statusDetail({ kind: 'none' }, null)).toBe('Download · needs a connection')
    expect(statusDetail({ kind: 'none' }, undefined)).toBe('Download')
    expect(statusDetail({ kind: 'downloading', fraction: 0.434 }, darbyPack)).toBe('Downloading… 43%')
    expect(statusDetail({ kind: 'stored', bytes: 52_000_000, version: 'v1', refs: true }, darbyPack)).toBe('On this phone · 50 MB')
    expect(statusDetail({ kind: 'stored', bytes: 52_000_000, version: 'v0', refs: true, stale: true }, darbyPack)).toBe('On this phone · 50 MB · update available')
  })
})

describe('Ministry on a verse from the stored index', () => {
  // the rows rs/src/ministry.rs's fixture yields for John 3 (verse, rank, work, n, para, note, start, end[, row text])
  const john3: RefsRow[] = [
    [16, 1_001_000, 0, 1, 0, 0, 24, 33],
    [16, 11_001_000, 0, 1, 1, 1, 4, 13],
    [16, 11_001_000, 0, 2, 0, 0, 36, 45],
    [16, 21_001_000, 0, 1, 1, 0, 8, 25], [17, 21_001_000, 0, 1, 1, 0, 8, 25],
    [16, 32_001_000, 0, 1, 2, -1, 12, 21, 'Whosoever · John 3:16'],
  ]
  const sections: Record<string, MinistrySection> = {
    'cw-doctrinal-1/1': { title: 'On John 3', passages: [[43, 3, 1, 3, 0]], text: 'God so loved the world (John 3:16).\n\nCompare <i>verses</i> 14–18 of the chapter.[1]', notes: ['See John 3:16 again.'] },
    'cw-doctrinal-1/2': { title: 'Letter', passages: [], to: 'G. V. Wigram', text: '> A line of a hymn\n> and its second, John 3:16' },
  }
  const section = async (work: string, n: number) => sections[`${work}/${n}`] ?? null

  it('lists a paragraph once at its best, best first, the figure row last, as the server does', async () => {
    const g = await groupFromRows(darby, john3, [16], 1, section)
    expect(g.total).toBe(5)
    expect(g.items.map(i => [i.n, i.para, i.mention])).toEqual([[1, 0, 'quote'], [1, 1, 'verse'], [2, 0, 'verse'], [1, 1, 'range'], [1, 2, 'list']])
    expect(g.items[0].snippet).toBe('God so loved the world (John 3:16).')
    expect(g.items[0].work).toEqual({ id: 'cw-doctrinal-1', title: 'Collected Writings 3: Doctrinal 1', collection: 'cw' })
    expect(g.items[1].note).toBe(1)
    expect(g.items[1].snippet).toBe('See John 3:16 again.')
    expect(g.items[2].snippet).toBe('A line of a hymn and its second, John 3:16')
    expect(g.items[2].section).toBe('Letter')
    expect(g.items[3].snippet).toBe('Compare verses 14–18 of the chapter.[1]')
    expect(g.items[3].hl).toEqual([8, 25])
    expect(g.items[4]).toMatchObject({ row: true, snippet: 'Whosoever · John 3:16', hl: [12, 21] })
    expect(g.items[0].row).toBeUndefined()
    expect(g).toMatchObject({ author: 'darby', name: 'J. N. Darby', short: 'Darby', source: 'Darby source', page: 1, pages: 1 })
  })
  it('lists a paragraph named for two selected verses once; 17 alone has only the range', async () => {
    expect((await groupFromRows(darby, john3, [16, 17], 1, section)).total).toBe(5)
    const g = await groupFromRows(darby, john3, [17], 1, section)
    expect(g.items.map(i => i.mention)).toEqual(['range'])
  })
  it('pages 20 at a time and clamps to the last page', async () => {
    const many: RefsRow[] = Array.from({ length: 50 }, (_, k) => [16, 11_002_000 + k, 0, 2, k, 0, 0, 9])
    const p1 = await groupFromRows(darby, many, [16], 1, section)
    expect([p1.total, p1.pages, p1.items.length]).toEqual([50, 3, 20])
    const p9 = await groupFromRows(darby, many, [16], 9, section)
    expect([p9.page, p9.items.length]).toEqual([3, 10])
  })
  it('keeps an empty snippet for a section whose file is missing', async () => {
    const g = await groupFromRows(darby, john3, [16], 1, async () => null)
    expect(g.items[0]).toMatchObject({ snippet: '', hl: [0, 0], section: '' })
  })
  it('answers every stored author with something, registry order, or one author\'s page', async () => {
    const authors = [{ author: coates, rows: [] as RefsRow[] }, { author: darby, rows: john3 }]
    const all = await refsFromStored(43, 3, [17, 16, 16], authors, async (_a, w, n) => section(w, n))
    expect(all).toMatchObject({ book: 43, chapter: 3, verses: [16, 17] })
    expect(all.groups.map(g => g.author)).toEqual(['darby'])
    const one = await refsFromStored(43, 3, [16], authors, async (_a, w, n) => section(w, n), 'coates', 1)
    expect(one.groups.map(g => [g.author, g.total])).toEqual([['coates', 0]])
  })
  it('collects the verses of a chapter from every author\'s rows', () => {
    expect([...versesOfRows([john3, null, [[28, 0, 0, 1, 0, 0, 0, 1]]])].sort()).toEqual([16, 17, 28])
  })
  it('reads works in the pack\'s order and a footnote as the server quotes it', () => {
    expect(worksInOrder(coates).map(w => [w.id, w.collection])).toEqual([['romans', 'outlines'], ['believer', 'addresses']])
    expect(notePlain('One\n\nTwo &lt;x&gt;')).toBe('One Two <x>')
  })
})
