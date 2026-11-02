/**
 * Settings as an index: the rows the Settings tab lists in three cards, each with a line saying how it is set, and where
 * a tap goes (a page under /settings, the theme gallery, or a sheet that stays on the index). Pure: the screen gathers
 * `Facts` from its hooks and everything here is a function of them (tests/settingsIndex.test.ts).
 */
import { LANG_NAMES, N_, t, tc, type Lang } from '@shared/i18n'
import { TEXT_NAMES, type BibleText } from '@shared/texts'
import type { IconName } from '../components/Icon'
import type { Font, Prefs } from '../store/prefs'
import { customKey } from './customFonts'
import { formatTime } from './reminderPlan'
import type { TargetId } from './tour'
import { verseNotifyDetail } from './verseNotifyPlan'

/** The pages pushed from the index, one file each in client/app/settings/; the title is the header's and the row's. */
export const PAGE_TITLE = { text: N_('Text'), page: N_('Page'), daily: N_('Daily'), motion: N_('Motion'), offline: N_('Offline'), about: N_('About'), account: N_('Account') } as const
export type SettingsPage = keyof typeof PAGE_TITLE
export const SETTINGS_PAGES = Object.keys(PAGE_TITLE) as readonly SettingsPage[]

/** The fonts the app brings; the Text page offers up to two added ones beside them. */
export const BUILT_IN_FONTS: { value: Font; label: string }[] = [{ value: 'serif', label: N_('Serif') }, { value: 'sans', label: N_('Sans') }, { value: 'dyslexic', label: N_('Dyslexic') }]

/** What the index knows, read once from hooks: the language and Bible are the ones the screens were mounted with. */
export interface Facts { prefs: Prefs; signedIn: boolean; native: boolean; themeName: string; voiceName: string; lang: Lang; text: BibleText }

export type IndexSheet = 'listening' | 'language'
/** Language stays a sheet: a new language or Bible remounts every screen, which a pushed page would not survive. */
export type Open = { kind: 'page'; page: SettingsPage } | { kind: 'themes' } | { kind: 'sheet'; sheet: IndexSheet }
/** Before a row's title: a glyph in the usual circle, or a small sample of what the row sets. */
export type Mark = { icon: IconName } | { sample: 'font' | 'theme' }

export type GroupId = 'text' | 'page' | 'theme' | 'listening' | 'daily' | 'language' | 'motion' | 'offline' | 'about'
export interface Group {
  id: GroupId
  title: string
  mark: Mark
  summary: (f: Facts) => string
  open: Open
  /** Absent: always. A row whose page would be empty is not listed. */
  shown?: (f: Facts) => boolean
  target?: TargetId
}

const page = (p: SettingsPage) => ({ title: PAGE_TITLE[p], open: { kind: 'page', page: p } as const })

/** Every page setting that is on, as one phrase: paragraphs, verse numbers, footnote markers (in that order, 1 for on). */
const PAGE_ON: Record<string, string> = {
  '111': N_('Paragraphs, verse numbers, footnotes'),
  '110': N_('Paragraphs, verse numbers'),
  '101': N_('Paragraphs, footnotes'),
  '100': N_('Paragraphs'),
  '011': N_('Verse numbers, footnotes'),
  '010': N_('Verse numbers'),
  '001': N_('Footnotes'),
  '000': N_('Every verse on its own line'),
}

function fontName(p: Prefs): string {
  const added = p.customFonts.find(f => customKey(f.id) === p.font)
  return added ? added.name : t(BUILT_IN_FONTS.find(f => f.value === p.font)?.label ?? BUILT_IN_FONTS[0].label)
}

function daily({ prefs, signedIn, native }: Facts): string {
  const reminder = prefs.streakReminder
  if (signedIn && native && reminder.enabled) return t('{n} min, reminder at {time}', { n: prefs.dailyGoal, time: formatTime(reminder.hour, reminder.minute) })
  if (signedIn) return t('{n} min a day', { n: prefs.dailyGoal })
  return prefs.verseNotify.items.length ? t('Verse of the day: {detail}', { detail: verseNotifyDetail(prefs.verseNotify) }) : t('No verse of the day')
}

function listening({ prefs, voiceName: voice }: Facts): string {
  const pause = { none: t('no pause'), short: t('short pauses'), long: t('long pauses') }[prefs.ttsPause]
  return prefs.ttsDevice ? t('{voice} at {speed}×, {pause}, device voice', { voice, speed: prefs.ttsSpeed, pause }) : t('{voice} at {speed}×, {pause}', { voice, speed: prefs.ttsSpeed, pause })
}

/** The rows in the owner's order, three cards of three. */
const CARDS: readonly (readonly Group[])[] = [
  [
    { id: 'text', ...page('text'), mark: { sample: 'font' }, target: 'settings-text', summary: ({ prefs: p }) => t('{font} · {size} px · line {line}', { font: fontName(p), size: p.fontSize, line: p.lineHeight.toFixed(2) }) },
    { id: 'page', ...page('page'), mark: { icon: 'pages' }, target: 'settings-page', summary: ({ prefs: p }) => t(PAGE_ON[`${+p.paragraphs}${+p.verseNumbers}${+p.showNotes}`]) },
    { id: 'theme', title: N_('Theme'), open: { kind: 'themes' }, mark: { sample: 'theme' }, summary: f => f.prefs.theme === 'system' ? t('{name} · follows the system', { name: f.themeName }) : f.themeName },
  ],
  [
    { id: 'listening', title: N_('Listening'), open: { kind: 'sheet', sheet: 'listening' }, mark: { icon: 'voice' }, target: 'settings-listening', summary: listening },
    { id: 'daily', ...page('daily'), mark: { icon: 'clock' }, target: 'settings-daily', summary: daily, shown: f => f.native || f.signedIn },
    { id: 'language', title: N_('Language'), open: { kind: 'sheet', sheet: 'language' }, mark: { icon: 'dictionary' }, summary: ({ prefs, lang, text }) => prefs.bible2 ? `${LANG_NAMES[lang]} · ${TEXT_NAMES[text]} + ${TEXT_NAMES[prefs.bible2]}` : `${LANG_NAMES[lang]} · ${TEXT_NAMES[text]}` },
  ],
  [
    { id: 'motion', ...page('motion'), mark: { icon: 'motion' }, summary: ({ prefs: p }) => p.reduceMotion ? tc('animation', 'Reduced') : t('{speed}× speed', { speed: p.motionSpeed.toFixed(1) }) },
    { id: 'offline', ...page('offline'), mark: { icon: 'offline' }, summary: () => t('Bible, dictionary and ministry'), shown: f => f.native },
    { id: 'about', ...page('about'), mark: { icon: 'info' }, target: 'settings-about', summary: () => t('Credits, feedback, the tour') },
  ],
]
export const GROUPS: readonly Group[] = CARDS.flat()

/** The cards as the index draws them: hidden rows left out, and a card left empty dropped. */
export const cards = (f: Facts): Group[][] => CARDS.map(c => c.filter(g => g.shown?.(f) ?? true)).filter(c => c.length > 0)

/** True to `reset()` (store/prefs.tsx): what it puts back, and what it keeps. */
export const RESET_HINT = N_('Text, page, theme, motion and listening go back to how they came; your language and Bible, added fonts, the daily goal, notifications and your name stay')
