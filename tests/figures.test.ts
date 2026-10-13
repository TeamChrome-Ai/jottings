import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { formatPassage } from '../shared/companion'
import { alone, blockText, entriesOf, isEntry, pagesOf, parallelsOf, refOfPassage, seeOf, tableWidths, type ChartFigure, type DiagramFigure, type ParallelEntry, type ParallelsFigure, type TableFigure } from '../shared/figures'
import type { MinistrySection } from '../shared/ministry'
import { HAS_CONVERTERS, HAS_TEXTS } from './_texts'

const ROOT = path.resolve(__dirname, '..')
const work = (id: string) => JSON.parse(readFileSync(path.join(ROOT, 'data/ministry/darby', `${id}.json`), 'utf8')) as { sections: MinistrySection[] }
let sections: MinistrySection[], order: MinistrySection, fig: ParallelsFigure, byN: ReturnType<typeof entriesOf>
// read when the tests start, not as the file loads: where the texts are absent nothing is opened (tests/_texts.ts)
beforeAll(() => {
  if (!HAS_TEXTS) return
  sections = work('cw-expository-4').sections
  order = sections.find(s => s.title === 'Relative order of three synoptical Gospels')!
  fig = order.figures![0] as ParallelsFigure
  byN = entriesOf(fig)
})
const entry = (n: number) => byN.get(n)!
/** "Mark 6:30–44", as the reader would open it. */
const where = (e: ParallelEntry) => formatPassage(e.passage!)

describe.skipIf(!HAS_TEXTS)('Relative order of three synoptical Gospels (Collected Writings 25:28–36)', () => {
  it('is the edition’s table: 238 passages in three columns, Matthew 1–73, Mark 74–137, Luke 138–238', () => {
    expect(fig.kind).toBe('parallels')
    expect(fig.columns).toEqual([{ title: 'Matthew', book: 40 }, { title: 'Mark', book: 41 }, { title: 'Luke', book: 42 }])
    const entries = fig.items.filter(isEntry)
    expect(entries.length).toBe(238)
    expect(entries.map(e => e.n).sort((a, b) => a - b)).toEqual(Array.from({ length: 238 }, (_, i) => i + 1))
    expect([0, 1, 2].map(c => entries.filter(e => e.col === c).length)).toEqual([73, 64, 101])
    expect(pagesOf(fig).map(p => p.page)).toEqual([28, 29, 30, 31, 32, 33, 34, 35, 36])
    // the column notes, where the page prints them
    expect(fig.items.filter(it => !isEntry(it)).map(it => 'note' in it && it.note)).toEqual([
      'All this is either only in Luke or items from various parts of the history put morally together.',
      'Only in Luke', 'Here history resumed. Last scene begins.', '(See John’s Gospel.)',
    ])
  })

  it('keeps the introduction above it and no note of a chart removed anywhere', () => {
    expect(order.text.startsWith('The Gospels of Matthew, Mark and Luke are arranged in three parallel columns')).toBe(true)
    expect(order.text.endsWith('See Mark 16:14; and 1 Corinthians 15.')).toBe(true)
    expect(order.figures![0].after).toBeUndefined()
    for (const s of sections) expect(s.text).not.toMatch(/chart was removed/i)
  })

  it('points the feeding of the five thousand at itself in all three Gospels', () => {
    const [m, k, l] = [entry(29), entry(94), entry(167)]
    expect([where(m), where(k), where(l)]).toEqual(['Matthew 14:13–21', 'Mark 6:30–44', 'Luke 9:10–17'])
    expect(seeOf(m)).toEqual([94, 167])
    expect(seeOf(k)).toEqual([29, 167])
    expect(seeOf(l)).toEqual([29, 94])
    expect(parallelsOf(fig, m, byN).map(c => c.map(e => e.n))).toEqual([[], [94], [167]])
    expect(refOfPassage(k.passage!)).toEqual({ book: 41, chapter: 6, v1: 30, v2: 44 })
  })

  it('reads the references as the columns print them', () => {
    expect([1, 5, 10, 42, 75, 139, 237].map(n => [entry(n).ref, where(entry(n))])).toEqual([
      ['1:1–17', 'Matthew 1:1–17'],
      ['3', 'Matthew 3'],                        // "3:", the chapter
      ['5, 6, 7', 'Matthew 5–7'],                // "5, 6, 7:–", the sermon on the mount
      ['19:27–20:19', 'Matthew 19:27–20:19'],
      ['1:12, 13', 'Mark 1:12–13'],
      ['1:26–80', 'Luke 1:26–80'],
      ['24:50, 51', 'Luke 24:50–51'],
    ])
    expect(refOfPassage(entry(10).passage!)).toEqual({ book: 40, chapter: 5 })
    // Matthew 57 prints no reference (the rest of chapters 24 and 25)
    expect(entry(57).passage).toBeNull()
  })

  it('corrects the page’s misprints and keeps what it printed', () => {
    expect([entry(131).ref, entry(131).printed]).toEqual(['16:5–7', '17:5–7'])      // Mark has 16 chapters
    expect([entry(199).ref, entry(199).printed]).toEqual(['14:25–35', '14:15–35'])  // 198 is 14:15–24
    expect(entry(76).parts[0]).toMatchObject({ see: [7, 146], printed: [76, 146] }) // Mark 76 pointing at itself
  })

  it('keeps the small figures with the words they go with, and 0 for no parallel', () => {
    expect(entry(7).parts).toEqual([
      { see: [76], text: 'After John in prison—' },
      { see: [146], text: 'leaves Nazareth—' },
      { see: [0], text: 'to dwell in Capernaum.' },
    ])
    expect(alone(entry(1))).toBe(true)
    expect(alone(entry(20))).toBe(true)                 // no figures printed
    expect(seeOf(entry(184))).toEqual([21, 87, 220])     // Luke 12:8–12 points within Luke too
    expect(parallelsOf(fig, entry(184), byN).map(c => c.map(e => e.n))).toEqual([[21], [87], [220]])
  })

  it.skipIf(!HAS_CONVERTERS)('is what the converter makes of the transcription, which holds together', () => {
    const out = execFileSync('python3', ['-c', [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))})`,
      'import ministry_convert as m, coates_convert as cac',
      'cac.VERSES.update(cac.verse_counts())',
      'cols, items, problems = m.read_parallels(m.FIGURES_DIR / m.FIGURES[0]["file"])',
      'print(json.dumps({"problems": problems, "items": items}, ensure_ascii=False))',
    ].join('\n')], { encoding: 'utf8' })
    const r = JSON.parse(out) as { problems: string[]; items: unknown[] }
    expect(r.problems).toEqual([])
    expect(r.items).toEqual(fig.items)
  })
})

describe.skipIf(!HAS_TEXTS)('Compared view of the first three Gospels', () => {
  it('is one paper across two volumes: Part 1 closes Expository 3, Part 2 opens Expository 4, each naming the other', () => {
    const p1 = work('cw-expository-3').sections.at(-1)!
    const p2 = sections[0]
    expect(p1.title).toBe('Compared view of the first three Gospels, etc. — Part 1')
    expect(p2.title).toBe('Compared view of the first three Gospels, etc. — Part 2')
    expect(p1.text.startsWith('Part 1.\n\nI apprehend that the Gospel of Mark')).toBe(true)
    expect(p2.text.startsWith('Part 2.\n\nI now turn to Luke.')).toBe(true)
    expect(p1.subtitle).toMatch(/Collected Writings 25/)
    expect(p2.subtitle).toMatch(/Collected Writings 24/)
  })
})

const sectionOf = (id: string, title: string) => work(id).sections.find(s => s.title === title)!
const figure = <T,>(id: string, title: string, fid: string) => sectionOf(id, title).figures!.find(f => f.id === fid) as T

describe.skipIf(!HAS_TEXTS)('the figures of the rest of the corpus (data/ministry/FIGURES.md)', () => {
  it.skipIf(!HAS_CONVERTERS)('reads every transcription without a problem', () => {
    const out = execFileSync('python3', ['-c', [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools'))})`,
      'import ministry_convert as m, coates_convert as cac',
      'cac.VERSES.update(cac.verse_counts())',
      'bad = []',
      'for spec in m.FIGURES + m.names_specs():',
      '    p = m.FIGURES_DIR / spec["file"]',
      '    if spec["kind"] == "parallels": bad += m.read_parallels(p)[2]',
      '    elif spec["kind"] == "table": bad += m.read_table(p)[1]',
      '    elif spec["kind"] == "tables": bad += m.read_tables(p)[2]',
      '    else: json.loads(p.read_text())',
      'print(json.dumps({"n": len(m.FIGURES) + len(m.names_specs()), "bad": bad}))',
    ].join('\n')], { encoding: 'utf8' })
    const r = JSON.parse(out) as { n: number; bad: string[] }
    expect(r.bad).toEqual([])
    expect(r.n).toBe(36)  // 12 in FIGURES, 24 sections of the index of names
  })

  it('puts back the table BTP printed a cell to a paragraph: Romanists and Protestants (Collected Writings 22:21)', () => {
    const title = 'Familiar conversations on Romanism: The word of God and the church'
    const t = figure<TableFigure>('cw-doctrinal-6', title, 'cw-doctrinal-6-romanists-protestants')
    expect(t.rows.length).toBe(12)
    expect(t.rows[0]).toEqual(['France', '33,000,000', 'Great Britain', '26,000,000'])
    expect(t.foot).toEqual(['', '133,000,000', '', '93,500,000'])
    expect(t.notes).toEqual(['Perhaps more; chiefly in Bavaria, Baden, Rhenish Prussia, and Silesia.'])
    const paras = sectionOf('cw-doctrinal-6', title).text.split('\n\n')
    expect(paras[t.after!].endsWith('in rough round numbers I count them thus:—')).toBe(true)
    expect(paras[t.after! + 1].startsWith('Besides this, there is Canada')).toBe(true)
    expect(paras).not.toContain('33,000,000')
    // the page's note moved from the section's notes to the table, the callers after it renumbered
    expect(sectionOf('cw-doctrinal-6', title).notes!.some(n => n.startsWith('Perhaps more; chiefly in Bavaria'))).toBe(false)
  })

  it('reads Darby’s index of the names of Christ back into tables (Miscellaneous Writings 5)', () => {
    const gospels = figure<TableFigure>('misc-5', 'The names and titles of Christ used in the Gospels and the Acts', '02-the-names-and-titles-of-christ-used-in-the-gospels-and-the-acts-1')
    expect(gospels.columns).toEqual(['', 'Matthew', 'Mark', 'Luke', 'John', 'Acts'])
    expect(gospels.rows[0]).toEqual(['Jesus', '160', '90', '94', '242', '17'])
    expect(gospels.groups!.map(g => g.label)).toContain('Used in quotations.')
    const epistles = figure<TableFigure>('misc-5', 'Names and titles of Christ used in the epistles', '03-names-and-titles-of-christ-used-in-the-epistles-1')
    expect([epistles.columns.length, epistles.rows.length]).toEqual([12, 22])
    const romans = sectionOf('misc-5', 'The names of the Lord in the epistles — Romans')
    expect(romans.text).toBe('')
    expect(romans.figures!.map(f => (f as TableFigure).rows.length)).toEqual([109, 15, 15])
    expect((romans.figures![1] as TableFigure).foot).toEqual(['Total', '93'])
    const col = sectionOf('misc-5', 'The names of the Lord in the epistles — Colossians').figures![0] as TableFigure
    expect(col.rows).toContainEqual(['The Christ, Jesus the Lord', 'Col. 2:6'])
    expect(col.rows.some(r => r[0] === 'Col.')).toBe(false)
    // the heading's slip set right, and the section back in its paper
    expect(sectionOf('misc-5', 'The names of the Lord in the epistles — 2 Thessalonians').part).toBe('The names of the Lord in the epistles')
  })

  it('transcribes the two charts of the Revelation (Collected Writings 2:261–265)', () => {
    const notes = sectionOf('cw-prophetic-1', 'Notes on the Revelation')
    const [historic, synopsis] = notes.figures as ChartFigure[]
    expect(notes.text.endsWith('The following four pages set out in tabulated form:—')).toBe(true)
    expect([historic.columns.length, historic.bands.length, historic.blocks.length]).toEqual([19, 5, 32])
    expect([synopsis.columns.length, synopsis.bands.length, synopsis.blocks.length]).toEqual([21, 6, 28])
    expect(historic.columns.map(c => c.ref).filter(Boolean)[0]).toBe('Revelation 1')
    const moral = synopsis.blocks.find(b => b.lines[0] === 'Moral account')!
    expect(blockText(moral.lines)[0]).toMatch(/^Moral account of the churches then in existence owned for the last time, but judged, involving the prophetic progress of the church\. She is judged in her hierarchical character/)
    expect(blockText(['Babylon', 'and kings', 'of the earth.', '—', 'Woman rides', 'the beast.'])).toEqual(['Babylon and kings of the earth.', 'Woman rides the beast.'])
  })

  it('redraws the drawings as shapes, the large maps within bounds', () => {
    const map = sectionOf('notes-comments-2', 'Prophetic map').figures![0] as DiagramFigure
    expect(map.kind).toBe('diagram')
    expect(JSON.stringify(map).length).toBeLessThan(200_000)
    expect(map.shapes.filter(s => s.t === 'text').map(s => s.t === 'text' && s.text)).toContain('Antichrist')
    const num = sectionOf('notes-comments-2', 'Numbers chapter 33')
    expect(num.figures!.map(f => f.id)).toEqual(['notes-comments-2-numbers-33-journeyings', 'notes-comments-2-numbers-35-suburbs'])
    expect(num.text.split('\n\n')).not.toContain('/')
    expect(sectionOf('notes-comments-1', 'Exodus 26').figures![0].id).toBe('notes-comments-1-exodus-26-corners')
  })
})

describe('tableWidths', () => {
  const t = (columns: string[], rows: string[][]) => ({ columns, rows })
  it('gives figures their width and the words the rest, scrolling only when the columns cannot fit', () => {
    const two = tableWidths(t(['Name', 'Number'], [['The Lord Jesus, or Jesus as Lord', '2'], ['Christ', '27']]), 320, 15)
    expect(two.scroll).toBe(false)
    expect(two.widths[0] + two.widths[1]).toBeLessThanOrEqual(320)
    expect(two.widths[1]).toBeLessThan(80)  // "NUMBER" in small capitals
    const wide = tableWidths(t(['Names and titles', ...Array(11).fill('Rom.')], [['Jesus Christ our Lord', ...Array(11).fill('13')]]), 320, 15)
    expect(wide.scroll).toBe(true)
    expect(wide.total).toBeGreaterThan(320)
  })
})

// ---------- the rows of figures in the verse index ----------

import { figureRows, rowSlot } from '../shared/figures'
import { bibleWords, paragraphHits, rankOf, rowHits, ROW_RANK, verseId } from '../shared/ministryIndex'

let bible: ReturnType<typeof bibleWords>
beforeAll(() => {
  if (!HAS_TEXTS) return
  const darby = JSON.parse(readFileSync(path.join(ROOT, 'data/darby.json'), 'utf8')) as { books: { n: number; chapters: { c: number; verses: { v: number; t: string }[] }[] }[] }
  bible = bibleWords(darby.books)
})
const hitsFor = (id: string, title: string) => {
  const s = sectionOf(id, title)
  return figureRows(s.figures!).map((row, k) => ({ row, k, hits: rowHits(row, bible, undefined, s.passages) }))
}

describe.skipIf(!HAS_TEXTS)('figure rows in the verse index', () => {
  it('indexes the names index row for Romans 3:25, as a list after all commentary', () => {
    const rows = hitsFor('misc-5', 'The names of the Lord in the epistles — Romans')
    const r = rows.find(x => x.row.text === 'A Mercy-seat · Rom. 3:25')!
    expect(r.row.reference).toBe(true)
    expect(r.hits).toEqual([{ verse: verseId(45, 3, 25), mention: 'list', rank: ROW_RANK + 1000, start: 15, end: 24 }])
    // its slot is after the section's (empty) text: the row's place among the section's rows
    expect(rowSlot(0, r.k)).toBe(11)
    // the counts tables name no verse and add nothing
    expect(rows.filter(x => x.row.text.startsWith('Christ · 27')).every(x => x.hits.length === 0)).toBe(true)
  })

  it('indexes the harmony’s row for the five thousand for every verse of Mark 6:30–44, with its parallels in the snippet', () => {
    const rows = hitsFor('cw-expository-4', 'Relative order of three synoptical Gospels')
    expect(rows.length).toBe(238)
    const r = rows.find(x => x.hits.some(h => h.verse === verseId(41, 6, 30)))!
    expect(r.row.text).toBe('Mark 6:30–44 · Matthew 14:13–21 · Luke 9:10–17 — (On twelve’s return) goes into desert—feeds 5,000.')
    expect(r.hits.map(h => h.verse)).toEqual(Array.from({ length: 15 }, (_, i) => verseId(41, 6, 30 + i)))
    expect(r.hits[0]).toMatchObject({ mention: 'list', start: 0, end: 'Mark 6:30–44'.length })
    // Matthew 5–7, the sermon on the mount: every verse of the three chapters
    const sermon = rows.find(x => x.row.text.startsWith('Matthew 5, 6, 7'))!
    expect(sermon.hits.length).toBe(48 + 34 + 29)
  })

  it('keeps commentary first: every paragraph’s rank, a list of proofs included, is below a reference row’s', () => {
    expect(rankOf('list', false, 999)).toBeLessThan(ROW_RANK)
    const proofs = paragraphHits('See Mark 6:30; 1:1; 2:3; 3:4; 4:5; 5:6; 7:8; 8:9; 9:10; 10:11; 11:12; 12:13; 13:14; 14:15; 15:16; 16:1; 1:2; 2:4; 3:5; 4:6.', bible)
    const onMark = proofs.hits.find(h => h.verse === verseId(41, 6, 30))!
    expect(onMark.mention).toBe('list')
    expect(rankOf(onMark.mention, false, proofs.refs)).toBeLessThan(ROW_RANK + 1000)
  })

  it('counts an argument table’s rows as single references: Psalm 132’s prayer and answer', () => {
    const rows = hitsFor('notes-jottings', 'Readings on Numbers: 1')
    expect(rows[0].row.reference).toBe(false)
    expect(rows[0].hits.map(h => [h.verse, h.mention])).toEqual([[verseId(19, 132, 9), 'verse'], [verseId(19, 132, 16), 'verse']])
    expect(rows[0].hits.every(h => h.rank < ROW_RANK)).toBe(true)
    // Letters 3: the row names Luke 24:47 and gives its words
    const letter = hitsFor('letters-3', 'To Alex Robertson · October 1st, 1881')[0]
    expect(letter.hits.map(h => [h.verse, h.mention])).toEqual([[verseId(42, 24, 47), 'quote']])
  })

  it('indexes the charts’ columns for their passages', () => {
    const rows = hitsFor('cw-prophetic-1', 'Notes on the Revelation')
    const beast = rows.find(x => x.row.text.startsWith('Revelation 13 — '))!
    expect(beast.hits.length).toBe(18)
    expect(beast.hits.every(h => h.mention === 'list')).toBe(true)
  })
})
