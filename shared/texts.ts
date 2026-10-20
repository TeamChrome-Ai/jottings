/**
 * The Bibles the app can show (docs/LANGUAGES.md): the English Darby, Darby's French and the Elberfelder he made with
 * Brockhaus. Every one is kept in the English Darby's chapters and verses, each verse carrying its own printed number
 * where that differs, so what a reader marks, keeps and shares is the same whichever they read.
 */
import type { Lang } from './i18n.js'
import { VERSE_COUNTS } from './verseCounts.js'

export type BibleText = 'en' | 'fr' | 'de'
export const TEXTS: readonly BibleText[] = ['en', 'fr', 'de']
export const isText = (v: unknown): v is BibleText => v === 'en' || v === 'fr' || v === 'de'

/** Each Bible by its own name, as a list of them shows it. */
export const TEXT_NAMES: Record<BibleText, string> = { en: 'Darby (English)', fr: 'Darby (français)', de: 'Elberfelder (Deutsch)' }
/** How a shared verse names its Bible: "— John 3:16 (Darby)". */
export const TEXT_SHORT: Record<BibleText, string> = { en: 'Darby', fr: 'Darby', de: 'Elberfelder' }
/** John 1:1-3 in each, for the text-size preview in Settings. */
export const TEXT_SAMPLE: Record<BibleText, readonly string[]> = {
  en: ['In the beginning was the Word, and the Word was with God, and the Word was God.', 'He was in the beginning with God.', 'All things received being through him, and without him not one thing received being which has received being.'],
  fr: ['Au commencement était la Parole ; et la Parole était auprès de Dieu ; et la Parole était Dieu.', 'Elle était au commencement auprès de Dieu.', 'Toutes choses furent faites par elle, et sans elle pas une seule chose ne fut faite de ce qui a été fait.'],
  de: ['Im Anfang war das Wort, und das Wort war bei Gott, und das Wort war Gott.', 'Dieses war im Anfang bei Gott.', 'Alles ward durch dasselbe, und ohne dasselbe ward auch nicht eines, das geworden ist.'],
}
/** The language each Bible is in (a reference, a heading and the device's voice follow it). */
export const TEXT_LANG: Record<BibleText, 'en' | 'fr' | 'de'> = { en: 'en', fr: 'fr', de: 'de' }

/** The reader's setting: a Bible, or `auto` for their language's own Darby (the English one where it has none). */
export type BiblePref = 'auto' | BibleText
export const parseBiblePref = (v: unknown): BiblePref => (v === 'auto' || isText(v) ? v : 'auto')
export function textOfLang(l: Lang): BibleText {
  if (l === 'fr' || l === 'fr-CA') return 'fr'
  return l === 'de' ? 'de' : 'en'
}
export const textOf = (p: BiblePref, l: Lang): BibleText => (p === 'auto' ? textOfLang(l) : p)

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
