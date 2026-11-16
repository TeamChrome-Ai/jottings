/**
 * The Bibles the app can show (docs/LANGUAGES.md): the English Darby, Darby's French and the Elberfelder he made with
 * Brockhaus, and two English Bibles to read beside Darby's, the King James Version and Young's Literal Translation.
 * Every one is kept in the English Darby's chapters and verses, each verse carrying its own printed number where that
 * differs, so what a reader marks, keeps and shares is the same whichever they read.
 *
 * A Bible's id is its own, not its language's: `en` is the English Darby, and `kjv` and `ylt` are English too
 * (`TEXT_LANG`). What belongs to Darby's English text (footnotes, word lookup, the recordings) asks `t === 'en'`; what
 * follows the language a Bible is in (the device's voice, a spoken heading) asks `TEXT_LANG[t]`.
 */
import { N_, type Lang } from './i18n.js'
import { TEXTS_OUT } from './textsOut.js'
import { VERSE_COUNTS } from './verseCounts.js'

export type BibleText = 'en' | 'kjv' | 'ylt' | 'fr' | 'de'
/** Every Bible there is an id for, by language, the English Darby first. A stored choice is one of these. */
const ALL_TEXTS: readonly BibleText[] = ['en', 'kjv', 'ylt', 'fr', 'de']
/** The Bibles of this build, as its lists offer them: all of them, but one that was left out (./textsOut.ts). */
export const TEXTS: readonly BibleText[] = ALL_TEXTS.filter(t => !TEXTS_OUT.includes(t))
export const isText = (v: unknown): v is BibleText => ALL_TEXTS.includes(v as BibleText)
/** A Bible other than the English Darby: its chapters are files of its own (client/public/bible-<id>/). */
export type OwnText = Exclude<BibleText, 'en'>
export const OWN_TEXTS: readonly OwnText[] = ALL_TEXTS.filter((t): t is OwnText => t !== 'en')
export const isOwnText = (v: unknown): v is OwnText => v !== 'en' && isText(v)

/** Each Bible by its name, as a list of them shows it: Darby's each in its own language, so a reader finds theirs
 *  whatever the app is in; the two beside him by the name the app's language has for them (shown with `t`). */
export const TEXT_NAMES: Record<BibleText, string> = { en: 'Darby (English)', kjv: N_('King James Version'), ylt: N_('Young’s Literal Translation'), fr: 'Darby (français)', de: 'Elberfelder (Deutsch)' }
/** How a shared verse names its Bible: "— John 3:16 (Darby)". */
export const TEXT_SHORT: Record<BibleText, string> = { en: 'Darby', kjv: 'KJV', ylt: 'YLT', fr: 'Darby', de: 'Elberfelder' }
/** John 1:1-3 in each, for the text-size preview in Settings. */
export const TEXT_SAMPLE: Record<BibleText, readonly string[]> = {
  en: ['In the beginning was the Word, and the Word was with God, and the Word was God.', 'He was in the beginning with God.', 'All things received being through him, and without him not one thing received being which has received being.'],
  kjv: ['In the beginning was the Word, and the Word was with God, and the Word was God.', 'The same was in the beginning with God.', 'All things were made by him; and without him was not any thing made that was made.'],
  ylt: ['In the beginning was the Word, and the Word was with God, and the Word was God;', 'this one was in the beginning with God;', 'all things through him did happen, and without him happened not even one thing that hath happened.'],
  fr: ['Au commencement était la Parole ; et la Parole était auprès de Dieu ; et la Parole était Dieu.', 'Elle était au commencement auprès de Dieu.', 'Toutes choses furent faites par elle, et sans elle pas une seule chose ne fut faite de ce qui a été fait.'],
  de: ['Im Anfang war das Wort, und das Wort war bei Gott, und das Wort war Gott.', 'Dieses war im Anfang bei Gott.', 'Alles ward durch dasselbe, und ohne dasselbe ward auch nicht eines, das geworden ist.'],
}
/** The language each Bible is in (a reference, a heading and the device's voice follow it). */
export const TEXT_LANG: Record<BibleText, 'en' | 'fr' | 'de'> = { en: 'en', kjv: 'en', ylt: 'en', fr: 'fr', de: 'de' }

/**
 * Who reads a Bible aloud. The recordings are of the English Darby's words, and every other Bible is read by the
 * device's own voice. `recorded`: the English Darby. `stated`: Darby's French and the Elberfelder, where Listening
 * still lists the recorded voices and says they read the English Darby, as it always has. `device`: an English Bible
 * beside Darby's, where a recorded voice would seem to read the page and would read other words, so none is offered.
 */
export const voicesFor = (t: BibleText): 'recorded' | 'stated' | 'device' => (t === 'en' ? 'recorded' : TEXT_LANG[t] === 'en' ? 'device' : 'stated')

/** The reader's setting: a Bible, or `auto` for their language's own Darby (the English one where it has none). */
export type BiblePref = 'auto' | BibleText
export const parseBiblePref = (v: unknown): BiblePref => (v === 'auto' || isText(v) ? v : 'auto')
/** A language's own Bible is always one of Darby's: the Bibles beside him are read only when chosen. */
export function textOfLang(l: Lang): BibleText {
  if (l === 'fr' || l === 'fr-CA') return 'fr'
  return l === 'de' ? 'de' : 'en'
}
/** The Bible read: the one chosen, or the language's own when none is, or when the one chosen is not in this build
 *  (the choice itself is kept as it was stored). */
export const textOf = (p: BiblePref, l: Lang): BibleText => (p === 'auto' || !TEXTS.includes(p) ? textOfLang(l) : p)
/** The Bible set beside the one read (pref `bible2`): none when the one chosen is not in this build. */
export const secondText = (p: BibleText | ''): BibleText | '' => (p && TEXTS.includes(p) ? p : '')

/**
 * Words as a verse counts them (footnote callers, word taps, the read-aloud word marks). The English keeps the ASCII rule
 * its data was made with ("Cæsar" is two words there, and every stored position counts it so); the others count every
 * letter of every alphabet, so "l’Éternel" is one word.
 */
export const WORD_RE_EN = /([A-Za-z0-9'’]+)|([^A-Za-z0-9'’]+)/g
export const WORD_RE_INTL = /([\p{L}\p{N}'’]+)|([^\p{L}\p{N}'’]+)/gu

// ---------- the Bible shown, and where its own numbers sit in the English ----------

/** A run of a Bible's own numbering inside one English chapter: English verses v … v+len-1 are its chapter `nc`, verses
 *  `nv` … (client/public/bible-<text>/map.json, written by the data build from each verse's `nc`/`nv`). */
export type Run = readonly [v: number, len: number, nc: number, nv: number]
/** A Bible's runs by English "book.chapter": only the chapters where some verse's number differs. */
export type VerseMap = Readonly<Record<string, readonly Run[]>>

const maps: Partial<Record<BibleText, VerseMap>> = {}
let shown: BibleText = 'en'
/** The Bible the reader reads: references are written and read in its numbering. */
export function setShownText(t: BibleText): void { shown = t }
export const peekShownText = (): BibleText => shown
export function setVerseMap(t: BibleText, m: VerseMap): void { maps[t] = m }

export interface Own { c: number; v: number }
/** English book b, chapter c, verse v as the Bible `t` numbers it. */
export function ownNumber(b: number, c: number, v: number, t: BibleText = shown): Own {
  const runs = maps[t]?.[`${b}.${c}`]
  const r = runs?.find(([v0, len]) => v >= v0 && v < v0 + len)
  return r ? { c: r[2], v: r[3] + (v - r[0]) } : { c, v }
}
/** Book b's chapters as Bible `t` prints them, in order, each with the English chapter and verse it begins at (French
 *  Joel's 3 begins at English 2:28). */
export function ownChapters(b: number, t: BibleText = shown): { n: number; c: number; v: number }[] {
  const counts = VERSE_COUNTS[b - 1] ?? []
  const m = maps[t]
  if (!m || !counts.some((_, i) => m[`${b}.${i + 1}`])) return counts.map((_, i) => ({ n: i + 1, c: i + 1, v: 1 }))
  const out: { n: number; c: number; v: number }[] = []
  const seen = new Set<number>()
  counts.forEach((len, i) => {
    for (let v = 1; v <= len; v++) {
      const own = ownNumber(b, i + 1, v, t).c
      if (!seen.has(own)) { seen.add(own); out.push({ n: own, c: i + 1, v }) }
    }
  })
  return out.sort((x, y) => x.n - y.n)
}

/** The English verse that Bible `t`'s chapter `nc`, verse `nv` of book b sits in; null for one with no English verse of
 *  its own (a psalm's title, numbered as a verse there). */
export function englishNumber(b: number, nc: number, nv: number, t: BibleText = shown): Own | null {
  const m = maps[t]
  if (!m) return { c: nc, v: nv }
  for (const [k, runs] of Object.entries(m)) {
    const [kb, kc] = k.split('.').map(Number)
    if (kb !== b) continue
    for (const [v0, len, rc, rv] of runs) if (rc === nc && nv >= rv && nv < rv + len) return { c: kc, v: v0 + (nv - rv) }
  }
  // not moved: the same place, unless that English verse is itself somewhere else in this Bible
  const here = m[`${b}.${nc}`]?.some(([v0, len]) => nv >= v0 && nv < v0 + len)
  return here ? null : { c: nc, v: nv }
}
