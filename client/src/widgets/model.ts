import { BRAND } from '@shared/brand'
import { t, tc, tn } from '@shared/i18n'
import type { StreakInfo } from '@shared/types'
import { formatRef } from '@shared/ref'
import { presentVotd, votdFor, type VotdRef } from '@shared/votd'
import { localDay, streakToday } from '../lib/localDay'
import { DAILY_GOAL_DEFAULT, goalView } from '../lib/dailyGoal'
import { dayLetter, weekOf } from '../lib/week'
import { DARK_DEFAULT, LIGHT_DEFAULT, THEME_MAP, isThemeId, migrateThemeId, type ThemeId } from '../theme'

/**
 * What the home-screen widgets show, as pure decisions: no storage, no clock of their own, no widget API. The Android
 * side (`index.android.ts`) feeds them the device's date, the bundled chapter and the streak cached at the last sync.
 */

/** The app's own scheme (the brand's, as the Expo config's `scheme`); a widget tap opens the route after it. */
const SCHEME = BRAND.scheme
export const LOGIN_URL = `${SCHEME}://login`
/** The Read tab, which continues at the saved position (the streak reminder opens the same). */
export const READ_URL = `${SCHEME}://read`
export const verseUrl = (r: VotdRef) => `${SCHEME}://read/${r.book}/${r.chapter}?v=${r.v1}${r.v2 ? `&v2=${r.v2}` : ''}`

// ---------------- verse of the day ----------------

export interface VerseCard { ref: VotdRef; label: string; text: string; url: string; a11y: string }
type ChapterText = { verses: { v: number; t: string }[] }

/** Today's verse for the device's calendar day `now`, its text from `chapter` (the Bible inside the app). */
export function verseCard(now: Date, chapter: (book: number, chapter: number) => ChapterText | null): VerseCard {
  const ref = votdFor(now)
  const verses = chapter(ref.book, ref.chapter)?.verses.filter(v => v.v >= ref.v1 && v.v <= (ref.v2 ?? ref.v1)) ?? []
  const text = verses.length ? presentVotd(verses.map(v => v.t.trim()).join(' ')) : ''
  const label = formatRef(ref)
  return { ref, label, text, url: verseUrl(ref), a11y: text ? t('Today’s verse, {ref}. {text} Open the chapter', { ref: label, text }) : t('Today’s verse, {ref}. Open the chapter', { ref: label }) }
}

/** The verse widget's frame, in dp: padding all round, the reference line and the gap under it. */
export const VERSE_PAD = 16
export const VERSE_REF_LINE = 20
export const VERSE_GAP = 8
/** Literata's average advance per character of running English, in em, and a margin for words that wrap early. */
const LITERATA_EM = 0.5
const WRAP_SLACK = 1.1
const VERSE_MAX = 22, VERSE_MIN = 15, VERSE_LINE = 1.4

export interface VerseFit { fontSize: number; lineHeight: number; maxLines: number }

/**
 * The largest size from the hero verse's 22 down to 15 at which `chars` of Literata fit the widget's text box; below
 * that the text stays at 15 and ends in an ellipsis. `maxLines` is always the whole lines the box holds, so an
 * estimate that runs short ends on an ellipsis rather than a line cut through.
 */
export function verseFit(width: number, height: number, chars: number): VerseFit {
  const w = Math.max(1, width - 2 * VERSE_PAD)
  // Android pads the first line's ascent: 4 dp kept spare
  const h = Math.max(0, height - 2 * VERSE_PAD - VERSE_REF_LINE - VERSE_GAP - 4)
  const at = (size: number): VerseFit => {
    const lineHeight = Math.round(size * VERSE_LINE)
    return { fontSize: size, lineHeight, maxLines: Math.max(1, Math.floor(h / lineHeight)) }
  }
  for (let size = VERSE_MAX; size > VERSE_MIN; size--) {
    const fit = at(size)
    const perLine = Math.max(1, Math.floor(w / (size * LITERATA_EM)))
    if (Math.ceil((chars * WRAP_SLACK) / perLine) * fit.lineHeight <= h) return fit
  }
  return at(VERSE_MIN)
}

// ---------------- reading streak ----------------

/** The seal's states, as the friend streak seal draws them: kept today, running, lapsed, never begun. */
export type SealTone = 'kept' | 'waiting' | 'lapsed' | 'none'
export interface WeekDot { date: string; letter: string; met: boolean; today: boolean; ahead: boolean }
export type StreakCard =
  | { kind: 'signed-out'; text: string; url: string; a11y: string }
  | { kind: 'streak'; current: number; tone: SealTone; state: string; week: WeekDot[]; url: string; a11y: string }

/**
 * The streak as of the device's day `now`, from the stats cached at the last sync (null: signed out, or nothing synced
 * yet). Stats read on an earlier day are judged on today (`streakToday`), so a day missed shows as a lapse at midnight
 * without the app running. Minutes left are the day's goal less the time the cache records for today. `goal` is the
 * reader's own minutes (lib/dailyGoal.ts): a kept day short of it says how far there is to go, and nothing else changes.
 */
export function streakCard(s: StreakInfo | null, now: Date, locale?: string, goal: number = DAILY_GOAL_DEFAULT): StreakCard {
  if (!s) return { kind: 'signed-out', text: t('Sign in to keep a streak'), url: LOGIN_URL, a11y: t('Reading streak. Sign in to keep a streak') }
  const today = localDay(now)
  const { current, todayMet, todaySeconds } = streakToday(s, today)
  const hadRun = s.longest > 0 || s.days.some(d => d.met === 1)
  const tone: SealTone = current > 0 ? (todayMet ? 'kept' : 'waiting') : hadRun ? 'lapsed' : 'none'
  const left = tone === 'waiting' && s.today_goal_seconds > 0 ? Math.ceil(Math.max(0, s.today_goal_seconds - todaySeconds) / 60) : 0
  const toGoal = tone === 'kept' ? goalView(todaySeconds, s.today_goal_seconds, goal).left : 0
  const state = toGoal > 0 ? t('{n} min to your goal', { n: toGoal }) : tone === 'kept' ? tc('done', 'Read today') : tone === 'lapsed' ? t('Start again today') : tone === 'none' ? t('Start a streak today') : left > 0 ? t('{n} min left', { n: left }) : t('Still to read today')
  const met = new Set(s.days.filter(d => d.met === 1).map(d => d.date))
  const week = weekOf(today).map(date => ({ date, letter: dayLetter(date, locale), met: met.has(date), today: date === today, ahead: date > today }))
  const spoken = toGoal > 0 ? tn(toGoal, 'Read today. {n} minute to your goal', 'Read today. {n} minutes to your goal') : left > 0 ? tn(left, '{n} minute left today', '{n} minutes left today') : state
  return { kind: 'streak', current, tone, state, week, url: READ_URL, a11y: tn(current, 'Reading streak, {n} day. {spoken}. Open the reader', 'Reading streak, {n} days. {spoken}. Open the reader', { spoken }) }
}

// ---------------- colours ----------------

/**
 * The two themes a widget is drawn in, one per system mode: the reader's light and dark picks, with a theme chosen
 * outright (not "system") taking its own family's place. `p` is the stored prefs record, read as loosely as the app
 * reads it: anything missing or unknown falls back to the defaults.
 */
export function widgetThemes(p: { theme?: unknown; themeLight?: unknown; themeDark?: unknown } | null): { light: ThemeId; dark: ThemeId } {
  const pick = (v: unknown, d: ThemeId): ThemeId => (typeof v === 'string' && isThemeId(v) ? v : d)
  let light = pick(p?.themeLight, LIGHT_DEFAULT), dark = pick(p?.themeDark, DARK_DEFAULT)
  const fixed = migrateThemeId(p?.theme)
  if (fixed !== 'system') { if (THEME_MAP[fixed].dark) dark = fixed; else light = fixed }
  return { light, dark }
}
