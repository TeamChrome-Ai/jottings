// What a jotting's own words link to, beyond the references and web addresses lib/outlines.ts `segmentNote` finds:
// references typed in lower case ("john 3:16"), the ministry named in them ("JND on John 3", "Mr. Coates, Genesis 22"),
// and lines of scripture written out ("For God so loved the world"). Pure; the lookups live in lib/noteLookup.ts.
import { findBook } from '@shared/books'
import { scanRefs, type Ref, type RefSpan } from '@shared/ref'

/**
 * References as readers type them on a phone: "john 3:16", "1 cor 13:4". The book's first letter is raised (the text
 * keeps its length, so the spans stand) when a word of three letters or more is followed by chapter and verse. A
 * shorter word ("is 5:30", "at 3:15") is a word, not Isaiah or Acts.
 */
export function scanTypedRefs(text: string): RefSpan[] {
  const raised = text.replace(/\b((?:[1-3]\s?)?)([a-z])([a-z]{2,}\.?)(?=\s?\d{1,3}\s?[:.]\s?\d)/g, (_m, n: string, a: string, rest: string) => n + a.toUpperCase() + rest)
  return scanRefs(raised)
}

/** A ministry author a jotting can name. */
export type MinistryAuthor = 'darby' | 'coates' | 'bellett' | 'wigram' | 'stoney' | 'raven'

/** Where a mention of ministry leads: the author on a passage, on a book, or the author's shelf. */
export interface MinistryTarget { author: MinistryAuthor; ref?: Ref; book?: number }
export interface MinistrySpan { start: number; end: number; target: MinistryTarget }

/** The ways readers name them. Initials stand alone ("JND", "J.N.D.", "FER"); a surname alone only for Coates, Bellett,
 *  Wigram and Stoney, since "Darby" alone is as often the translation as the man and "Raven" the bird. "Synopsis" is Mr.
 *  Darby's. Longer forms first. */
const NAMES: readonly [MinistryAuthor, RegExp][] = [
  ['darby', /\b(?:John Nelson Darby|(?:J\.\s?N\.\s?D\.?|JND|Darby)['’]s\s+Synopsis|J\.\s?N\.\s?Darby|Mr\.?\s+Darby|J\.\s?N\.\s?D\.?|JND|jnd|Synopsis)(?![\w.])/g],
  ['coates', /\b(?:Charles Andrew Coates|C\.\s?A\.\s?Coates|Mr\.?\s+Coates|C\.\s?A\.\s?C\.?|CAC|Coates)(?![\w.])/g],
  ['bellett', /\b(?:John Gifford Bellett|J\.\s?G\.\s?Bellett|Mr\.?\s+Bellett|J\.\s?G\.\s?B\.?|JGB|Bellett)(?![\w.])/g],
  ['wigram', /\b(?:George Vicesimus Wigram|G\.\s?V\.\s?Wigram|Mr\.?\s+Wigram|G\.\s?V\.\s?W\.?|GVW|Wigram)(?![\w.])/g],
  ['stoney', /\b(?:James Butler Stoney|J\.\s?B\.\s?Stoney|Mr\.?\s+Stoney|J\.\s?B\.\s?S\.?|JBS|Stoney)(?![\w.])/g],
  ['raven', /\b(?:Frederick Edward Raven|F\.\s?E\.\s?Raven|Mr\.?\s+Raven|F\.\s?E\.\s?R\.?|FER)(?![\w.])/g],
]

/** What may stand between a name and the passage it is on: "JND on John 3", "Mr. Coates, Genesis 22", "JND's
 *  Synopsis on Romans", "Coates (Matthew 5)". */
const BRIDGE = /^(?:['’]s)?\s*(?:Synopsis\s+)?(?:on|of|in|at|re|for)?\s*[,:–—(-]?\s*(?:on\s+)?$/i
const MAX_BRIDGE = 24

/**
 * The ministry a note names, each with what it is on: a reference (from `refs`, the note's scripture spans) or a book
 * named right after it. `shown` leaves out an author the edition hides (lib/editionCore.ts `authorShown`).
 */
export function scanMinistry(text: string, refs: readonly RefSpan[], shown: (a: MinistryAuthor) => boolean = () => true): MinistrySpan[] {
  const out: MinistrySpan[] = []
  for (const [author, re] of NAMES) {
    if (!shown(author)) continue
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0, end = start + m[0].length
      if (out.some(s => start < s.end && end > s.start)) continue
      const target: MinistryTarget = { author }
      // the first reference starting soon after, with nothing but a bridge between
      const r = refs.find(x => x.start >= end && x.start - end <= MAX_BRIDGE && BRIDGE.test(text.slice(end, x.start)))
      if (r) target.ref = r.ref
      else {
        // a book named without a chapter: "Coates on Genesis", "JND's Synopsis of Romans"
        const after = /^(?:['’]s)?\s*(?:Synopsis\s+)?(?:on|of|in)\s+((?:[1-3]\s?)?[A-Z][a-z]+(?:\s(?:of\s)?[A-Z][a-z]+)?)/.exec(text.slice(end, end + 40))
        const book = after ? findBook(after[1]) : undefined
        if (book) target.book = book.n
      }
      out.push({ start, end, target })
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/** A stretch of a note that may be scripture written out: a quotation of four words or more, or a whole line of six
 *  or more that holds no reference of its own. */
export interface QuoteCandidate { start: number; end: number; text: string }
const QUOTED = /[“"‘]([^“”"‘’]{12,400})[”"’]/g
const words = (s: string) => s.match(/[\p{L}\p{N}'’]+/gu)?.length ?? 0

export function quoteCandidates(text: string, taken: readonly { start: number; end: number }[]): QuoteCandidate[] {
  const free = (a: number, b: number) => !taken.some(t => a < t.end && b > t.start)
  const out: QuoteCandidate[] = []
  for (const m of text.matchAll(QUOTED)) {
    const start = (m.index ?? 0) + 1, end = start + m[1].length
    if (words(m[1]) >= 4 && free(start, end)) out.push({ start, end, text: m[1] })
  }
  let at = 0
  for (const line of text.split('\n')) {
    const lead = line.length - line.trimStart().length
    const body = line.trim().replace(/^[-–•*>]\s*/, '')
    const start = at + line.indexOf(body), end = start + body.length
    if (words(body) >= 6 && body.length <= 400 && free(start, end) && !out.some(o => o.start < end && o.end > start)) out.push({ start, end, text: body })
    at += line.length + 1
    void lead
  }
  return out.sort((a, b) => a.start - b.start)
}

/** The words of a quotation as the search compares them: letters and digits, lower case, Darby's brackets dropped. */
export const quoteWords = (s: string): string[] => (s.toLowerCase().replace(/[[\]]/g, '').match(/[\p{L}\p{N}']+/gu) ?? []).map(w => w.replace(/^'+|'+$/g, '')).filter(Boolean)

/** The phrases to try for a quotation, best first: the whole, then its opening words, then its closing words. A short
 *  quotation (under eight words) is tried whole only. */
export function quotePhrases(s: string): string[] {
  const w = quoteWords(s)
  if (w.length < 4) return []
  if (w.length < 8) return [w.join(' ')]
  const head = w.slice(0, 6).join(' '), tail = w.slice(-6).join(' ')
  return [...new Set([w.slice(0, 24).join(' '), head, tail])]
}
