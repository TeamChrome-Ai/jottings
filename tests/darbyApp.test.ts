import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { TOTAL_VERSES } from '../shared/verseCounts'
import { DARBY_APP_COLORS, DARBY_APP_ROWS, darbyAppPlace } from '../client/src/lib/darbyApp'

// ids read from the text table of "Darby Bible" by Bible apps for spirit, 5.1.0 (assets/darby.sqlite, texts._id)
const at = (id: number) => { const p = darbyAppPlace(id); return p ? `${p.book}.${p.chapter}.${p.verse ?? 'title'}` : null }

describe('a row of the old Darby Bible app', () => {
  it('is a verse in Bible order, with the Psalm titles as rows of their own', () => {
    expect(TOTAL_VERSES).toBe(31_103)
    expect([at(1), at(22), at(31), at(32)]).toEqual(['1.1.1', '1.1.22', '1.1.31', '1.2.1'])
    // two rows before Psalm 1 (the book of the Psalms opens, then the psalm's title), one before Psalm 2
    expect([at(13940), at(13941), at(13942), at(13943), at(13949), at(13950)]).toEqual(['18.42.17', '19.1.title', '19.1.title', '19.1.1', '19.2.title', '19.2.1'])
    expect([at(14261), at(14599), at(14600), at(16199), at(16550)]).toEqual(['19.23.1', '19.42.title', '19.42.title', '19.119.176', '19.150.title'])
    expect([at(23301), at(26291)]).toEqual(['40.1.1', '43.3.16'])
  })
  it('skips the verses that have no row and ends two chapters a verse sooner', () => {
    expect([at(24087), at(24088)]).toEqual(['40.23.13', '40.23.15'])
    expect([at(27367), at(27368)]).toEqual(['44.8.36', '44.8.38'])
    expect([at(27629), at(27630)]).toEqual(['44.15.33', '44.15.35'])
    expect([at(28397), at(28398)]).toEqual(['45.11.35', '45.12.1'])
    expect([at(31060), at(31061)]).toEqual(['66.12.17', '66.13.1'])
  })
  it('ends at Revelation 22:21 and knows no other id', () => {
    expect(DARBY_APP_ROWS).toBe(31_253)
    expect(at(DARBY_APP_ROWS)).toBe('66.22.21')
    expect([at(0), at(-4), at(DARBY_APP_ROWS + 1), at(1.5), at(NaN)]).toEqual([null, null, null, null, null])
  })
  it('reads its highlight numbers as the colours it shows', () => {
    expect([1, 2, 3, 4, 5].map(n => DARBY_APP_COLORS[n])).toEqual(['blue', 'yellow', 'pink', 'green', 'yellow'])
  })
  // the whole table, when a copy of it is at hand: DARBY_APP_MAP=<json of [book, chapter, verse or 0 for a title] per id>
  it.skipIf(!process.env.DARBY_APP_MAP)('agrees with every row of the app\'s table', () => {
    const rows = JSON.parse(fs.readFileSync(process.env.DARBY_APP_MAP!, 'utf8')) as [number, number, number][]
    expect(rows.length).toBe(DARBY_APP_ROWS)
    const wrong = rows.map(([b, c, v], i) => [i + 1, `${b}.${c}.${v || 'title'}`, at(i + 1)] as const).filter(([, want, got]) => want !== got)
    expect(wrong.slice(0, 5)).toEqual([])
  })
})
