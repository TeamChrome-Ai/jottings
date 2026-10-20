/**
 * The app's language on the device (docs/LANGUAGES.md): the reader's choice in Settings, or the device's own. The words
 * themselves are in @shared/i18n (`t`, `tc`, `tn`, `N_`); this loads a language's catalogue, finds the device's
 * language, and turns a phrase's `<tag>` parts into styled text (`tr`).
 */
import { Fragment, useSyncExternalStore, type ReactNode } from 'react'
import { I18nManager, NativeModules, Platform } from 'react-native'
import { isLang, langOfLocale, onLangChange, peekLang, richParts, setLang, t, type Catalog, type Lang, type Vars } from '@shared/i18n'
import { setNamesLang } from '@shared/books'
import { parseBiblePref, setShownText, textOf } from '@shared/texts'
import AsyncStorage from '@react-native-async-storage/async-storage'

/** The app's own prefs record (store/prefs.tsx). */
const PREFS_KEY = 'berean_prefs'

export { t, tc, tn, N_, peekLang, LANGS, LANG_NAMES, type Lang } from '@shared/i18n'

/** The reader's setting: a language, or `auto` for the device's. */
export type LangPref = 'auto' | Lang
export const parseLangPref = (v: unknown): LangPref => (v === 'auto' || isLang(v) ? v : 'auto')

/** The device's locale tag: the web's from the browser, Android's and iOS's from the system. */
function deviceLocale(): string | undefined {
  if (Platform.OS === 'web') return typeof navigator !== 'undefined' ? navigator.languages?.[0] ?? navigator.language : undefined
  try {
    const c = (I18nManager as unknown as { getConstants?: () => { localeIdentifier?: string } }).getConstants?.()
    if (c?.localeIdentifier) return c.localeIdentifier
    const ios = (NativeModules.SettingsManager as { settings?: { AppleLocale?: string; AppleLanguages?: string[] } } | undefined)?.settings
    if (ios) return ios.AppleLanguages?.[0] ?? ios.AppleLocale
  } catch { /* no native locale: the Intl default below */ }
  try { return Intl.DateTimeFormat().resolvedOptions().locale } catch { return undefined }
}
export const deviceLang = (): Lang => langOfLocale(deviceLocale())
export const langOf = (p: LangPref): Lang => (p === 'auto' ? deviceLang() : p)

/** Each catalogue is its own chunk on the web, fetched only by a reader who uses it; English has none. */
const LOAD: Record<Exclude<Lang, 'en'>, () => Promise<Catalog>> = {
  fr: () => import('./fr.json').then(m => m.default as Catalog),
  'fr-CA': async () => {
    const [fr, ca] = await Promise.all([import('./fr.json'), import('./fr-CA.json')])
    return { ...(fr.default as Catalog), ...(ca.default as Catalog) }
  },
  de: () => import('./de.json').then(m => m.default as Catalog),
  nl: () => import('./nl.json').then(m => m.default as Catalog),
  sv: () => import('./sv.json').then(m => m.default as Catalog),
}
/** Loads the language's catalogue and makes it the one shown; a catalogue that cannot load leaves the English. */
export async function loadLanguage(l: Lang): Promise<void> {
  if (l === 'en') setLang('en', {})
  else try { setLang(l, await LOAD[l]()) } catch { setLang('en', {}) }
  // book names follow the words (Canadian French writes them as French does)
  const shown = peekLang()
  setNamesLang(shown === 'fr-CA' ? 'fr' : shown)
}

let stored: Promise<void> | null = null
/**
 * Code that runs with the app closed (the home-screen widgets, the background check and the verse notifications it
 * schedules) reads the reader's language and Bible from the stored prefs itself: the root layout is not there to.
 */
export function ensureStoredLanguage(): Promise<void> {
  stored ??= (async () => {
    try {
      const raw = await AsyncStorage.getItem(PREFS_KEY)
      const p = raw ? (JSON.parse(raw) as { lang?: unknown; bible?: unknown }) : null
      await loadLanguage(langOf(parseLangPref(p?.lang)))
      setShownText(textOf(parseBiblePref(p?.bible), peekLang()))
    } catch { /* the English, as before */ }
  })()
  return stored
}

const subscribe = (f: () => void) => onLangChange(() => f())
/** The language shown, re-rendering on a change. */
export function useLang(): Lang { return useSyncExternalStore(subscribe, peekLang, peekLang) }

/** The locale dates and numbers are written in: the device's own while the app is in English (its date order), else the app's. */
export const dateLocale = (): string | undefined => (peekLang() === 'en' ? undefined : peekLang())

/**
 * A phrase with styled parts: `tr('Tap <b>Read</b> to begin', { b: s => <Text style={bold}>{s}</Text> })`. A tag with
 * no renderer shows its text plain, so a translation can never lose words.
 */
export function tr(s: string, render: Record<string, (text: string) => ReactNode>, vars?: Vars): ReactNode[] {
  return richParts(t(s, vars)).map((p, i) => (typeof p === 'string' ? p : <Fragment key={i}>{render[p.tag] ? render[p.tag](p.text) : p.text}</Fragment>))
}
