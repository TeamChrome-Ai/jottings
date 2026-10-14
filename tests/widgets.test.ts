// The home-screen widgets' decisions, on a Denver phone (UTC-6 in summer, UTC-7 in winter). Vitest runs each file in
// its own process, and Node re-reads TZ when it is assigned, so this does not reach the other files.
process.env.TZ = 'America/Denver'
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { appUrl } from '@shared/brand'
import type { StreakInfo } from '@shared/types'
import { VOTD_REFS, votdFor } from '@shared/votd'
import { HAS_TEXTS } from './_texts'

// theme.ts imports Platform for its font helpers; the colours need none of it
vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'android', select: (o: Record<string, unknown>) => o.android } }))
const { LOGIN_URL, READ_URL, VERSE_GAP, VERSE_PAD, VERSE_REF_LINE, streakCard, verseCard, verseFit, widgetThemes } = await import('../client/src/widgets/model')

/** The same chapters the app bundles, from the web build's copy. */
const chapter = (b: number, c: number) => JSON.parse(readFileSync(resolve(__dirname, `../client/public/bible/${b}/${c}.json`), 'utf8'))
/** The first day of 2026 whose verse is `ref` ("b:c:v"). */
function dayOf(ref: string): Date {
  expect(VOTD_REFS).toContain(ref)
  for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) {
    const r = votdFor(d)
    if (`${r.book}:${r.chapter}:${r.v1}${r.v2 ? `-${r.v2}` : ''}` === ref) return new Date(d)
  }
  throw new Error(`${ref} falls on no day of 2026`)
}

describe('verse of the day widget', () => {
  it.skipIf(!HAS_TEXTS)('shows the day’s verse from the bundled text, and opens the reader at it', () => {
    const card = verseCard(dayOf('43:3:16'), chapter)
    expect(card.label).toBe('John 3:16')
    expect(card.text).toBe('For God so loved the world, that he gave his only-begotten Son, that whosoever believes on him may not perish, but have life eternal.')
    expect(card.url).toBe(appUrl('read/43/3?v=16'))
    expect(card.a11y).toBe(`Today’s verse, John 3:16. ${card.text} Open the chapter`)
  })

  it.skipIf(!HAS_TEXTS)('joins a verse range, opens it as a sentence, and links the whole range', () => {
    const card = verseCard(dayOf('23:40:28-29'), chapter)
    expect(card.label).toBe('Isaiah 40:28-29')
    expect(card.text).toMatch(/^Dost thou not know, .* fainteth not nor tireth\? There is no searching of his understanding\. He giveth power to the faint;/)
    expect(card.url).toBe(appUrl('read/23/40?v=28&v2=29'))
    // a verse that continues a sentence in Darby is capitalised on its own
    expect(verseCard(dayOf('23:40:31'), chapter).text).toMatch(/^But they that wait upon Jehovah/)
  })

  it.skipIf(!HAS_TEXTS)('turns at the phone’s midnight, not UTC’s', () => {
    const day = dayOf('43:3:16')
    const lastSecond = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59)
    const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0, 0, 0)
    // 18:00 in Denver is already the next day in UTC: still the same verse
    const evening = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 18, 0)
    expect(evening.getUTCDate()).not.toBe(evening.getDate())
    expect(verseCard(evening, chapter).label).toBe('John 3:16')
    expect(verseCard(lastSecond, chapter).label).toBe('John 3:16')
    expect(verseCard(midnight, chapter).label).not.toBe('John 3:16')
    expect(verseCard(midnight, chapter).ref).toEqual(votdFor(midnight))
  })

  it('names the reference when the text is missing (no bundle)', () => {
    const card = verseCard(dayOf('43:3:16'), () => null)
    expect(card.text).toBe('')
    expect(card.a11y).toBe('Today’s verse, John 3:16. Open the chapter')
  })
})

describe('verse sizing', () => {
  const box = (height: number) => height - 2 * VERSE_PAD - VERSE_REF_LINE - VERSE_GAP - 4
  it('sets a short verse at the hero size on a 4 × 2 widget', () => {
    expect(verseFit(350, 190, 60)).toEqual({ fontSize: 22, lineHeight: 31, maxLines: 4 })
  })

  it('steps down for a longer verse and ends in an ellipsis past the smallest size', () => {
    const john316 = 133
    const mid = verseFit(350, 190, john316)
    expect(mid.fontSize).toBeLessThan(22)
    expect(mid.fontSize).toBeGreaterThan(15)
    const long = verseFit(250, 110, 420) // the 3 × 2 minimum, a three-verse reading
    expect(long.fontSize).toBe(15)
    expect(long.maxLines).toBe(2)
  })

  it('never cuts a line through and always shows one', () => {
    for (const [w, h] of [[180, 110], [250, 110], [350, 190], [420, 260], [180, 60]]) {
      for (const chars of [20, 133, 300, 600]) {
        const f = verseFit(w, h, chars)
        expect(f.maxLines).toBeGreaterThanOrEqual(1)
        if (box(h) >= f.lineHeight) expect(f.maxLines * f.lineHeight).toBeLessThanOrEqual(box(h))
      }
    }
  })

  it('never shrinks the text as the widget grows', () => {
    let last = 0
    for (let h = 110; h <= 400; h += 10) { const f = verseFit(300, h, 250); expect(f.fontSize).toBeGreaterThanOrEqual(last); last = f.fontSize }
  })
})

const day = (date: string, met: 0 | 1 = 1, active_seconds = met ? 700 : 40) => ({ date, active_seconds, pages: 0, met })
const info = (over: Partial<StreakInfo>): StreakInfo => ({ current: 0, longest: 0, today_active_seconds: 0, today_goal_seconds: 600, days: [], ...over })
// Saturday 26 September 2026, 19:30 in Denver (already the 27th in UTC)
const SAT_EVENING = new Date('2026-09-27T01:30:00Z')

describe('reading streak widget', () => {
  it('asks a signed-out phone (or one with nothing synced) to sign in, and opens the login', () => {
    expect(streakCard(null, SAT_EVENING)).toEqual({ kind: 'signed-out', text: 'Sign in to keep a streak', url: LOGIN_URL, a11y: 'Reading streak. Sign in to keep a streak' })
    expect(LOGIN_URL).toBe(appUrl('login'))
  })

  it('shows a kept day with the solid seal', () => {
    const s = info({ today: '2026-09-26', current: 5, longest: 9, today_active_seconds: 700, days: [day('2026-09-26'), day('2026-09-25'), day('2026-09-24')] })
    expect(streakCard(s, SAT_EVENING)).toMatchObject({ kind: 'streak', current: 5, tone: 'kept', state: 'Read today', url: READ_URL, a11y: 'Reading streak, 5 days. Read today. Open the reader' })
  })

  it('counts the minutes still to read, rounded up', () => {
    const s = info({ today: '2026-09-26', current: 4, today_active_seconds: 530, days: [day('2026-09-26', 0, 530), day('2026-09-25')] })
    const card = streakCard(s, SAT_EVENING)
    expect(card).toMatchObject({ tone: 'waiting', state: '2 min left', a11y: 'Reading streak, 4 days. 2 minutes left today. Open the reader' })
    expect(streakCard({ ...s, today_active_seconds: 599 }, SAT_EVENING)).toMatchObject({ state: '1 min left', a11y: 'Reading streak, 4 days. 1 minute left today. Open the reader' })
    // no goal in the cache: no count to give
    expect(streakCard({ ...s, today_goal_seconds: 0 }, SAT_EVENING)).toMatchObject({ tone: 'waiting', state: 'Still to read today' })
  })

  it('on a kept day short of the reader’s own goal, says how far there is to go', () => {
    const s = info({ today: '2026-09-26', current: 5, longest: 9, today_active_seconds: 700, days: [day('2026-09-26'), day('2026-09-25')] })
    // 11 min 40 s read of 30: the seal is kept, the line counts down
    expect(streakCard(s, SAT_EVENING, undefined, 30)).toMatchObject({ current: 5, tone: 'kept', state: '19 min to your goal', a11y: 'Reading streak, 5 days. Read today. 19 minutes to your goal. Open the reader' })
    expect(streakCard({ ...s, today_active_seconds: 1741 }, SAT_EVENING, undefined, 30)).toMatchObject({ tone: 'kept', state: '1 min to your goal', a11y: 'Reading streak, 5 days. Read today. 1 minute to your goal. Open the reader' })
    expect(streakCard({ ...s, today_active_seconds: 1800 }, SAT_EVENING, undefined, 30)).toMatchObject({ tone: 'kept', state: 'Read today' })
    // the default goal, given or not, is the card as it has always been
    expect(streakCard(s, SAT_EVENING, undefined, 10)).toEqual(streakCard(s, SAT_EVENING))
    expect(streakCard(s, SAT_EVENING)).toMatchObject({ state: 'Read today' })
  })
  it('never counts the reader’s own goal before the day is kept, or into the streak', () => {
    const s = info({ today: '2026-09-26', current: 4, today_active_seconds: 530, days: [day('2026-09-26', 0, 530), day('2026-09-25')] })
    for (const goal of [15, 30, 60]) expect(streakCard(s, SAT_EVENING, undefined, goal)).toEqual(streakCard(s, SAT_EVENING))
    expect(streakCard(s, SAT_EVENING, undefined, 60)).toMatchObject({ current: 4, tone: 'waiting', state: '2 min left' })
  })

  it('carries a run over midnight and starts the new day from the whole goal', () => {
    // synced at 23:50 on Friday with Friday met; drawn by the midnight alarm on Saturday
    const s = info({ today: '2026-09-25', current: 3, today_active_seconds: 700, days: [day('2026-09-25'), day('2026-09-24'), day('2026-09-23')] })
    expect(streakCard(s, new Date(2026, 8, 25, 23, 59, 59))).toMatchObject({ current: 3, tone: 'kept' })
    expect(streakCard(s, new Date(2026, 8, 26, 0, 0, 0))).toMatchObject({ current: 3, tone: 'waiting', state: '10 min left' })
  })

  it('shows a missed day as a lapse without the app running', () => {
    // last synced on Thursday with Thursday met; Friday was never read
    const s = info({ today: '2026-09-24', current: 6, longest: 6, today_active_seconds: 700, days: [day('2026-09-24'), day('2026-09-23')] })
    expect(streakCard(s, SAT_EVENING)).toMatchObject({ current: 0, tone: 'lapsed', state: 'Start again today', a11y: 'Reading streak, 0 days. Start again today. Open the reader' })
  })

  it('invites a first streak when no day was ever met', () => {
    expect(streakCard(info({ today: '2026-09-26' }), SAT_EVENING)).toMatchObject({ current: 0, tone: 'none', state: 'Start a streak today' })
  })

  it('draws this week from the Lord’s day, with today marked and the days to come ahead', () => {
    const s = info({ today: '2026-09-26', current: 2, today_active_seconds: 700, days: [day('2026-09-26'), day('2026-09-25'), day('2026-09-23', 0), day('2026-09-20'), day('2026-09-19')] })
    const card = streakCard(s, SAT_EVENING, 'en-GB')
    if (card.kind !== 'streak') throw new Error('expected a streak')
    expect(card.week.map(d => d.date)).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'])
    expect(card.week.map(d => d.letter).join('')).toBe('SMTWTFS')
    expect(card.week.map(d => d.met)).toEqual([true, false, false, false, false, true, true])
    expect(card.week.filter(d => d.today).map(d => d.date)).toEqual(['2026-09-26'])
    expect(card.week.some(d => d.ahead)).toBe(false)
    // on the Lord's day a new week opens: the six days after it are still to come
    const sunday = streakCard(s, new Date(2026, 8, 27, 9, 0))
    if (sunday.kind !== 'streak') throw new Error('expected a streak')
    expect(sunday.week[0]).toMatchObject({ date: '2026-09-27', today: true, met: false })
    expect(sunday.week.slice(1).every(d => d.ahead && !d.met)).toBe(true)
  })
})

describe('widget themes', () => {
  it('follows the reader’s light and dark picks, defaulting to Paper and Slate', () => {
    expect(widgetThemes(null)).toEqual({ light: 'paper', dark: 'slate' })
    expect(widgetThemes({ theme: 'system', themeLight: 'sepia', themeDark: 'black-ember' })).toEqual({ light: 'sepia', dark: 'black-ember' })
  })

  it('puts a theme chosen outright in its own family’s place', () => {
    expect(widgetThemes({ theme: 'mint', themeLight: 'sepia', themeDark: 'nord' })).toEqual({ light: 'mint', dark: 'nord' })
    expect(widgetThemes({ theme: 'midnight', themeLight: 'sepia', themeDark: 'nord' })).toEqual({ light: 'sepia', dark: 'midnight' })
    expect(widgetThemes({ theme: 'black-jade' })).toEqual({ light: 'paper', dark: 'black-jade' })
  })

  it('reads old and unknown values as the app does', () => {
    // the gallery's first ids: `dark` became Slate, chosen outright
    expect(widgetThemes({ theme: 'dark', themeDark: 'nord' })).toEqual({ light: 'paper', dark: 'slate' })
    expect(widgetThemes({ theme: 'light', themeLight: 'mint' })).toEqual({ light: 'paper', dark: 'slate' })
    expect(widgetThemes({ theme: 42, themeLight: 'nope', themeDark: null })).toEqual({ light: 'paper', dark: 'slate' })
  })
})
