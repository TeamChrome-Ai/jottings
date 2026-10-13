// The shipped Bible (client/public/bible, built by `npm run data`) as a reader gets it: the whole text, no verse lost
// or doubled, brackets that close, and every footnote placed with nothing of the scan's index left in its text.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { HAS_TEXTS } from './_texts'

const DIR = join(__dirname, '..', 'client', 'public', 'bible')
interface Note { id: number; marker: string; text: string; pos?: number }
interface Verse { v: number; t: string; notes?: Note[] }
type Chapter = { b: number; c: number; verses: Verse[] }
let books: number[] = [], chapters: Chapter[] = [], verses: (Verse & { ref: string })[] = [], lettered: (Note & { ref: string })[] = []
// read when the tests start, not as the file loads: where the texts are absent nothing is opened (tests/_texts.ts)
beforeAll(() => {
  if (!HAS_TEXTS) return
  books = readdirSync(DIR).filter(d => /^\d+$/.test(d)).map(Number).sort((a, b) => a - b)
  chapters = books.flatMap(b => readdirSync(join(DIR, String(b))).filter(f => /^\d+\.json$/.test(f)).sort((x, y) => parseInt(x) - parseInt(y)).map(f => ({ b, c: parseInt(f), verses: (JSON.parse(readFileSync(join(DIR, String(b), f), 'utf8')) as { verses: Verse[] }).verses })))
  verses = chapters.flatMap(ch => ch.verses.map(v => ({ ...v, ref: `${ch.b}.${ch.c}.${v.v}` })))
  lettered = verses.flatMap(v => (v.notes ?? []).filter(n => /^[a-z]$/.test(n.marker)).map(n => ({ ...n, ref: v.ref })))
})

describe.skipIf(!HAS_TEXTS)('the shipped text', () => {
  it('is 66 books, 1,189 chapters and 31,103 verses, each chapter numbered from 1 without a gap', () => {
    expect([books.length, chapters.length, verses.length]).toEqual([66, 1189, 31103])
    for (const ch of chapters) expect(ch.verses.map(v => v.v), `${ch.b}.${ch.c}`).toEqual(ch.verses.map((_, i) => i + 1))
  })
  it('leaves empty only the three verses Mr. Darby omits', () => {
    expect(verses.filter(v => !v.t.trim()).map(v => v.ref)).toEqual(['40.23.14', '44.8.37', '44.15.34'])
  })
  it('closes every bracket within its chapter', () => {
    const open: string[] = []
    for (const ch of chapters) {
      const t = ch.verses.map(v => v.t).join(' ')
      for (const [o, c] of [['(', ')'], ['[', ']']]) {
        let depth = 0, under = false
        for (const x of t) { if (x === o) depth++; else if (x === c && --depth < 0) under = true }
        if (depth || under) open.push(`${ch.b}.${ch.c} ${o}${c}`)
      }
    }
    expect(open).toEqual([])
  })
})

describe.skipIf(!HAS_TEXTS)('the footnotes', () => {
  it('are the 1961 edition’s notes at every place the scan gives (8,834 notes at 9,666 places)', () => {
    expect(lettered.length).toBe(9666)
  })
  it('carry nothing of the scan’s index (“#13:1 south. (b-23)”)', () => {
    expect(lettered.filter(n => /#\d+:\d+|\([a-z*+°]-\d+\)/.test(n.text)).map(n => `${n.ref} ${n.marker}`)).toEqual([])
  })
  it('close their brackets', () => {
    expect(lettered.filter(n => n.text.split('(').length !== n.text.split(')').length || n.text.split('[').length !== n.text.split(']').length).map(n => `${n.ref} ${n.marker}`)).toEqual([])
  })
  it('stand inside their verse', () => {
    // the reader's words (client/src/lib/bible.ts tokenize): runs of ASCII letters, digits and apostrophes
    const out = verses.flatMap(v => (v.notes ?? []).filter(n => (n.pos ?? 0) > (v.t.match(/[A-Za-z0-9'’]+/g)?.length ?? 0)).map(n => `${v.ref} ${n.marker}`))
    expect(out).toEqual([])
  })
})
