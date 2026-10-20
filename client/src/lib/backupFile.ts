/**
 * The backup file (docs/BACKUP.md): what one holds, reading one back, and reading the old Darby Bible app's own
 * `.setting` backup into the same shape. Pure, so tests/backupFile.test.ts holds every rule; `backup.ts` does the
 * storage, the network and the file dialogs.
 *
 * A backup is the account export (`GET /api/me/export`) or, signed out, the same keys built from this device. Nothing
 * read from a file is trusted: every value is checked or dropped here, and the reading history (streak days, reading
 * time, credits, badges) is passed through untouched for the server to verify by its signature. A file made on a
 * device carries no history at all, since a streak needs an account.
 */
import { BOOKS } from '@shared/books'
import type { OutlineItemKind } from '@shared/types'
import { VERSE_COUNTS } from '@shared/verseCounts'
import { DARBY_APP_COLORS, darbyAppPlace } from './darbyApp'
import { DAILY_GOALS, type DailyGoal } from './dailyGoal'
import { HL_ALL } from './hlColours'
import { BRAND, NOUN, withArticle } from '@shared/brand'
import { t, tn } from '@shared/i18n'

export const BACKUP_FORMAT = 'jottings-backup'
export const BACKUP_VERSION = 1

/** Every highlighter the app has, the extra eight included: a backup keeps a colour whether or not it is offered. */
export const HL_COLORS = HL_ALL
export type BackupColor = typeof HL_COLORS[number]

export interface BackupBookmark { book: number; chapter: number | null; verse: number | null; label: string | null }
export interface BackupHighlight { verse_id: number; color: BackupColor }
export interface BackupItem { kind: OutlineItemKind; book: number | null; chapter: number | null; v1: number | null; v2: number | null; text: string | null; url: string | null; depth: number }
export interface BackupJotting { title: string; description: string | null; print_style: 'verses-first' | 'inline' | 'refs-only'; items: BackupItem[] }
export interface BackupPosition { book: number; chapter: number; verse: number }
/** Reading settings that mean the same on any device; fonts added from files and notification choices stay behind. */
export type BackupPrefs = Partial<{
  theme: string; themeLight: string; themeDark: string; font: 'serif' | 'sans' | 'dyslexic'
  fontSize: number; lineHeight: number; letterSpacing: number; wordSpacing: number
  verseNumbers: boolean; paragraphs: boolean; showNotes: boolean; reduceMotion: boolean
  noteLetters: 'chapter' | 'printed'; motionSpeed: number; align: 'left' | 'center' | 'right'; width: 'narrow' | 'medium' | 'wide' | 'full'
  ttsSpeed: number; ttsNumbers: boolean; ttsHeading: boolean; ttsPause: 'none' | 'short' | 'long'; ttsWord: boolean; ttsAutoNext: boolean
  moreColours: boolean; dailyGoal: DailyGoal
  readerName: string
}>

export interface BackupContent {
  bookmarks: BackupBookmark[]
  highlights: BackupHighlight[]
  jottings: BackupJotting[]
  position: BackupPosition | null
  prefs: BackupPrefs | null
}
/** The signed part of an account export, exactly as it was in the file: only the server can tell whether it is intact. */
export interface BackupHistory { user: { id: number }; exported_at: string; activity_days: unknown[]; page_credits: unknown[]; chapters_read: unknown[]; badges: unknown[]; activity_signature: string }
export interface ParsedBackup {
  kind: 'jottings' | 'darby-app'
  content: BackupContent
  history: BackupHistory | null
  /** Entries the file held that could not be read (a verse that does not exist, a colour we do not have). */
  skipped: number
}

// the server's own limits (outlines.rs), and bounds that keep a hostile file from filling the device
const MAX_TITLE = 160, MAX_TEXT = 20_000, MAX_ITEMS = 2000, MAX_JOTTINGS = 2000, MAX_MARKS = 50_000, MAX_LABEL = 200, MAX_URL = 2000
export const MAX_FILE_BYTES = 20 * 1024 * 1024

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)
const str = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max ? v : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** A verse of the text as built; `verse` may be omitted to ask about the chapter alone. */
export function isPlace(book: number | null, chapter: number | null, verse?: number | null): boolean {
  if (book === null || chapter === null) return false
  const n = VERSE_COUNTS[book - 1]?.[chapter - 1]
  if (n === undefined) return false
  return verse == null || (verse >= 1 && verse <= n)
}
const idOf = (book: number, chapter: number, verse: number) => book * 1_000_000 + chapter * 1000 + verse

function readBookmark(v: unknown): BackupBookmark | null {
  if (!isObj(v)) return null
  const book = int(v.book), chapter = v.chapter == null ? null : int(v.chapter), verse = v.verse == null ? null : int(v.verse)
  if (book === null || !BOOKS[book - 1]) return null
  if (chapter === null) return verse === null && v.chapter == null ? { book, chapter: null, verse: null, label: label(v.label) } : null
  if (!isPlace(book, chapter, verse) || (v.verse != null && verse === null)) return null
  return { book, chapter, verse, label: label(v.label) }
}
const label = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_LABEL) : null)

function readHighlight(v: unknown): BackupHighlight | null {
  if (!isObj(v)) return null
  const id = int(v.verse_id)
  if (id === null || id < 1 || !HL_COLORS.includes(v.color as BackupColor)) return null
  if (!isPlace(Math.floor(id / 1_000_000), Math.floor((id % 1_000_000) / 1000), id % 1000) || id % 1000 === 0) return null
  return { verse_id: id, color: v.color as BackupColor }
}

const KINDS: readonly OutlineItemKind[] = ['verse', 'note', 'link', 'heading']
const STYLES = ['verses-first', 'inline', 'refs-only'] as const
function readItem(v: unknown): BackupItem | null {
  if (!isObj(v) || !KINDS.includes(v.kind as OutlineItemKind)) return null
  const kind = v.kind as OutlineItemKind
  const depth = Math.min(3, Math.max(0, int(v.depth) ?? 0))
  const text = v.text == null ? null : str(v.text, MAX_TEXT), url = v.url == null ? null : str(v.url, MAX_URL)
  if ((v.text != null && text === null) || (v.url != null && url === null)) return null
  if (kind === 'verse') {
    const book = int(v.book), chapter = int(v.chapter), v1 = int(v.v1), v2 = v.v2 == null ? v1 : int(v.v2)
    if (v1 === null || v2 === null || v2 < v1 || !isPlace(book, chapter, v1) || !isPlace(book, chapter, v2)) return null
    return { kind, book, chapter, v1, v2, text, url: null, depth }
  }
  if (kind === 'link' && (!url || !/^https?:\/\//i.test(url))) return null
  return { kind, book: null, chapter: null, v1: null, v2: null, text, url: kind === 'link' ? url : null, depth }
}
/** A jotting whose title cannot be kept is dropped; one of its items that cannot be read is dropped alone (counted). */
function readJotting(v: unknown, skip: () => void): BackupJotting | null {
  if (!isObj(v)) return null
  const title = typeof v.title === 'string' ? v.title.trim() : ''
  if (!title || title.length > MAX_TITLE) return null
  const items: BackupItem[] = []
  for (const raw of list(v.items).slice(0, MAX_ITEMS)) { const it = readItem(raw); if (it) items.push(it); else skip() }
  const description = v.description == null ? null : str(v.description, MAX_TEXT)
  return { title, description, print_style: STYLES.includes(v.print_style as typeof STYLES[number]) ? v.print_style as typeof STYLES[number] : 'verses-first', items }
}

function readPosition(v: unknown): BackupPosition | null {
  if (!isObj(v)) return null
  const book = int(v.book), chapter = int(v.chapter), verse = int(v.verse) ?? 1
  return book !== null && chapter !== null && isPlace(book, chapter, verse) ? { book, chapter, verse } : null
}

const ID = /^[a-z0-9-]{1,40}$/
const num = (lo: number, hi: number) => (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined)
const bool = (v: unknown) => (typeof v === 'boolean' ? v : undefined)
const one = <T extends string>(...opts: T[]) => (v: unknown) => (opts.includes(v as T) ? v as T : undefined)
const id = (v: unknown) => (typeof v === 'string' && ID.test(v) ? v : undefined)
const PREF_READERS: { [K in keyof BackupPrefs]-?: (v: unknown) => BackupPrefs[K] | undefined } = {
  theme: id, themeLight: id, themeDark: id, font: one('serif', 'sans', 'dyslexic'),
  fontSize: num(14, 32), lineHeight: num(1.2, 2.4), letterSpacing: num(0, 0.2), wordSpacing: num(0, 1),
  verseNumbers: bool, paragraphs: bool, showNotes: bool, reduceMotion: bool,
  noteLetters: one('chapter', 'printed'), motionSpeed: num(0.5, 1.5), align: one('left', 'center', 'right'), width: one('narrow', 'medium', 'wide', 'full'),
  ttsSpeed: num(0.5, 2), ttsNumbers: bool, ttsHeading: bool, ttsPause: one('none', 'short', 'long'), ttsWord: bool, ttsAutoNext: bool,
  moreColours: bool, dailyGoal: v => (DAILY_GOALS.includes(v as DailyGoal) ? v as DailyGoal : undefined),
  readerName: v => (typeof v === 'string' ? v.slice(0, 40) : undefined),
}
/** Only the settings named above, each of the right kind and in range; anything else in the record is left out. */
export function readPrefs(v: unknown): BackupPrefs | null {
  if (!isObj(v)) return null
  const out: Record<string, unknown> = {}
  for (const [k, read] of Object.entries(PREF_READERS)) { const val = read(v[k]); if (val !== undefined) out[k] = val }
  return Object.keys(out).length ? out as BackupPrefs : null
}

function readHistory(doc: Record<string, unknown>): BackupHistory | null {
  const sig = doc.activity_signature, user = doc.user
  if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig) || !isObj(user) || int(user.id) === null || typeof doc.exported_at !== 'string') return null
  const days = list(doc.activity_days), credits = list(doc.page_credits), chapters = list(doc.chapters_read), badges = list(doc.badges)
  if (days.length + credits.length + chapters.length + badges.length === 0) return null
  return { user: { id: int(user.id) as number }, exported_at: doc.exported_at, activity_days: days, page_credits: credits, chapters_read: chapters, badges, activity_signature: sig }
}

function fromOwnBackup(doc: Record<string, unknown>): ParsedBackup {
  if (int(doc.version) !== null && (doc.version as number) > BACKUP_VERSION) throw new Error(t('This backup was made by a newer {brand}. Update the app, then restore it.', { brand: BRAND.name }))
  let skipped = 0
  const skip = () => { skipped++ }
  const keep = <T,>(rows: unknown, read: (v: unknown) => T | null, max: number): T[] => {
    const out: T[] = []
    for (const r of list(rows).slice(0, max)) { const v = read(r); if (v) out.push(v); else skip() }
    return out
  }
  // one bookmark per place and one colour per verse, as the app keeps them
  const bookmarks = [...new Map(keep(doc.bookmarks, readBookmark, MAX_MARKS).map(b => [`${b.book}.${b.chapter ?? ''}.${b.verse ?? ''}`, b])).values()]
  const highlights = [...new Map(keep(doc.highlights, readHighlight, MAX_MARKS).map(h => [h.verse_id, h])).values()]
  const jottings = keep(doc.outlines, v => readJotting(v, skip), MAX_JOTTINGS)
  // an account export keeps the reader's settings under user.settings; a device backup under device_settings
  const prefs = readPrefs(doc.device_settings) ?? (isObj(doc.user) ? readPrefs(doc.user.settings) : null)
  return { kind: 'jottings', content: { bookmarks, highlights, jottings, position: readPosition(doc.reading_position), prefs }, history: readHistory(doc), skipped }
}

// ---------------- the old Darby Bible app ----------------
/** The jotting its verse notes arrive in: the old app hangs a note on a verse, here a note lives in a jotting. */
export const DARBY_APP_NOTES_TITLE = 'Notes from the Darby Bible app'
const isDarbyApp = (doc: Record<string, unknown>) => Array.isArray(doc.DataList) && ('SettingList' in doc || 'DailyVerses' in doc || 'DailyReading' in doc)

/**
 * `{ DataList: [{ id, bookmark?, highlight?, note? }], DailyVerses, DailyReading, SettingList }`. `id` is the row of
 * the app's text table (darbyApp.ts). Bookmarks, highlights and notes come over; its reading-plan progress does not
 * (no reading credit for what cannot be checked) and neither do its font and night-mode settings. A mark on a
 * psalm's title, which is a row of its own there: the bookmark becomes the psalm's, a highlight or a note goes to
 * verse 1, where the verse's own highlight wins.
 */
function fromDarbyApp(doc: Record<string, unknown>): ParsedBackup {
  let skipped = 0
  const bookmarks = new Map<string, BackupBookmark>(), highlights = new Map<number, BackupHighlight>(), onTitles: BackupHighlight[] = []
  const notes: { n: number; book: number; chapter: number; verse: number; text: string }[] = []
  const seen = new Set<number>()
  for (const raw of list(doc.DataList).slice(0, MAX_MARKS)) {
    if (!isObj(raw)) { skipped++; continue }
    const n = Number(raw.id)
    const at = typeof raw.id === 'string' || typeof raw.id === 'number' ? darbyAppPlace(n) : null
    if (!at || seen.has(n)) { skipped++; continue }
    seen.add(n)
    const verse = at.verse ?? 1
    if (raw.bookmark != null && `${raw.bookmark}` !== '0') bookmarks.set(`${at.book}.${at.chapter}.${at.verse ?? ''}`, { book: at.book, chapter: at.chapter, verse: at.verse, label: null })
    if (raw.highlight != null && `${raw.highlight}` !== '0') {
      const h: BackupHighlight = { verse_id: idOf(at.book, at.chapter, verse), color: DARBY_APP_COLORS[`${raw.highlight}`] ?? 'yellow' }
      if (at.verse === null) onTitles.push(h); else highlights.set(h.verse_id, h)
    }
    const text = typeof raw.note === 'string' ? raw.note.trim() : ''
    if (text) notes.push({ n, book: at.book, chapter: at.chapter, verse, text: text.slice(0, MAX_TEXT) })
  }
  for (const h of onTitles) if (!highlights.has(h.verse_id)) highlights.set(h.verse_id, h)
  notes.sort((a, b) => a.n - b.n)
  const items: BackupItem[] = notes.slice(0, MAX_ITEMS / 2).flatMap(x => [
    { kind: 'verse' as const, book: x.book, chapter: x.chapter, v1: x.verse, v2: x.verse, text: null, url: null, depth: 0 },
    { kind: 'note' as const, book: null, chapter: null, v1: null, v2: null, text: x.text, url: null, depth: 0 },
  ])
  const jottings: BackupJotting[] = items.length ? [{ title: DARBY_APP_NOTES_TITLE, description: null, print_style: 'verses-first', items }] : []
  return { kind: 'darby-app', content: { bookmarks: [...bookmarks.values()], highlights: [...highlights.values()], jottings, position: null, prefs: null }, history: null, skipped }
}

/** Reads a chosen file. Throws with words for the reader when it is neither kind of backup. */
export function parseBackup(text: string): ParsedBackup {
  if (text.length > MAX_FILE_BYTES) throw new Error(t('This file is too large to be a backup.'))
  let doc: unknown
  // a file saved on Windows may start with a byte-order mark
  try { doc = JSON.parse(text.replace(/^﻿/, '')) } catch { throw new Error(t('This file is not a backup: it could not be read.')) }
  if (!isObj(doc)) throw new Error(t('This file is not a backup.'))
  if (isDarbyApp(doc)) return fromDarbyApp(doc)
  // exports made before 1.0.2 carry no format name but the same keys
  if (doc.format === BACKUP_FORMAT || (isObj(doc.user) && 'exported_at' in doc && Array.isArray(doc.outlines))) return fromOwnBackup(doc)
  throw new Error(t('This file is not {aBrand} backup or a Darby Bible app backup.', { aBrand: withArticle(BRAND.name), brand: BRAND.name }))
}

/** The file a device makes when nobody is signed in: the account export's keys, no reading history. */
export function buildDeviceBackup(content: BackupContent, madeAt: string, appVersion: string): string {
  return JSON.stringify({
    format: BACKUP_FORMAT, version: BACKUP_VERSION, source: 'device', exported_at: madeAt, app_version: appVersion,
    reading_position: content.position, device_settings: content.prefs,
    bookmarks: content.bookmarks, highlights: content.highlights,
    outlines: content.jottings.map(j => ({ title: j.title, description: j.description, print_style: j.print_style, items: j.items.map((it, position) => ({ position, ...it })) })),
  })
}

export const isEmptyBackup = (p: ParsedBackup): boolean =>
  p.content.bookmarks.length + p.content.highlights.length + p.content.jottings.length === 0 && !p.content.position && !p.content.prefs && !p.history

/** "12 bookmarks, 40 highlights, 3 jottings" for the confirmation and the result line; "" when there are none. */
export function describeCounts(c: { bookmarks: number; highlights: number; jottings: number }): string {
  const n = (x: number) => ({ n: x.toLocaleString() })
  return [
    c.bookmarks ? tn(c.bookmarks, '{n} bookmark', '{n} bookmarks', n(c.bookmarks)) : '',
    c.highlights ? tn(c.highlights, '{n} highlight', '{n} highlights', n(c.highlights)) : '',
    c.jottings ? tn(c.jottings, '{n} {one}', '{n} {many}', { ...n(c.jottings), one: NOUN.one, many: NOUN.many }) : '',
  ].filter(Boolean).join(', ')
}

/** Two jottings are the same when their titles and every item match; a restore run twice adds nothing the second time. */
export const jottingKey = (title: string, items: readonly Partial<BackupItem>[]): string =>
  JSON.stringify([title.trim(), items.map(i => [i.kind, i.book ?? null, i.chapter ?? null, i.v1 ?? null, i.v2 ?? i.v1 ?? null, i.text ?? null, i.url ?? null, i.depth ?? 0])])
