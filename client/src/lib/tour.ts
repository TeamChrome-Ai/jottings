/**
 * The guided tour as plain data and geometry: the steps and their words, where the spotlight goes around a measured
 * element, where the label sits, how long a glide takes and the veil's path. No React Native here (tests/tour.test.ts).
 */
import type { Edition } from './editionCore'
import { NOUN } from '@shared/brand'

export interface Rect { x: number; y: number; w: number; h: number }
export interface Hole extends Rect { r: number }
export interface Insets { top: number; bottom: number }

/** Elements the tour can point at. Each is registered by the screen that draws it (store/tour.ts `tourRef`). */
export type TargetId =
  | 'tab-home' | 'tab-read' | 'tab-search' | 'tab-stats' | 'tab-settings'
  | 'reader-picker' | 'reader-note-run' | 'reader-note-card' | 'reader-listen' | 'reader-end'
  | 'reader-more' | 'more-size' | 'more-lookup' | 'more-bookmark' | 'more-ministry' | 'more-paged'
  | 'reader-size' | 'reader-size-down' | 'reader-lookup' | 'reader-ministry' | 'reader-paged'
  | 'reader-theme' | 'theme-first' | 'action-colours' | 'action-buttons' | 'player-transport' | 'listening-sheet'
  | 'word-sheet' | 'ministry-sheet' | 'library-heading' | 'library-back'
  | 'home-votd' | 'home-streak' | 'home-bookmarks' | 'home-outlines' | 'home-chronology' | 'home-dictionary' | 'home-ministry' | 'home-together'
  | 'outlines-new' | 'outlines-sample' | 'editor-add' | 'editor-items' | 'editor-visibility' | 'print-sheet'
  | 'friends-signin' | 'friends-add' | 'friends-first'
  | 'groups-signin' | 'groups-create' | 'groups-join' | 'group-streak' | 'group-members' | 'group-events' | 'group-feed'
  | 'search-field' | 'search-scope' | 'stats-tiles' | 'stats-week' | 'stats-badges' | 'stats-signin'
  | 'settings-text' | 'settings-reading' | 'settings-listening' | 'settings-welcome' | 'settings-account' | 'settings-reset'

/** A screen the tour can stand on; `any` leaves it where it is (the tab bar shows everywhere). `library` is a work of
 * the ministry library, opened from the chapter in the reader. */
export type Route = 'any' | 'home' | 'search' | 'reader' | 'library' | 'stats' | 'settings' | 'outlines' | 'outline-edit' | 'friends' | 'groups' | 'group'
/** `word`: the word sheet on a word of the chapter; `ministry`: the Ministry sheet on the selected verse. */
export type SheetId = 'more' | 'themes' | 'word' | 'ministry' | 'listening' | 'print'
/**
 * What must be showing for a step: the screen, and on it an open sheet, a selected verse (the action bar), read aloud
 * cued up (its bar, paused), the tour's footnote, the chapter scrolled to its end (and back to where it was after),
 * and the sample outline the editor steps work on. Everything not named is closed (and the sample deleted).
 */
export interface Scene { route: Route; sheet?: SheetId; select?: boolean; player?: boolean; note?: boolean; end?: boolean; sample?: boolean }

export interface Step {
  id: string
  /** The spotlight covers all of these that are on screen (a note: the text that holds its letter, and the note). */
  targets: TargetId[]
  scene: Scene
  text: string
  /** Grows the measured box before padding: a tab icon's box reaches down over its label. */
  grow?: Partial<Record<'top' | 'right' | 'bottom' | 'left', number>>
  pad: number
  radius: number
  /** Spotlights no taller than this share of the viewport (a long first paragraph is cut to its opening lines). */
  maxShare?: number
  /** Only on a phone (controls behind More) or only on a wider screen (the same controls in the toolbar). */
  when?: 'compact' | 'wide'
  /** Only signed in (true) or only signed out (false). */
  account?: boolean
  /** Only for a reader who belongs to a group (its page is what the step shows). */
  group?: boolean
  /** Only for a reader with a friend (the friend streak is what the step shows). */
  friends?: boolean
  /** Touches inside the spotlight reach the app (the theme swatches); elsewhere a tap in it means Next. */
  interactive?: boolean
  /** Lives on fixed chrome (the tab bar, a toolbar, a docked bar): never scrolled into view. */
  fixed?: boolean
}

const TAB = { grow: { top: 2, bottom: 22, left: 4, right: 4 }, pad: 4, radius: 20, fixed: true }
const PILL = { pad: 6, radius: 28, fixed: true }
const CARD = { pad: 6, radius: 24 }
const READER: Scene = { route: 'reader' }
const MORE: Scene = { route: 'reader', sheet: 'more' }
const HOME: Scene = { route: 'home' }
const SETTINGS: Scene = { route: 'settings' }

/** Said the same on a phone (the switch in More) and a tablet (Aa in the toolbar). */
const LOOKUP = 'Word lookup: the Hebrew or Greek behind a word, and its subject in the dictionary.'
const CHAPTER_MINISTRY = 'Ministry on this chapter: Darby and Coates going through it.'
const SIZE = 'Text size, a step at a time; the rest is in Settings.'
const PAGED = 'Paged mode sets the chapter out as pages you turn.'

/**
 * The short tour, the Bible first and in the order a reader meets it: the book button the welcome hands over to, a
 * note in the text, a verse (the selection bar it opens), word lookup, read aloud, then the tab bar under it as one
 * step, ending on the reader it began on. It never points at something and then leaves it behind.
 */
export const STEPS: Step[] = [
  { id: 'picker', targets: ['reader-picker'], scene: READER, text: 'Any book and chapter from here; hold one to bookmark it.', ...PILL },
  { id: 'note', targets: ['reader-note-run', 'reader-note-card'], scene: { route: 'reader', note: true }, text: 'Darby’s notes open in place from the small letters.', pad: 8, radius: 20, maxShare: 0.6 },
  { id: 'verse', targets: ['action-colours', 'action-buttons'], scene: { route: 'reader', select: true }, text: `A tapped verse: highlight, bookmark, ${NOUN.verbLower}, and Ministry where there is some.`, ...CARD, fixed: true },
  { id: 'lookup', targets: ['more-lookup'], scene: MORE, when: 'compact', text: LOOKUP, ...CARD },
  { id: 'lookup-wide', targets: ['reader-lookup'], scene: READER, when: 'wide', text: LOOKUP, ...PILL },
  { id: 'listen', targets: ['reader-listen'], scene: READER, text: 'Read aloud: TTS, each word lit as it is read.', ...PILL },
  // the tab bar as one, Read among them: the reader is where the tour already is
  { id: 'tabs', targets: ['tab-home', 'tab-read', 'tab-search', 'tab-stats', 'tab-settings'], scene: READER, text: 'Home, Search, Stats and Settings are on this bar; Read keeps your place.', ...TAB },
]

/**
 * The rest of the full tour, grouped by screen in the order they are visited: the reader's other controls and sheets
 * (the page's end, read aloud, a word, Ministry on a verse), the ministry library it opens, Home and the screens its
 * rows lead to (Outlines on a sample the tour makes and removes, Friends, Groups), then Search, Stats and Settings.
 * One clause each.
 */
export const EXTENDED: Step[] = [
  // the reader, where the short tour left off: the toolbar left to right, then the page
  { id: 'theme', targets: ['reader-theme'], scene: READER, text: 'Themes: 25 of them, in light, dark and true black.', ...PILL },
  { id: 'theme-pick', targets: ['theme-first'], scene: { route: 'reader', sheet: 'themes' }, interactive: true, text: 'Tap one to try it.', pad: 8, radius: 22, maxShare: 0.5 },
  { id: 'more', targets: ['reader-more'], scene: READER, when: 'compact', text: 'More: text size, a chapter bookmark, Ministry and paged mode.', ...PILL },
  { id: 'more-size', targets: ['more-size'], scene: MORE, when: 'compact', text: SIZE, ...CARD },
  { id: 'more-bookmark', targets: ['more-bookmark'], scene: MORE, when: 'compact', text: 'Bookmark the whole chapter.', ...PILL, fixed: false },
  { id: 'more-ministry', targets: ['more-ministry'], scene: MORE, when: 'compact', text: CHAPTER_MINISTRY, ...PILL, fixed: false },
  { id: 'more-paged', targets: ['more-paged'], scene: MORE, when: 'compact', text: PAGED, ...PILL, fixed: false },
  { id: 'size', targets: ['reader-size-down', 'reader-size'], scene: READER, when: 'wide', text: SIZE, ...PILL },
  { id: 'chapter-ministry', targets: ['reader-ministry'], scene: READER, when: 'wide', text: CHAPTER_MINISTRY, ...PILL },
  { id: 'paged', targets: ['reader-paged'], scene: READER, when: 'wide', text: PAGED, ...PILL },
  { id: 'end', targets: ['reader-end'], scene: { route: 'reader', end: true }, text: 'At a chapter’s end, pull on past it or swipe sideways for the next.', ...CARD, fixed: true },
  { id: 'player', targets: ['player-transport'], scene: { route: 'reader', player: true }, text: 'While it reads: the verse before or after, pause and play.', ...CARD, fixed: true },
  { id: 'listening', targets: ['listening-sheet'], scene: { route: 'reader', player: true, sheet: 'listening' }, text: 'The voice, the speed and the pauses, while it reads.', ...CARD, maxShare: 0.5 },
  { id: 'word', targets: ['word-sheet'], scene: { route: 'reader', sheet: 'word' }, text: 'A word looked up: its Strong’s concordance entry, and its subject one tap away.', ...CARD, maxShare: 0.5 },
  { id: 'ministry', targets: ['ministry-sheet'], scene: { route: 'reader', select: true, sheet: 'ministry' }, text: 'Ministry on a verse: what Darby and Coates wrote on it, best first.', ...CARD, maxShare: 0.5 },
  // a work of the ministry library, as a tap in that sheet opens it
  { id: 'library', targets: ['library-heading'], scene: { route: 'library' }, text: 'A Ministry work reads like the Bible: swipe or pull on for the next section.', ...CARD, maxShare: 0.4 },
  { id: 'library-back', targets: ['library-back'], scene: { route: 'library' }, text: 'Back returns to the verse.', ...PILL },
  // Home, top to bottom
  { id: 'votd', targets: ['home-votd'], scene: HOME, text: 'Today’s verse, a new one each day; it opens its chapter.', pad: 4, radius: 30 },
  { id: 'streak', targets: ['home-streak'], scene: HOME, account: true, text: 'Your daily streak and the week at a glance.', ...CARD },
  { id: 'streak-out', targets: ['home-streak'], scene: HOME, account: false, text: 'A daily streak and your week, once you sign in.', ...CARD },
  { id: 'bookmarks', targets: ['home-bookmarks'], scene: HOME, text: 'Bookmarks, grouped as books, chapters and verses.', ...CARD },
  { id: 'chronology', targets: ['home-chronology'], scene: HOME, text: 'Darby’s table of the kings and prophets, every reference a link.', ...CARD },
  { id: 'dictionary', targets: ['home-dictionary'], scene: HOME, text: 'Morrish’s dictionary A to Z, and Strong’s concordance through Word lookup.', ...CARD },
  { id: 'ministry-library', targets: ['home-ministry'], scene: HOME, text: 'Darby and Coates, searchable by passage or title.', ...CARD },
  { id: 'together', targets: ['home-together'], scene: HOME, account: true, text: 'Together: your friends and reading groups.', ...CARD, maxShare: 0.5 },
  { id: 'together-out', targets: ['home-together'], scene: HOME, account: false, text: 'Together: reading groups, and friends once you sign in.', ...CARD },
  // Outlines, on a sample the tour makes and removes
  { id: 'outlines-new', targets: ['outlines-new'], scene: { route: 'outlines', sample: true }, text: `Start ${NOUN.a} with a title, or from verses with ${NOUN.verb}.`, ...CARD },
  { id: 'outlines-open', targets: ['outlines-sample'], scene: { route: 'outlines', sample: true }, text: `${NOUN.A} opens to read, or Edit to change; this sample goes after.`, ...CARD },
  { id: 'editor-add', targets: ['editor-add'], scene: { route: 'outline-edit', sample: true }, text: 'Add a passage by its reference, or a note, a link or a heading.', ...CARD },
  { id: 'editor-items', targets: ['editor-items'], scene: { route: 'outline-edit', sample: true }, text: 'Lines move up, down and in, so points can sit under points.', ...CARD, maxShare: 0.55 },
  { id: 'editor-share', targets: ['editor-visibility'], scene: { route: 'outline-edit', sample: true }, account: true, text: 'Private, or shared by its link.', ...CARD },
  { id: 'editor-share-out', targets: ['editor-visibility'], scene: { route: 'outline-edit', sample: true }, account: false, text: 'Kept on this device until you sign in to share it.', ...CARD },
  { id: 'editor-print', targets: ['print-sheet'], scene: { route: 'outline-edit', sample: true, sheet: 'print' }, text: 'Print it or save a PDF, at Bible-insert size or larger.', ...CARD, maxShare: 0.55 },
  // Together: friends, then reading groups
  { id: 'friends-out', targets: ['friends-signin'], scene: { route: 'friends' }, account: false, text: 'Friends, once you sign in: by exact handle, never by search.', ...CARD },
  { id: 'friends-add', targets: ['friends-add'], scene: { route: 'friends' }, account: true, text: 'Add a friend by their exact handle, or with your QR code.', ...CARD, maxShare: 0.5 },
  { id: 'friends-streak', targets: ['friends-first'], scene: { route: 'friends' }, account: true, friends: true, text: 'A friend streak: the days you both meet your goal.', ...CARD },
  { id: 'groups-out', targets: ['groups-signin'], scene: { route: 'groups' }, account: false, text: 'Reading groups, for a few reading together, once you sign in.', ...CARD },
  { id: 'groups-create', targets: ['groups-create'], scene: { route: 'groups' }, account: true, text: 'Start a group, then invite people with its code.', ...CARD },
  { id: 'groups-join', targets: ['groups-join'], scene: { route: 'groups' }, account: true, text: 'Or join one with a code someone sent you.', ...CARD },
  { id: 'group-streak', targets: ['group-streak'], scene: { route: 'group' }, account: true, group: true, text: 'The group streak: days every member met their own goal.', ...CARD, maxShare: 0.45 },
  { id: 'group-members', targets: ['group-members'], scene: { route: 'group' }, account: true, group: true, text: 'The members; a name opens their profile.', ...CARD, maxShare: 0.45 },
  { id: 'group-events', targets: ['group-events'], scene: { route: 'group' }, account: true, group: true, text: 'Events, each with its own leaderboard.', ...CARD, maxShare: 0.45 },
  { id: 'group-feed', targets: ['group-feed'], scene: { route: 'group' }, account: true, group: true, text: `The feed: the ${NOUN.many} the group shares.`, ...CARD, maxShare: 0.45 },
  // Search
  { id: 'search-field', targets: ['search-field'], scene: { route: 'search' }, text: 'A reference like Rom 8:28 opens the chapter; words find every verse with them.', ...CARD },
  { id: 'search-scope', targets: ['search-scope'], scene: { route: 'search' }, text: 'The whole Bible, or one Testament.', ...CARD },
  // Stats
  { id: 'stats', targets: ['stats-tiles', 'stats-week'], scene: { route: 'stats' }, account: true, text: 'Your streak, today’s reading and the week, day by day.', ...CARD, maxShare: 0.45 },
  { id: 'badges', targets: ['stats-badges'], scene: { route: 'stats' }, account: true, text: 'Badges for milestones, with any reactions from friends.', ...CARD, maxShare: 0.4 },
  { id: 'stats-out', targets: ['stats-signin'], scene: { route: 'stats' }, account: false, text: 'A streak, badges and reading time, once you sign in.', ...CARD },
  // Settings, its sections top to bottom
  { id: 'settings-text', targets: ['settings-text'], scene: SETTINGS, text: 'The reading text: typeface, size and spacing, with a preview.', ...CARD, maxShare: 0.66 },
  { id: 'settings-reading', targets: ['settings-reading'], scene: SETTINGS, text: 'Reading: paragraphs, verse numbers, note markers and animation.', ...CARD, maxShare: 0.66 },
  { id: 'settings-listening', targets: ['settings-listening'], scene: SETTINGS, text: 'Listening: the voice, the speed and the pauses.', ...PILL, fixed: false },
  { id: 'settings-again', targets: ['settings-welcome'], scene: SETTINGS, text: 'The welcome and the tour, again, to show someone.', ...PILL, fixed: false },
  { id: 'settings-account', targets: ['settings-account'], scene: SETTINGS, account: true, text: 'Your picture, friends settings and your data.', ...CARD, maxShare: 0.5 },
  { id: 'settings-account-out', targets: ['settings-account'], scene: SETTINGS, account: false, text: 'Signing in keeps bookmarks, a streak, friends and groups.', ...CARD },
  { id: 'settings-reset', targets: ['settings-reset'], scene: SETTINGS, text: 'Reset puts the text, theme and layout back as they came.', ...CARD },
]
export const FINAL_TEXT = 'That’s it. Read well.'
/** Offered where the short tour ends, before the last line. */
export const CHOICE = { text: 'That’s the short tour.', more: 'Keep going: the full tour', enough: 'That’s enough' } as const

export type TourMode = 'short' | 'full'
/** The reader's toolbar holds every control from this width up (ten need ~700 pt); below it the rarer ones are behind
 * More. The tour picks its steps by the same line. */
export const TOOLBAR_WIDE = 720

/** The 1890 edition (docs/EDITION.md) has no chronological table and no Coates: that step goes, these say less. */
const ONLY_1961: ReadonlySet<string> = new Set(['chronology'])
const TEXT_1890: Readonly<Record<string, string>> = {
  'more-ministry': 'Ministry on this chapter: Darby going through it.',
  'chapter-ministry': 'Ministry on this chapter: Darby going through it.',
  'ministry': 'Ministry on a verse: what Darby wrote on it, best first.',
  'ministry-library': 'Darby’s ministry, searchable by passage or title.',
}

/** Who is touring: a tablet (the toolbar holds everything) or a phone, signed in or out, in a group, with a friend, and
 *  the edition shown (1961 when not given). */
export interface TourContext { wide: boolean; signedIn: boolean; inGroup: boolean; hasFriends?: boolean; edition?: Edition }
/** The steps for this screen and account: the short six, or those and the rest. */
export function stepsFor(mode: TourMode, ctx: TourContext): Step[] {
  const e1890 = ctx.edition === '1890'
  const fits = (s: Step) => (!s.when || (s.when === 'wide') === ctx.wide) && (s.account === undefined || s.account === ctx.signedIn)
    && (!s.group || ctx.inGroup) && (!s.friends || !!ctx.hasFriends) && !(e1890 && ONLY_1961.has(s.id))
  return (mode === 'short' ? STEPS : [...STEPS, ...EXTENDED]).filter(fits).map(s => (e1890 && TEXT_1890[s.id] ? { ...s, text: TEXT_1890[s.id] } : s))
}
/** "12 of 33" in the full tour; the short one shows dots. */
export const progressText = (i: number, n: number) => `${i + 1} of ${n}`

export type SceneAction =
  | { kind: 'sheet'; open: SheetId | null } | { kind: 'select'; on: boolean } | { kind: 'player'; on: boolean }
  | { kind: 'note'; on: boolean } | { kind: 'end'; on: boolean } | { kind: 'sample'; on: boolean } | { kind: 'route'; to: Exclude<Route, 'any'> }

/**
 * What to do to go from one step's scene to the next's: close what the next does not want (sheet, selection, read
 * aloud, note) before leaving the screen, then open what it does. The sample outline exists before the screens that
 * show it and goes after the tour has left them; read aloud comes before its settings sheet. Going back replays the
 * same way, so Back needs no bookkeeping of its own.
 */
export function sceneActions(from: Scene, to: Scene): SceneAction[] {
  const out: SceneAction[] = []
  const moving = to.route !== 'any' && to.route !== from.route
  const keep = <K extends 'select' | 'player' | 'note' | 'end'>(k: K) => !moving && !!to[k]
  if (from.sheet && (moving || from.sheet !== to.sheet)) out.push({ kind: 'sheet', open: null })
  if (from.note && !keep('note')) out.push({ kind: 'note', on: false })
  if (from.end && !keep('end')) out.push({ kind: 'end', on: false })
  if (from.select && !keep('select')) out.push({ kind: 'select', on: false })
  if (from.player && !keep('player')) out.push({ kind: 'player', on: false })
  if (to.sample && !from.sample) out.push({ kind: 'sample', on: true })
  if (moving) out.push({ kind: 'route', to: to.route as Exclude<Route, 'any'> })
  if (from.sample && !to.sample) out.push({ kind: 'sample', on: false })
  if (to.player && (moving || !from.player)) out.push({ kind: 'player', on: true })
  if (to.select && (moving || !from.select)) out.push({ kind: 'select', on: true })
  if (to.sheet && (moving || from.sheet !== to.sheet)) out.push({ kind: 'sheet', open: to.sheet })
  if (to.note && (moving || !from.note)) out.push({ kind: 'note', on: true })
  if (to.end && (moving || !from.end)) out.push({ kind: 'end', on: true })
  return out
}
/**
 * Where a scene ends up when the tour is over: nothing open, on whatever screen it stood. (Changing screen closes the
 * sheet, selection, read aloud and note, and scrolls the chapter back, first; the sample outline outlives a change of screen until a scene drops it.)
 */
export const EMPTY_SCENE: Scene = { route: 'any' }

export const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}
const intersect = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h)
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null
}

/**
 * Whether a found element sits comfortably on screen: clear of the status bar and header above and the tab bar below
 * (a tall one only needs its top part in). Otherwise the tour scrolls it into view first.
 */
export function comfortable(r: Rect, view: Rect, o: { top: number; bottom: number }): boolean {
  const top = view.y + o.top, bottom = view.y + view.h - o.bottom
  return r.y >= top && r.y + Math.min(r.h, (bottom - top) * 0.6) <= bottom
}

/** Share of `r`'s area inside `view`, 0..1 (0 for an empty box). */
export function visibleShare(r: Rect, view: Rect): number {
  if (r.w <= 0 || r.h <= 0) return 0
  const i = intersect(r, view)
  return i ? (i.w * i.h) / (r.w * r.h) : 0
}

/**
 * Which of several registered copies is the one on screen: the reader keeps the chapters either side mounted off to
 * the side, so a target can be registered three times. -1 when none shows at all.
 */
export function pickOnScreen(rects: Rect[], view: Rect): number {
  let best = -1, share = 0
  rects.forEach((r, i) => { const s = visibleShare(r, view); if (s > share) { share = s; best = i } })
  return best
}

/** The spotlight around a measured box: grown, padded, kept inside the viewport, its corners no rounder than it is. */
export function spotlight(box: Rect, step: Pick<Step, 'grow' | 'pad' | 'radius' | 'maxShare'>, view: Rect, margin = 4): Hole {
  const g = step.grow ?? {}
  let x = box.x - (g.left ?? 0) - step.pad, y = box.y - (g.top ?? 0) - step.pad
  let x2 = box.x + box.w + (g.right ?? 0) + step.pad, y2 = box.y + box.h + (g.bottom ?? 0) + step.pad
  x = Math.max(view.x + margin, x); y = Math.max(view.y + margin, y)
  x2 = Math.min(view.x + view.w - margin, x2); y2 = Math.min(view.y + view.h - margin, y2)
  if (step.maxShare) y2 = Math.min(y2, y + view.h * step.maxShare)
  const w = Math.max(0, x2 - x), h = Math.max(0, y2 - y)
  return { x, y, w, h, r: Math.min(step.radius, w / 2, h / 2) }
}

/**
 * Where the label goes: under the spotlight when it fits there, else over it, else on whichever side has more room;
 * centred on the spotlight across, kept inside the side margins.
 */
export function placeLabel(hole: Rect, view: Rect, label: { w: number; h: number }, o: { gap: number; margin: number; insets: Insets }): { x: number; y: number; below: boolean } {
  const top = view.y + o.insets.top + o.margin, bottom = view.y + view.h - o.insets.bottom - o.margin
  const roomBelow = bottom - (hole.y + hole.h + o.gap), roomAbove = hole.y - o.gap - top
  const below = roomBelow >= label.h || (roomAbove < label.h && roomBelow >= roomAbove)
  let y = below ? hole.y + hole.h + o.gap : hole.y - o.gap - label.h
  y = Math.max(top, Math.min(bottom - label.h, y))
  const cx = hole.x + hole.w / 2
  const x = Math.max(view.x + o.margin, Math.min(view.x + view.w - o.margin - label.w, cx - label.w / 2))
  return { x, y, below }
}

/** A glide's length: the pager's full turn (300 ms) for a short hop, up to 460 ms across the screen. */
export function glideMs(a: Rect, b: Rect, view: Rect): number {
  const d = Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2)) + Math.abs(a.w - b.w) / 2 + Math.abs(a.h - b.h) / 2
  const across = Math.hypot(view.w, view.h)
  return Math.round(300 + 160 * Math.min(1, d / across))
}

/** The pager's easing: ease-out cubic. */
export const easeOut = (t: number) => { 'worklet'; return 1 - (1 - t) ** 3 }

export function lerpHole(a: Hole, b: Hole, t: number): Hole {
  'worklet'
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t, r: a.r + (b.r - a.r) * t }
}

/**
 * The veil: the whole screen with the spotlight cut out, for an even-odd fill. The hole's corners are circular arcs
 * of radius `r`.
 */
export function veilPath(W: number, H: number, h: Hole): string {
  'worklet'
  const r = Math.max(0, Math.min(h.r, h.w / 2, h.h / 2))
  const x = h.x, y = h.y, x2 = h.x + h.w, y2 = h.y + h.h
  const f = (n: number) => Math.round(n * 100) / 100
  return `M0 0H${f(W)}V${f(H)}H0Z` +
    `M${f(x + r)} ${f(y)}H${f(x2 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x2)} ${f(y + r)}V${f(y2 - r)}A${f(r)} ${f(r)} 0 0 1 ${f(x2 - r)} ${f(y2)}` +
    `H${f(x + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y2 - r)}V${f(y + r)}A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)}Z`
}

/** Two measurements of a target are the same place (a re-measure every so often must not restart a glide). */
export const sameRect = (a: Rect | null, b: Rect | null, eps = 1) =>
  !!a && !!b && Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps && Math.abs(a.w - b.w) <= eps && Math.abs(a.h - b.h) <= eps

/**
 * The note the tour opens: a lettered one (a–z, not the divine-name marks) in the opening verses, the first short
 * enough to read at a glance, else the shortest there.
 */
export function demoNoteOf(verses: { v: number; notes?: { id: number; marker: string; text?: string }[] }[], within = 8, short = 180): number | null {
  const lettered = verses.slice(0, within).flatMap(v => (v.notes ?? []).filter(n => /^[a-z]+$/.test(n.marker)))
  if (!lettered.length) return null
  const len = (n: { text?: string }) => (n.text ?? '').replace(/<[^>]+>/g, '').length
  return (lettered.find(n => len(n) <= short) ?? lettered.reduce((a, b) => (len(b) < len(a) ? b : a))).id
}
