/**
 * The app's words in the reader's language (docs/LANGUAGES.md). The English text is the key, as gettext does it: the code
 * reads as it always has, and a phrase with no translation yet shows in English. `t` for a phrase, `tc` for one whose
 * English is shared by two meanings ("Read" done, "Read" to do), `tn` for one that counts, `N_` to mark a phrase kept in a
 * constant (translated where it is shown, with `t`). `{name}` in a phrase is filled from `vars`; `<b>…</b>` marks a part
 * the screen styles (client/src/i18n: `tr`).
 *
 * The catalogue is the language's file (client/src/i18n/<lang>.json, made by scripts/i18n.mjs); pure modules read the
 * current one from here, so nothing in this file needs React Native.
 */

export type Lang = 'en' | 'fr' | 'fr-CA' | 'de' | 'nl' | 'sv'
export const LANGS: readonly Lang[] = ['en', 'fr', 'fr-CA', 'de', 'nl', 'sv']
/** Each language by its own name, as a language list shows it. */
export const LANG_NAMES: Record<Lang, string> = { en: 'English', fr: 'Français', 'fr-CA': 'Français (Canada)', de: 'Deutsch', nl: 'Nederlands', sv: 'Svenska' }
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as readonly string[]).includes(v)

/** The language a device's locale tag asks for ("fr-CA", "fr_FR", "de-AT"…); English for anything else. */
export function langOfLocale(tag: string | null | undefined): Lang {
  const [base, region] = (tag ?? '').replace('_', '-').split('-')
  const b = base?.toLowerCase()
  if (b === 'fr') return region?.toUpperCase() === 'CA' ? 'fr-CA' : 'fr'
  return b === 'de' || b === 'nl' || b === 'sv' ? b : 'en'
}

export type PluralCat = 'one' | 'other'
/** A catalogue: English key → its translation; a counted phrase (one + PLURAL + other) → its forms by plural category. */
export type Catalog = Record<string, string | Partial<Record<PluralCat, string>>>
/** gettext's separators: between a context and its phrase, and between the singular and plural English. */
export const CONTEXT = '\u0004'
export const PLURAL = '\u0000'

/** Which form a count takes: French counts 0 and 1 as one ("0 chapitre"), the others only 1. */
export function pluralCat(lang: Lang, n: number): PluralCat {
  if (lang === 'fr' || lang === 'fr-CA') return Math.abs(n) < 2 ? 'one' : 'other'
  return n === 1 ? 'one' : 'other'
}

let lang: Lang = 'en'
let cat: Catalog = {}
const listeners = new Set<(l: Lang) => void>()
export const peekLang = (): Lang => lang
/** The language shown and its catalogue (Canadian French: the French one with Canada's own words over it). */
export function setLang(l: Lang, catalog: Catalog): void {
  const changed = l !== lang
  lang = l
  cat = l === 'en' ? {} : catalog
  if (changed) listeners.forEach(f => f(l))
}
export function onLangChange(f: (l: Lang) => void): () => void { listeners.add(f); return () => { listeners.delete(f) } }

export type Vars = Record<string, string | number>
const fill = (s: string, vars?: Vars): string => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s)
const str = (x: Catalog[string] | undefined): string | undefined => (typeof x === 'string' && x ? x : undefined)

/** A phrase in the reader's language. */
export function t(s: string, vars?: Vars): string { return fill(str(cat[s]) ?? s, vars) }
/** A phrase whose English means two things: `ctx` tells them apart in the catalogue ("done" → "Lu", "verb" → "Lire"). */
export function tc(ctx: string, s: string, vars?: Vars): string { return fill(str(cat[ctx + CONTEXT + s]) ?? s, vars) }
/** A phrase that counts: `{n}` is the count; English takes `one` for 1 only, other languages by their own rule. */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  const forms = cat[one + PLURAL + other]
  const c = pluralCat(lang, n)
  const own = forms && typeof forms === 'object' ? forms[c] || forms.other : undefined
  return fill(own ?? (n === 1 ? one : other), { n, ...vars })
}
/** Marks a phrase for the catalogue where it is written; it is translated where shown, with `t`. */
export const N_ = <T extends string>(s: T): T => s

/** A phrase cut at its `<tag>…</tag>` parts, for a screen that styles them (`tr` in client/src/i18n). */
export type RichPart = string | { tag: string; text: string }
export function richParts(s: string): RichPart[] {
  const out: RichPart[] = []
  const re = /<(\w+)>(.*?)<\/\1>/gs
  let at = 0
  for (const m of s.matchAll(re)) {
    if (m.index > at) out.push(s.slice(at, m.index))
    out.push({ tag: m[1], text: m[2] })
    at = m.index + m[0].length
  }
  if (at < s.length) out.push(s.slice(at))
  return out
}
