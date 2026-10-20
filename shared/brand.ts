/**
 * The brand, read from `shared/brand.json` (docs/BRAND.md): the one place the client, the shared code and the scripts
 * take the product's name, the feature's noun and verb, the site, the link schemes, the package ids and the owner
 * from. No other file of code names any of them. The few values the code needs built from those are here too.
 */
import raw from './brand.json'
import { tc } from './i18n.js'

/**
 * The name set letter by letter for the welcome animation: each letter's left edge and advance in em of the bold
 * serif face, the whole width, the letter the seasonal mark stands in for on Home, and the dot that lands last (the
 * letter at `dot.letter` is drawn without its dot; `glyph` is the same letter with it). `letters` runs one to one with
 * the characters of `name`.
 */
export interface BrandWordmark {
  letters: string[]
  x: number[]
  advance: number[]
  width: number
  seasonal?: number
  dot?: { letter: number; glyph: string; x: number; y: number; size: number }
}
export interface Brand {
  name: string
  fullName: string
  storeName: string
  slug: string
  /** One sentence about the product: the web page's description. */
  description: string
  /** What the reader calls an outline, and the action that starts one. */
  noun: { one: string; many: string; verb: string }
  site: string
  host: string
  /** Other hosts that are this site (an earlier address). */
  extraHosts: string[]
  scheme: string
  extraSchemes: string[]
  androidPackage: string
  iosBundleId: string
  owner: string
  ownerShort: string
  contactEmail: string
  copyrightYear: number
  /** Absent: the name is drawn as plain text and the welcome shows it without the flight of dots. */
  wordmark?: BrandWordmark
}

export const BRAND: Brand = raw

export const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)
/** "a jotting", "an outline": "an" before a vowel letter. */
export const withArticle = (word: string): string => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`
/** The possessive of a name: "Reader’s", and "Readers’" for one that ends in s. */
export const possessive = (name: string): string => (/s$/i.test(name) ? `${name}’` : `${name}’s`)

/**
 * A noun and verb in the forms sentences need: `one` "jotting", `many` "jottings", `One` and `Many` capitalised for a
 * title or the start of a sentence, `a` "a jotting" and `A` "A jotting", `verb` "Jot" as the button reads and
 * `verbLower` "jot" inside a sentence.
 */
export const nounForms = (noun: Brand['noun']) => ({
  one: noun.one,
  many: noun.many,
  One: capitalise(noun.one),
  Many: capitalise(noun.many),
  a: withArticle(noun.one),
  A: capitalise(withArticle(noun.one)),
  verb: noun.verb,
  verbLower: noun.verb.toLowerCase(),
})
/**
 * The feature's noun and verb, as the reader sees them: in the app's language when its catalogue names them (context
 * "brand noun": "annotation", "une annotation", "Annoter"; scripts/i18n.mjs adds the keys), else the brand's own.
 */
const own = (s: string) => tc('brand noun', s)
export const NOUN = {
  get one() { return own(BRAND.noun.one) },
  get many() { return own(BRAND.noun.many) },
  get One() { return capitalise(own(BRAND.noun.one)) },
  get Many() { return capitalise(own(BRAND.noun.many)) },
  get a() { return own(withArticle(BRAND.noun.one)) },
  get A() { return capitalise(own(withArticle(BRAND.noun.one))) },
  get verb() { return own(BRAND.noun.verb) },
  get verbLower() { return own(BRAND.noun.verb).toLowerCase() },
} satisfies ReturnType<typeof nounForms>

/**
 * A brand's addresses: `siteUrl('/friends?t=…')` on its site, `appUrl('read/43/3?v=16')` by its own scheme, and
 * every scheme a link into the app may carry, its own first.
 */
export const linksOf = (brand: Pick<Brand, 'site' | 'scheme' | 'extraSchemes'>) => {
  const schemes: readonly string[] = [brand.scheme, ...brand.extraSchemes]
  return {
    siteUrl: (path = ''): string => `${brand.site}${path}`,
    appUrl: (route = ''): string => `${brand.scheme}://${route}`,
    schemes,
  }
}
export const { siteUrl, appUrl, schemes: SCHEMES } = linksOf(BRAND)
