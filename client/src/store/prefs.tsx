import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState } from 'react-native'
import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { DARK_DEFAULT, LIGHT_DEFAULT, isThemeId, migrateThemeId, type ThemeId } from '../theme'
import { customIdOf, migrateFontPrefs, setCustomFonts, type CustomFont, type CustomFontKey } from '../lib/customFonts'
import { clampSpeed } from '../lib/motionSpeed'
import { NOTE_LETTERS, type NoteLetters } from '../lib/noteLetters'
import { readVerseNotify, type VerseNotifyPref } from '../lib/verseNotifyPlan'

/** A theme id from the gallery, or `system` to follow the device with `themeLight` / `themeDark`. */
export type Theme = 'system' | ThemeId
/** A bundled or system font, or `custom:<id>` naming one of `customFonts`. */
export type Font = 'serif' | 'sans' | 'dyslexic' | CustomFontKey
export interface Prefs {
  theme: Theme; themeLight: ThemeId; themeDark: ThemeId; font: Font; fontSize: number; lineHeight: number; letterSpacing: number; wordSpacing: number
  /** Fonts the reader added from Google Fonts or a file; the files live on the device, only the records are here. */
  customFonts: CustomFont[]
  verseNumbers: boolean; paragraphs: boolean; showNotes: boolean; reduceMotion: boolean
  /** Footnote letters: once through the chapter, or as the printed edition restarts them on each page (lib/noteLetters.ts). */
  noteLetters: NoteLetters
  /** Animation speed, 0.5 to 1.5 (1 as authored): scales every duration and spring (lib/motionSpeed.ts). */
  motionSpeed: number
  /** Where the content column sits on screens wider than it (tablets, desktop web), and how wide it may grow. */
  align: Align; width: Width
  /** Read-aloud: voice, speed, spoken numbers and heading, pause between verses, word highlight, auto-continue, device voice. */
  ttsVoice: string; ttsSpeed: number; ttsNumbers: boolean; ttsHeading: boolean; ttsPause: 'none' | 'short' | 'long'; ttsWord: boolean; ttsAutoNext: boolean; ttsDevice: boolean
  /** Listen from a selection reads the selected verses and stops. */
  ttsStopAtSelection: boolean
  /** Streak notifications (native only): on unless turned off, silent until the system permission is granted. */
  streakReminder: StreakReminder
  /** Morning verse notifications (native only): up to four items, each a book (0 = any: the verse of the day) at a time; none = off. */
  verseNotify: VerseNotifyPref
  /** Friend invites as notifications (native: also the background check) and a toast in the app; on unless turned off. */
  inviteNotify: boolean
  /** The welcome has been seen (finished or skipped) on this device; Settings can play it again. */
  onboarded: boolean
  /** The guided tour after the welcome has been seen (finished or skipped); Settings can show it again. */
  toured: boolean
  /** What the welcome asked to call the reader: Home's date line, and the display name offered at sign-up. */
  readerName: string
}
export interface StreakReminder { enabled: boolean; hour: number; minute: number }
export type Align = 'left' | 'center' | 'right'
export type Width = 'narrow' | 'medium' | 'wide' | 'full'
/** Max content width in px per setting; `full` means no cap. */
export const WIDTH_PX: Record<Width, number | undefined> = { narrow: 560, medium: 720, wide: 960, full: undefined }
/** Reading column: characters per line scale with the text size; `full` means no cap. */
export const READ_EM: Record<Width, number | undefined> = { narrow: 30, medium: 34, wide: 44, full: undefined }
export const ALIGN_SELF: Record<Align, 'flex-start' | 'center' | 'flex-end'> = { left: 'flex-start', center: 'center', right: 'flex-end' }
export const FONT_MIN = 14, FONT_MAX = 32
/** The welcome's name field. */
export const NAME_MAX = 40
/** A value missing from the stored record takes these; `paragraphs` is off, so a new install starts every verse on its own
 *  line while a saved record keeps its choice. */
export const DEFAULTS: Prefs = { theme: 'system', themeLight: LIGHT_DEFAULT, themeDark: DARK_DEFAULT, font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: false, showNotes: true, noteLetters: 'chapter', reduceMotion: false, motionSpeed: 1, align: 'center', width: 'medium', ttsVoice: 'alec', ttsSpeed: 1, ttsNumbers: false, ttsHeading: true, ttsPause: 'short', ttsWord: true, ttsAutoNext: true, ttsDevice: false, ttsStopAtSelection: false, customFonts: [], streakReminder: { enabled: true, hour: 20, minute: 0 }, verseNotify: { items: [] }, inviteNotify: true, onboarded: false, toured: false, readerName: '' }
const KEY = 'berean_prefs'
/** usePosition's key, read once at start-up to tell a returning reader from a new device. */
const POSITION_KEY = 'berean_pos'

/**
 * Prefs live in a store outside React so a hook can subscribe to one slice: a theme tap re-renders what reads the
 * theme, not everything that reads Reduce animation or the text size. `usePrefs()` still returns the whole record
 * for screens that show many settings.
 */
export interface PrefsStore {
  get: () => Prefs
  isLoaded: () => boolean
  /** Merges; a patch that changes nothing notifies nobody (re-tapping the selected theme is free). */
  set: (p: Partial<Prefs>) => void
  reset: () => void
  subscribe: (fn: () => void) => () => void
}
const Ctx = createContext<PrefsStore | null>(null)
/** Writes wait for a quiet moment so a burst of taps is one AsyncStorage write, flushed early when the app leaves. */
const SAVE_MS = 400

function createStore(): PrefsStore & { hydrate: (stored: Prefs | null) => void; flush: () => void } {
  let prefs = DEFAULTS, loaded = false, dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach(fn => fn())
  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null }
    if (!dirty) return
    dirty = false
    AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {})
  }
  const commit = (patched: Prefs) => {
    const next = withFonts(patched, prefs)
    if ((Object.keys(next) as (keyof Prefs)[]).every(k => Object.is(next[k], prefs[k]))) return
    const urgent = next.onboarded !== prefs.onboarded || next.toured !== prefs.toured
    prefs = next
    // nothing is written before the stored copy has been read, or it would be clobbered
    if (loaded) {
      dirty = true
      if (timer) clearTimeout(timer)
      // the welcome/tour flags must hit disk before the process can die; everything else can wait for a quiet moment
      if (urgent) flush()
      else timer = setTimeout(flush, SAVE_MS)
    }
    emit()
  }
  return {
    get: () => prefs,
    isLoaded: () => loaded,
    set: p => commit({ ...prefs, ...p, fontSize: clamp(p.fontSize ?? prefs.fontSize, FONT_MIN, FONT_MAX) }),
    // the added fonts are files on the device; the notifications, the welcome, the tour and the name are not reading preferences
    reset: () => commit({ ...DEFAULTS, customFonts: prefs.customFonts, streakReminder: prefs.streakReminder, verseNotify: prefs.verseNotify, inviteNotify: prefs.inviteNotify, onboarded: prefs.onboarded, toured: prefs.toured, readerName: prefs.readerName }),
    subscribe: fn => { listeners.add(fn); return () => { listeners.delete(fn) } },
    hydrate: stored => { if (stored) prefs = withFonts(stored, DEFAULTS); loaded = true; emit() },
    flush,
  }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore)
  useEffect(() => {
    let stored: Prefs | null = null
    AsyncStorage.multiGet([KEY, POSITION_KEY]).then(([[, raw], [, pos]]) => {
      if (raw) { try { stored = { ...DEFAULTS, ...migrate(JSON.parse(raw)) } } catch { /* corrupt prefs: defaults */ } }
      // no settings saved but a place in the text: someone who has read here before the welcome existed
      else if (pos) stored = { ...DEFAULTS, onboarded: true, toured: true }
    }).finally(() => store.hydrate(stored))
  }, [store])
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => { if (s !== 'active') store.flush() })
    return () => { sub.remove(); store.flush() }
  }, [store])
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
/** Keeps theme.ts's font registry in step with the list before anyone renders it; a choice whose font is gone reads as Serif. */
function withFonts(next: Prefs, prev: Prefs): Prefs {
  if (next.customFonts !== prev.customFonts) setCustomFonts(next.customFonts)
  const id = customIdOf(next.font)
  return id && !next.customFonts.some(f => f.id === id) ? { ...next, font: 'serif' } : next
}
/** Stored prefs predate the theme gallery (`light`/`dark`/`sepia` become ids, unknown ids fall back), added fonts and the reminder. */
function migrate(raw: Record<string, unknown>): Partial<Prefs> {
  const out: Record<string, unknown> = { ...raw }
  const t = migrateThemeId(raw.theme)
  out.theme = t
  if (raw.theme === 'sepia' && !raw.themeLight) out.themeLight = 'sepia'
  if (typeof raw.themeLight !== 'string' || !isThemeId(raw.themeLight)) out.themeLight = out.themeLight ?? LIGHT_DEFAULT
  if (typeof raw.themeDark !== 'string' || !isThemeId(raw.themeDark)) out.themeDark = DARK_DEFAULT
  Object.assign(out, migrateFontPrefs(raw))
  out.streakReminder = readReminder(raw.streakReminder, DEFAULTS.streakReminder)
  // versionCode 31's first shape was one switch + time; it becomes one Any-book item (the reader's time kept) or none
  out.verseNotify = readVerseNotify(raw.verseNotify)
  out.inviteNotify = typeof raw.inviteNotify === 'boolean' ? raw.inviteNotify : true
  // 1.0.2 had a switch for the name's Easter egg and Christmas bauble; they simply show on their days now
  delete out.seasonal
  // the Strong's / Morrish / Both choice (2026-09): a tapped word now shows both, so the choice is gone
  delete out.wordLookup
  // a record saved before the welcome existed belongs to someone already reading: they are not shown it
  out.onboarded = typeof raw.onboarded === 'boolean' ? raw.onboarded : true
  // and one from before the tour existed: they have found their way round already
  out.toured = typeof raw.toured === 'boolean' ? raw.toured : true
  out.readerName = typeof raw.readerName === 'string' ? raw.readerName.slice(0, NAME_MAX) : ''
  out.motionSpeed = clampSpeed(raw.motionSpeed)
  out.noteLetters = NOTE_LETTERS.includes(raw.noteLetters as NoteLetters) ? raw.noteLetters as NoteLetters : 'chapter'
  return out as Partial<Prefs>
}
const readReminder = (v: unknown, d: StreakReminder): StreakReminder => {
  const r = v && typeof v === 'object' ? v as Record<string, unknown> : {}
  const int = (x: unknown, hi: number, d: number) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= hi ? x as number : d)
  return { enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled, hour: int(r.hour, 23, d.hour), minute: int(r.minute, 59, d.minute) }
}

/** The stable store: `set`/`reset` for event handlers, and `get()` to read a pref at call time without subscribing. */
export function usePrefsStore(): PrefsStore {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePrefs outside PrefsProvider')
  return v
}

/** Re-renders only when `select` returns a different value; it must return a primitive or a stable reference. */
export function usePrefSelect<T>(select: (p: Prefs) => T): T {
  const s = usePrefsStore()
  const snap = () => select(s.get())
  return useSyncExternalStore(s.subscribe, snap, snap)
}
export function usePref<K extends keyof Prefs>(key: K): Prefs[K] { return usePrefSelect(p => p[key]) }
/** Several fields as one object that keeps its identity until one of them changes (memoised children stay put on a theme tap). */
export function usePrefPick<K extends keyof Prefs>(keys: readonly K[]): Pick<Prefs, K> {
  const s = usePrefsStore()
  const last = useRef<Pick<Prefs, K> | null>(null)
  const snap = () => {
    const p = s.get(), l = last.current
    if (l && keys.every(k => Object.is(l[k], p[k]))) return l
    const next = {} as Pick<Prefs, K>
    for (const k of keys) next[k] = p[k]
    return (last.current = next)
  }
  return useSyncExternalStore(s.subscribe, snap, snap)
}
export function useReduceMotion(): boolean { return usePref('reduceMotion') }

/** Whole record: re-renders on any change. Prefer `usePref` / `usePrefsStore` where one field or only `set` is needed. */
export function usePrefs() {
  const s = usePrefsStore()
  const prefs = useSyncExternalStore(s.subscribe, s.get, s.get)
  const loaded = useSyncExternalStore(s.subscribe, s.isLoaded, s.isLoaded)
  return useMemo(() => ({ prefs, loaded, set: s.set, reset: s.reset }), [prefs, loaded, s])
}
