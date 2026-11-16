/**
 * The app's side of the assistant's tools (shared/assistantTools.json, docs/ASSISTANT.md): an executor for every `app`
 * row. Each returns what the model is told, and for a row that changes something, one line per change with the data
 * its Undo needs, so a line can be undone after the app has restarted. Everything stateful comes in through
 * `ActionContext`.
 */
import type { Href } from 'expo-router'
import { toolRow, type ParagraphRef, type PropertySchema } from '@shared/assistantTools'
import { formatRef, parseRef, type Ref } from '@shared/ref'
import { t, tc, tn } from '@shared/i18n'
import { NOUN } from '@shared/brand'
import { THEMES } from '../theme'
import type { BookmarkTarget } from './bookmarks'
import { JOTTING_TOOLS, undoJotting, type JottingLine, type JottingUndo, type OutlinesHost, type Undone } from './assistantOutlines'
import { isPlace, readPrefs } from './backupFile'
import { isHlColor } from './hlColours'
import { settingsPatch } from './settingsPatch'
import type { Prefs, PrefsStore } from '../store/prefs'

export interface ActionContext {
  prefs: PrefsStore
  navigate: (href: Href) => void
  player: { start: (book: number, chapter: number, verse: number) => void; stop: () => void; now: () => { book: number; chapter: number; verse: number } | null }
  /** Where the reader is in the Bible, for listening with no reference. */
  place: () => Promise<{ book: number; chapter: number; verse: number } | null>
  /** `find`: the bookmark a place has already, which `add` answers with too. */
  bookmarks: { find: (b: BookmarkTarget) => Promise<number | null>; add: (b: BookmarkTarget) => Promise<number>; remove: (id: number) => Promise<void> }
  /** `get`: what the verses are coloured now, null when that cannot be known. */
  highlights: { get: (verseIds: number[]) => Promise<Map<number, string> | null>; set: (verseId: number, colour: string | null) => Promise<void> }
  /** Opens the feedback form with `message` in it, for the reader to send. */
  feedback: (message: string) => void
  /** A paragraph a library tool gave in this conversation. */
  paragraph: (id: number) => ParagraphRef | undefined
  /** The reader's own outlines, through the functions their screens use (assistantOutlines.ts). */
  jottings: OutlinesHost
}

/** What a change line says, translated when it is shown. */
export type ChangeLine =
  | { kind: 'setting'; key: string; from: unknown; to: unknown }
  | { kind: 'bookmark'; ref: string }
  | { kind: 'highlight'; ref: string }
  | { kind: 'listening'; ref: string }
  | { kind: 'stopped' }
  | JottingLine
/** What Undo does. `none`: what it needed is no longer kept (lib/assistant.ts `trimmed`), so the line offers none. */
export type Undo =
  | { kind: 'setting'; key: string; before: unknown }
  | { kind: 'bookmark'; id: number }
  | { kind: 'highlight'; verses: { id: number; before: string | null }[] }
  | { kind: 'stop' }
  | { kind: 'resume'; book: number; chapter: number; verse: number }
  | JottingUndo
  | { kind: 'none' }
export interface Change { line: ChangeLine; undo: Undo }
export interface Outcome { result: unknown; changes: Change[] }
export type Executor = (args: Record<string, unknown>, ctx: ActionContext) => Promise<Outcome>

const said = (result: unknown, changes: Change[] = []): Outcome => ({ result, changes })
const no = (error: string): Outcome => said({ error })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
/** A reference as the model writes one, in English: a chapter the Bible has, and any verse in it. */
function place(v: unknown): Ref | null {
  const r = parseRef(str(v), { english: true })
  return r && isPlace(r.book, r.chapter, r.v1 ?? null) && isPlace(r.book, r.chapter, r.v2 ?? null) ? r : null
}
const NO_PLACE = 'not a chapter or verse of the Bible; give one as John 3:16'

/** Each screen open_screen offers, and its route. */
const SCREENS: Record<string, Href> = {
  home: '/', search: '/search', stats: '/stats', settings: '/settings',
  'settings/text': '/settings/text', 'settings/page': '/settings/page', 'settings/daily': '/settings/daily', 'settings/motion': '/settings/motion',
  'settings/offline': '/settings/offline', 'settings/about': '/settings/about', 'settings/account': '/settings/account',
  themes: '/themes', bookmarks: '/bookmarks', jottings: '/outlines', ministry: '/companion', dictionary: '/dictionary', chronology: '/chronology',
  paths: '/paths', credits: '/credits', about: '/about', acknowledgments: '/acknowledgments',
}
const SETTINGS = toolRow('change_settings')?.input.properties ?? {}
function range(p: PropertySchema): string {
  if (p.minimum !== undefined) return `from ${p.minimum} to ${p.maximum}`
  if (p.enum) return `one of ${p.enum.join(', ')}`
  return p.type === 'boolean' ? 'true or false' : `a ${p.type}`
}

export const APP_TOOLS: Record<string, Executor> = {
  open_chapter: async (args, ctx) => {
    const r = place(args.reference)
    if (!r) return no(NO_PLACE)
    ctx.navigate({ pathname: '/read/[book]/[chapter]', params: { book: String(r.book), chapter: String(r.chapter), v: r.v1 ? String(r.v1) : '' } })
    return said({ opened: formatRef(r) })
  },
  open_paragraph: async (args, ctx) => {
    const p = typeof args.id === 'number' ? ctx.paragraph(args.id) : undefined
    if (!p) return no('no paragraph with that id was given in this conversation; find it with search_library first')
    ctx.navigate({ pathname: '/companion', params: { author: p.author, work: p.work.id, n: String(p.n), p: String(p.para) } })
    // the model has the paragraph from its own tool; library text in an app tool's result would pass the change rule
    return said({ opened: p.id })
  },
  open_screen: async (args, ctx) => {
    const to = SCREENS[str(args.screen)]
    if (!to) return no(`no screen ${str(args.screen)}`)
    ctx.navigate(to)
    return said({ opened: str(args.screen) })
  },
  open_dictionary_entry: async (args, ctx) => {
    const id = str(args.id)
    if (!/^[a-z0-9-]{1,80}$/.test(id)) return no('give the id look_up_word gave')
    ctx.navigate({ pathname: '/dictionary', params: { id } })
    return said({ opened: id })
  },
  show_bookmarks: async (_args, ctx) => { ctx.navigate('/bookmarks'); return said({ opened: 'bookmarks' }) },
  get_settings: async (_args, ctx) => said(readPrefs(ctx.prefs.get()) ?? {}),
  change_settings: async (args, ctx) => {
    const before = ctx.prefs.get() as unknown as Record<string, unknown>
    const patch = (settingsPatch(args) ?? {}) as Record<string, unknown>
    const refused = Object.fromEntries(Object.keys(args).filter(k => !(k in patch)).map(k => [k, SETTINGS[k] ? range(SETTINGS[k]) : 'not a setting Ask can change']))
    const changed = Object.entries(patch).filter(([k, v]) => !Object.is(before[k], v))
    if (changed.length) ctx.prefs.set(Object.fromEntries(changed) as Partial<Prefs>)
    return said({ changed: Object.fromEntries(changed), refused },
      changed.map(([key, to]) => ({ line: { kind: 'setting', key, from: before[key], to }, undo: { kind: 'setting', key, before: before[key] } })))
  },
  start_listening: async (args, ctx) => {
    const r = args.reference === undefined ? null : place(args.reference)
    if (args.reference !== undefined && !r) return no(NO_PLACE)
    const at = r ? { book: r.book, chapter: r.chapter, verse: r.v1 ?? 1 } : await ctx.place()
    if (!at) return no('give a chapter to read')
    ctx.player.start(at.book, at.chapter, at.verse)
    const ref = formatRef({ book: at.book, chapter: at.chapter, ...(at.verse > 1 ? { v1: at.verse } : null) })
    return said({ reading: ref }, [{ line: { kind: 'listening', ref }, undo: { kind: 'stop' } }])
  },
  stop_listening: async (_args, ctx) => {
    // the player names a verse only once reading has begun; a chapter still loading is stopped all the same
    const now = ctx.player.now()
    ctx.player.stop()
    return now ? said({ stopped: true }, [{ line: { kind: 'stopped' }, undo: { kind: 'resume', ...now } }]) : said({ stopped: true })
  },
  add_bookmark: async (args, ctx) => {
    const r = place(args.reference)
    if (!r) return no(NO_PLACE)
    const target = { book: r.book, chapter: r.chapter, verse: r.v1 ?? null }
    const ref = formatRef({ book: r.book, chapter: r.chapter, ...(r.v1 ? { v1: r.v1 } : null) })
    // a bookmark the reader had is theirs: no line, so no Undo removes it
    if (await ctx.bookmarks.find(target) !== null) return said({ bookmarked: ref, already: true })
    const id = await ctx.bookmarks.add(target)
    return said({ bookmarked: ref }, [{ line: { kind: 'bookmark', ref }, undo: { kind: 'bookmark', id } }])
  },
  add_highlight: async (args, ctx) => {
    const r = place(args.reference)
    if (!r?.v1) return no('give a verse or verses of one chapter, as John 3:16-18')
    if (!isHlColor(args.colour)) return no('the colour is one of yellow, green, blue, pink, orange, red, purple, teal, sky, lime, brown, grey')
    const ids = Array.from({ length: (r.v2 ?? r.v1) - r.v1 + 1 }, (_, k) => r.book * 1_000_000 + r.chapter * 1000 + r.v1! + k)
    const before = await ctx.highlights.get(ids)
    // an Undo needs what the verses had; unknown, nothing is coloured that could not be put back
    if (!before) return no('the colours those verses have now could not be read; nothing was changed, try again in a moment')
    for (const id of ids) await ctx.highlights.set(id, args.colour)
    const ref = formatRef(r)
    return said({ highlighted: ref }, [{ line: { kind: 'highlight', ref }, undo: { kind: 'highlight', verses: ids.map(id => ({ id, before: before.get(id) ?? null })) } }])
  },
  draft_feedback: async (args, ctx) => {
    const message = str(args.message).slice(0, 2000)
    if (!message) return no('the message is empty')
    ctx.feedback(message)
    return said({ opened: 'the feedback form, for the reader to read and send' })
  },
  ...JOTTING_TOOLS,
}

/** Undoes a change. Only a write of the reader's own outline can find it changed since, and then does nothing. */
export async function undo(u: Undo, ctx: ActionContext): Promise<Undone> {
  switch (u.kind) {
    case 'setting': ctx.prefs.set({ [u.key]: u.before } as Partial<Prefs>); break
    case 'bookmark': await ctx.bookmarks.remove(u.id); break
    case 'highlight': for (const v of u.verses) await ctx.highlights.set(v.id, v.before); break
    case 'stop': ctx.player.stop(); break
    case 'resume': ctx.player.start(u.book, u.chapter, u.verse); break
    case 'jotting-created': case 'jotting-edited': return undoJotting(u, ctx)
    case 'none': return { did: 'failed' }
  }
  return { did: 'undone' }
}

/** Each setting's name on a change line: the Settings pages' own words where they have them. */
function settingName(key: string): string {
  switch (key) {
    case 'theme': return t('Theme')
    case 'themeLight': return tc('theme group', 'Light')
    case 'themeDark': return tc('theme group', 'Dark')
    case 'font': return t('Font')
    case 'fontSize': return t('Text size')
    case 'lineHeight': return t('Line height')
    case 'letterSpacing': return t('Letter spacing')
    case 'wordSpacing': return t('Word spacing')
    case 'verseNumbers': return t('Verse numbers')
    case 'paragraphs': return t('Paragraphs')
    case 'showNotes': return t('Footnote markers')
    case 'noteLetters': return t('Footnote letters')
    case 'moreColours': return t('More highlight colours')
    case 'reduceMotion': return t('Reduce animation')
    case 'motionSpeed': return t('Animation speed')
    case 'align': return t('Position')
    case 'width': return t('Width and position')
    case 'ttsSpeed': return t('Speed')
    case 'ttsNumbers': return t('Say verse numbers')
    case 'ttsHeading': return t('Say the book and chapter')
    case 'ttsPause': return t('Pause between verses')
    case 'ttsWord': return t('Highlight each word')
    case 'ttsAutoNext': return t('Continue into the next chapter')
    case 'dailyGoal': return t('Daily goal')
    case 'readerName': return t('Your name')
    default: return key
  }
}
/** A setting's value as its page names it. */
function value(key: string, v: unknown): string {
  if (typeof v === 'boolean') return v ? tc('state', 'On') : tc('state', 'Off')
  if (v === 'system') return t('Follow the system')
  if (key.startsWith('theme') && typeof v === 'string') { const th = THEMES.find(x => x.id === v); if (th) return t(th.name) }
  switch (`${key}:${String(v)}`) {
    case 'font:serif': return t('Serif')
    case 'font:sans': return t('Sans')
    case 'font:dyslexic': return t('Dyslexic')
    case 'noteLetters:chapter': return t('Through the chapter')
    case 'noteLetters:printed': return t('As printed')
    case 'align:left': return tc('align', 'Left')
    case 'align:center': return tc('align', 'Centre')
    case 'align:right': return tc('align', 'Right')
    case 'width:narrow': return tc('width', 'Narrow')
    case 'width:medium': return tc('width', 'Medium')
    case 'width:wide': return tc('width', 'Wide')
    case 'width:full': return tc('width', 'Full')
    case 'ttsPause:none': return tc('pause', 'None')
    case 'ttsPause:short': return tc('pause', 'Short')
    case 'ttsPause:long': return tc('pause', 'Long')
    default: return String(v)
  }
}
/** A change line as the conversation shows it. */
export function changeText(line: ChangeLine): string {
  switch (line.kind) {
    case 'setting': return t('{setting}: {from} → {to}', { setting: settingName(line.key), from: value(line.key, line.from), to: value(line.key, line.to) })
    case 'bookmark': return t('Bookmarked {ref}', { ref: line.ref })
    case 'highlight': return t('Highlighted {ref}', { ref: line.ref })
    case 'listening': return t('Reading {ref} aloud', { ref: line.ref })
    case 'stopped': return t('Stopped reading aloud')
    case 'jotting-created': return t('Made the {one} “{title}”', { one: NOUN.one, title: line.title })
    case 'jotting-edited': {
      const what = [
        line.added ? tn(line.added, '{n} line added', '{n} lines added') : '',
        line.replaced ? tn(line.replaced, '{n} line replaced', '{n} lines replaced') : '',
        line.removed ? tn(line.removed, '{n} line removed', '{n} lines removed') : '',
        line.moved ? tn(line.moved, '{n} line moved', '{n} lines moved') : '',
        line.renamed ? t('new title') : '',
      ].filter(Boolean).join(', ')
      return t('Changed “{title}”: {what}', { title: line.title, what })
    }
  }
}
