// The verse notifications' decisions, on a Denver phone: the stored pref in both its shapes, the 14 mornings per item,
// which verse of a book a day gets, what each notice says, the top-up rule and the Settings wording. Vitest runs each
// file in its own process, so the TZ assignment stays here.
process.env.TZ = 'America/Denver'
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { votdFor } from '@shared/votd'
import { formatRef } from '@shared/ref'
import { BOOKS } from '@shared/books'
import { HAS_TEXTS } from './_texts'

// widgets/model reaches theme.ts, which imports Platform for its font helpers; nothing here needs it
vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android } }))
const { ANY_BOOK, NO_PATH_LABEL, PATH_BOOK, PATH_LABEL, VERSE_MAX_CHARS, VERSE_MIN_CHARS, VERSE_NOTIFY_MAX_ITEMS, VERSE_NOTIFY_PREFIX, bookLabel, bookVerses, localDayNumber, needsTopUp, readVerseNotify, trimVerse, usableVerse, verseInBook, verseNotice, verseNotices, verseNotifyDates, verseNotifyDetail, verseItemDetail } = await import('../client/src/lib/verseNotifyPlan')

const chapter = (b: number, c: number) => JSON.parse(readFileSync(resolve(__dirname, `../client/public/bible/${b}/${c}.json`), 'utf8'))
const local = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]
const PSALMS = 19, JOHN = 43, MATTHEW = 40, GENESIS = 1

describe('the stored pref', () => {
  it('reads the list shape, dropping bad items and unknown books', () => {
    expect(readVerseNotify({ items: [{ book: 19, hour: 6, minute: 0 }, { book: 43, hour: 7, minute: 30 }] })).toEqual({ items: [{ book: 19, hour: 6, minute: 0 }, { book: 43, hour: 7, minute: 30 }] })
    expect(readVerseNotify({ items: [{ book: 99, hour: 6, minute: 0 }, { book: 1, hour: 24, minute: 0 }, { book: 2, hour: 6, minute: 60 }, 'x', null] })).toEqual({ items: [{ book: 0, hour: 6, minute: 0 }] })
    expect(readVerseNotify({ items: [] })).toEqual({ items: [] })
  })
  it('migrates versionCode 31’s switch: on becomes one Any-book item at its time, off or missing becomes none', () => {
    expect(readVerseNotify({ enabled: true, hour: 7, minute: 15 })).toEqual({ items: [{ book: ANY_BOOK, hour: 7, minute: 15 }] })
    expect(readVerseNotify({ enabled: true, hour: 31, minute: 0 })).toEqual({ items: [{ book: ANY_BOOK, hour: 6, minute: 0 }] })
    expect(readVerseNotify({ enabled: false, hour: 7, minute: 15 })).toEqual({ items: [] })
    expect(readVerseNotify(undefined)).toEqual({ items: [] })
    expect(readVerseNotify('nonsense')).toEqual({ items: [] })
  })
  it.skipIf(!HAS_TEXTS)('keeps at most four items (iOS holds 64 pending notifications: 14 × 4)', () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ book: i + 1, hour: 6 + i, minute: 0 }))
    expect(VERSE_NOTIFY_MAX_ITEMS).toBe(4)
    expect(readVerseNotify({ items: six }).items).toEqual(six.slice(0, 4))
    expect(verseNotices(new Date(2026, 8, 27, 12, 0), six, chapter)).toHaveLength(14 * 4)
  })
})

describe('the 14 mornings', () => {
  it('starts today when 6:00 is still ahead, tomorrow once it has passed', () => {
    const early = verseNotifyDates(new Date(2026, 8, 27, 5, 59), 6, 0)
    expect(early).toHaveLength(14)
    expect(local(early[0])).toEqual([2026, 8, 27, 6, 0])
    const late = verseNotifyDates(new Date(2026, 8, 27, 6, 0), 6, 0)
    expect(local(late[0])).toEqual([2026, 8, 28, 6, 0])
    expect(local(late[13])).toEqual([2026, 9, 11, 6, 0])
  })
  it('is one per calendar day at the chosen local time, across a month end and the autumn clock change', () => {
    // 2026-11-01 02:00 Denver: clocks go back, so that day is 25 hours long; the morning is still 6:30 by the clock
    const dates = verseNotifyDates(new Date(2026, 9, 25, 12, 0), 6, 30)
    for (const d of dates) { expect(d.getHours()).toBe(6); expect(d.getMinutes()).toBe(30) }
    const days = new Set(dates.map(d => `${d.getMonth()}-${d.getDate()}`))
    expect(days.size).toBe(14)
    expect(local(dates[5])).toEqual([2026, 9, 31, 6, 30])
    expect(local(dates[6])).toEqual([2026, 10, 1, 6, 30])
    expect(dates[6].getTime() - dates[5].getTime()).toBe(25 * 3600_000)
  })
  it.skipIf(!HAS_TEXTS)('schedules 14 × items, each item at its own time with its own identifier, sorted by firing time', () => {
    const now = new Date(2026, 8, 27, 12, 0)
    const notices = verseNotices(now, [{ book: PSALMS, hour: 6, minute: 0 }, { book: JOHN, hour: 7, minute: 0 }, { book: ANY_BOOK, hour: 6, minute: 30 }], chapter)
    expect(notices).toHaveLength(42)
    expect(new Set(notices.map(n => n.identifier)).size).toBe(42)
    for (let i = 1; i < notices.length; i++) expect(notices[i].at.getTime()).toBeGreaterThanOrEqual(notices[i - 1].at.getTime())
    const byItem = (i: number) => notices.filter(n => n.identifier.startsWith(`${VERSE_NOTIFY_PREFIX}${i}-`))
    expect(byItem(0)).toHaveLength(14); expect(byItem(1)).toHaveLength(14); expect(byItem(2)).toHaveLength(14)
    for (const n of byItem(0)) { expect(local(n.at).slice(3)).toEqual([6, 0]); expect(n.title.startsWith('Psalm')).toBe(true); expect(n.identifier).toBe(`${VERSE_NOTIFY_PREFIX}0-${n.at.getTime()}`) }
    for (const n of byItem(1)) { expect(local(n.at).slice(3)).toEqual([7, 0]); expect(n.title.startsWith('John ')).toBe(true) }
    for (const n of byItem(2)) { expect(local(n.at).slice(3)).toEqual([6, 30]); expect(n.title).toBe(formatRef(votdFor(n.at))) }
    expect(verseNotices(now, [], chapter)).toEqual([])
  })
})

describe('a verse from one book', () => {
  it('keeps a verse that stands alone and skips fragments, over-long verses and genealogies', () => {
    expect(usableVerse('Jehovah is my shepherd; I shall not want.')).toBe(true)
    expect(usableVerse('And he died.')).toBe(false)
    expect(usableVerse('x'.repeat(VERSE_MIN_CHARS - 1))).toBe(false)
    expect(usableVerse('word '.repeat(VERSE_MAX_CHARS / 5 + 2))).toBe(false)
    expect(usableVerse('And Seth lived a hundred and five years, and begot Enosh.')).toBe(false)
    expect(usableVerse('Abraham begat Isaac; and Isaac begat Jacob, and Jacob begat Juda and his brethren;')).toBe(false)
    expect(usableVerse('Book of the generation of Jesus Christ, Son of David, Son of Abraham, the son of Terah, the son of Nahor, the son of Serug.')).toBe(false)
    // three names with no "son of" is a narrative, not a list
    expect(usableVerse('Then Peter and John went up together into the temple at the hour of prayer, with Jesus.')).toBe(true)
  })
  it.skipIf(!HAS_TEXTS)('walks the book in canonical order: the usable verses, each once, chapter by chapter', () => {
    const vs = bookVerses(JOHN, chapter)
    expect(vs.length).toBeGreaterThan(500)
    for (let i = 1; i < vs.length; i++) expect(vs[i].chapter > vs[i - 1].chapter || (vs[i].chapter === vs[i - 1].chapter && vs[i].v > vs[i - 1].v)).toBe(true)
    for (const v of vs) expect(usableVerse(v.t)).toBe(true)
    expect(vs.some(v => v.chapter === 3 && v.v === 16)).toBe(true)
    // Matthew's first chapter is a genealogy: none of 1:2-16 survives
    expect(bookVerses(MATTHEW, chapter).filter(v => v.chapter === 1 && v.v >= 2 && v.v <= 16)).toEqual([])
    // Genesis 5: the begot/begotten lines go; "all the days of Adam ... and he died" is a sentence and stays
    expect(bookVerses(GENESIS, chapter).filter(v => v.chapter === 5 && /\bbeg[ao]t\b/.test(v.t))).toEqual([])
  })
  it.skipIf(!HAS_TEXTS)('is the same verse all day, the next verse the next day, and comes round again after the last', () => {
    const vs = bookVerses(PSALMS, chapter)
    const a = verseInBook(PSALMS, new Date(2026, 8, 27, 0, 0), chapter)!
    expect(verseInBook(PSALMS, new Date(2026, 8, 27, 23, 59), chapter)).toEqual(a)
    const b = verseInBook(PSALMS, new Date(2026, 8, 28, 6, 0), chapter)!
    const ia = vs.indexOf(a), ib = vs.indexOf(b)
    expect(ib).toBe((ia + 1) % vs.length)
    expect(verseInBook(PSALMS, new Date(2026, 8, 27 + vs.length, 6, 0), chapter)).toEqual(a)
    expect(localDayNumber(new Date(2026, 8, 27, 23, 59)) - localDayNumber(new Date(2026, 8, 27, 0, 0))).toBe(0)
    expect(localDayNumber(new Date(2026, 8, 28, 0, 0)) - localDayNumber(new Date(2026, 8, 27, 23, 59))).toBe(1)
  })
  it.skipIf(!HAS_TEXTS)('has something usable in every one of the 66 books', () => {
    for (const b of BOOKS) expect(bookVerses(b.n, chapter).length, b.name).toBeGreaterThan(0)
  })
})

describe('what a morning says', () => {
  it.skipIf(!HAS_TEXTS)('Any book: carries that day’s verse of the day, the reference as the title, the text as the body, the chapter as the route', () => {
    const at = new Date(2026, 8, 30, 6, 0)
    const n = verseNotice(at, chapter)
    const ref = votdFor(at)
    expect(n.title).toBe(formatRef(ref))
    expect(n.body.length).toBeGreaterThan(10)
    expect(n.body.length).toBeLessThanOrEqual(240)
    expect(n.url).toBe(`/read/${ref.book}/${ref.chapter}?v=${ref.v1}${ref.v2 ? `&v2=${ref.v2}` : ''}`)
    expect(n.identifier).toBe(`${VERSE_NOTIFY_PREFIX}0-${at.getTime()}`)
    expect(n.at).toBe(at)
  })
  it.skipIf(!HAS_TEXTS)('a chosen book: that day’s verse of the book, capitalised, with its own route', () => {
    const at = new Date(2026, 8, 30, 7, 0)
    const n = verseNotice(at, chapter, JOHN, 1)
    const bv = verseInBook(JOHN, at, chapter)!
    expect(n.title).toBe(formatRef({ book: JOHN, chapter: bv.chapter, v1: bv.v }))
    expect(n.url).toBe(`/read/${JOHN}/${bv.chapter}?v=${bv.v}`)
    expect(n.body.charAt(0)).toBe(n.body.charAt(0).toUpperCase())
    expect(n.body.length).toBeLessThanOrEqual(240)
    expect(n.identifier).toBe(`${VERSE_NOTIFY_PREFIX}1-${at.getTime()}`)
  })
  it.skipIf(!HAS_TEXTS)('is the verse the widget shows that day, for every one of the 14', () => {
    const notices = verseNotices(new Date(2026, 8, 27, 12, 0), [{ book: ANY_BOOK, hour: 6, minute: 0 }], chapter)
    expect(notices).toHaveLength(14)
    for (const n of notices) expect(n.title).toBe(formatRef(votdFor(n.at)))
    // 6:00 in Denver is 12:00 or 13:00 UTC: the same day either way, but a late evening would not be
    const evening = verseNotices(new Date(2026, 8, 27, 12, 0), [{ book: ANY_BOOK, hour: 23, minute: 30 }], chapter)
    for (const n of evening) expect(n.title).toBe(formatRef(votdFor(new Date(n.at.getFullYear(), n.at.getMonth(), n.at.getDate()))))
  })
  it('keeps a short verse whole and cuts a long one at a word', () => {
    expect(trimVerse('For God so loved the world.')).toBe('For God so loved the world.')
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')
    const t = trimVerse(long, 100)
    expect(t.length).toBeLessThanOrEqual(100)
    expect(t.endsWith('…')).toBe(true)
    expect(t.slice(0, -1)).toMatch(/word\d+$/)
    expect(trimVerse('a long line, ending in a comma, here', 32)).toBe('a long line, ending in a comma…')
  })
  it('falls back to an invitation when the chapter cannot be read', () => {
    const none = () => null
    const n = verseNotice(new Date(2026, 8, 30, 6, 0), none)
    expect(n.body).toBe('Open today’s verse')
    expect(n.title).toBe(formatRef(votdFor(new Date(2026, 8, 30))))
    const b = verseNotice(new Date(2026, 8, 30, 6, 0), none, JOHN)
    expect(b.body).toBe('Open today’s verse')
    expect(b.url).toBe(`/read/${JOHN}/1`)
  })
})

describe('the top-up rule', () => {
  const now = new Date(2026, 8, 27, 12, 0)
  const ahead = (n: number) => Array.from({ length: n }, (_, i) => new Date(2026, 8, 28 + i, 6, 0))
  it('leaves a full queue alone and rebuilds a short one', () => {
    expect(needsTopUp(ahead(14), now)).toBe(false)
    expect(needsTopUp(ahead(7), now)).toBe(false)
    expect(needsTopUp(ahead(6), now)).toBe(true)
    expect(needsTopUp([], now)).toBe(true)
  })
  it('counts only mornings still ahead, as numbers or dates, and a morning with several items once', () => {
    const past = Array.from({ length: 10 }, (_, i) => new Date(2026, 8, 17 + i, 6, 0).getTime())
    expect(needsTopUp([...past, ...ahead(3)], now)).toBe(true)
    expect(needsTopUp([...past, ...ahead(7).map(d => d.getTime())], now)).toBe(false)
    const twoItems = [...ahead(5), ...ahead(5).map(d => new Date(d.getTime() + 3600_000))]
    expect(needsTopUp(twoItems, now)).toBe(true)
  })
})

describe('the Settings row', () => {
  it('names one book at its time, two by short name, three or more as a count from the earliest, or says Off', () => {
    expect(verseNotifyDetail({ items: [] })).toBe('Off')
    expect(verseNotifyDetail({ items: [{ book: PSALMS, hour: 6, minute: 0 }] })).toBe('Psalms at 06:00')
    expect(verseNotifyDetail({ items: [{ book: ANY_BOOK, hour: 18, minute: 5 }] })).toBe('Any book at 18:05')
    expect(verseNotifyDetail({ items: [{ book: PSALMS, hour: 6, minute: 0 }, { book: JOHN, hour: 7, minute: 0 }] })).toBe('Ps at 06:00, John at 07:00')
    expect(verseNotifyDetail({ items: [{ book: PSALMS, hour: 7, minute: 0 }, { book: JOHN, hour: 6, minute: 30 }, { book: ANY_BOOK, hour: 8, minute: 0 }] })).toBe('3 books, from 06:30')
    expect(verseItemDetail({ book: JOHN, hour: 7, minute: 0 })).toBe('Every morning at 07:00')
  })
})

describe('the path item (docs/PATHS.md: "Your path")', () => {
  const GOSPELS = { id: 'gospels' as const, started_at: '2026-09-01T00:00:00Z', target_date: null, pace_per_week: null, with_ministry: false }
  const at = new Date(2026, 8, 28, 6, 0)
  it('is stored as book -1 and survives the loose read; an unknown book still falls back to Any book', () => {
    expect(PATH_BOOK).toBe(-1)
    expect(readVerseNotify({ items: [{ book: PATH_BOOK, hour: 6, minute: 0 }, { book: -2, hour: 7, minute: 0 }] })).toEqual({ items: [{ book: PATH_BOOK, hour: 6, minute: 0 }, { book: ANY_BOOK, hour: 7, minute: 0 }] })
    // the older shape knows nothing of paths and still migrates as before
    expect(readVerseNotify({ enabled: true, hour: 6, minute: 0 })).toEqual({ items: [{ book: ANY_BOOK, hour: 6, minute: 0 }] })
  })
  it.skipIf(!HAS_TEXTS)('the morning is the next portion: "Mark 4 · The Gospels", the chapter’s first verse, the chapter as the route', () => {
    const n = verseNotice(at, chapter, PATH_BOOK, 0, { path: GOSPELS, next: { book: 41, chapter: 4 } })!
    expect(n.title).toBe('Mark 4 · The Gospels')
    expect(n.body).toBe(chapter(41, 4).verses[0].t)
    expect(n.url).toBe('/read/41/4')
    expect(n.identifier).toBe(`${VERSE_NOTIFY_PREFIX}0-${at.getTime()}`)
  })
  it.skipIf(!HAS_TEXTS)('a path with a ministry portion notices the chapter only (the `then` is read, not announced)', () => {
    const n = verseNotice(at, chapter, PATH_BOOK, 0, { path: { ...GOSPELS, id: 'synopsis', with_ministry: true }, next: { book: 1, chapter: 1, then: [{ author: 'darby', work: 'genesis', n: 1 }] } })!
    expect(n.title).toBe('Genesis 1 · With Darby’s Synopsis')
    expect(n.url).toBe('/read/1/1')
  })
  it.skipIf(!HAS_TEXTS)('no path: the item schedules nothing, and other items are untouched', () => {
    expect(verseNotice(at, chapter, PATH_BOOK, 0, null)).toBeNull()
    const notices = verseNotices(new Date(2026, 8, 27, 12, 0), [{ book: PATH_BOOK, hour: 6, minute: 0 }, { book: 19, hour: 7, minute: 0 }], chapter, undefined, null)
    expect(notices).toHaveLength(14)
    expect(notices.every(n => n.identifier.startsWith(`${VERSE_NOTIFY_PREFIX}1-`))).toBe(true)
  })
  it.skipIf(!HAS_TEXTS)('with a path: 14 mornings, each naming the same next chapter until a credit reschedules', () => {
    const notices = verseNotices(new Date(2026, 8, 27, 12, 0), [{ book: PATH_BOOK, hour: 6, minute: 0 }], chapter, undefined, { path: GOSPELS, next: { book: 40, chapter: 3 } })
    expect(notices).toHaveLength(14)
    expect(new Set(notices.map(n => n.title))).toEqual(new Set(['Matthew 3 · The Gospels']))
  })
  it('a finished path says so once', () => {
    const n = verseNotice(at, chapter, PATH_BOOK, 0, { path: GOSPELS, next: null })!
    expect(n.title).toBe('The Gospels · finished')
  })
  it('the row: "Your path", or "Your path · no path started" while none is on', () => {
    expect(bookLabel(PATH_BOOK)).toBe(PATH_LABEL)
    expect(bookLabel(PATH_BOOK, 'full', false)).toBe(NO_PATH_LABEL)
    expect(bookLabel(PATH_BOOK, 'abbr', true)).toBe('Your path')
  })
})
