import { describe, it, expect } from 'vitest'
import { quoteCandidates, quotePhrases, quoteWords, scanMinistry, scanTypedRefs, type MinistryAuthor } from '../client/src/lib/noteLinks'

const refsOf = (t: string) => scanTypedRefs(t).map(r => [t.slice(r.start, r.end), r.ref])
const ministry = (t: string, shown?: (a: MinistryAuthor) => boolean) => scanMinistry(t, scanTypedRefs(t), shown).map(m => [t.slice(m.start, m.end), m.target])

describe('references typed on a phone', () => {
  it('link in lower case as in capitals', () => {
    expect(refsOf('see john 3:16 and 1 cor 13:4-7')).toEqual([['john 3:16', { book: 43, chapter: 3, v1: 16 }], ['1 cor 13:4-7', { book: 46, chapter: 13, v1: 4, v2: 7 }]])
  })
  it('leave a short word alone: "is 5:30" is the time, not Isaiah', () => {
    expect(refsOf('the meeting is 5:30 at 3:15')).toEqual([])
    expect(refsOf('Is 5:30').length).toBe(1)
  })
})

describe('ministry named in a note', () => {
  it('links every way readers name Mr. Darby and Mr. Coates', () => {
    const names = (t: string) => ministry(t).map(([s, target]) => [s, (target as { author: string }).author])
    expect(names('JND, J.N.D., J. N. Darby, Mr. Darby, Mr Coates, C.A.C., Coates')).toEqual([
      ['JND', 'darby'], ['J.N.D.', 'darby'], ['J. N. Darby', 'darby'], ['Mr. Darby', 'darby'], ['Mr Coates', 'coates'], ['C.A.C.', 'coates'], ['Coates', 'coates'],
    ])
    // "Darby" alone is as often the translation
    expect(ministry("Darby's translation has it")).toEqual([])
  })
  it('links Mr. Wigram, Mr. Stoney and Mr. Raven, but not a raven', () => {
    expect(ministry('J.B.S. on John 13, FER on Romans 8, G.V.W. and J.G.B.').map(([t, x]) => [t, (x as { author: string }).author])).toEqual([['J.B.S.', 'stoney'], ['FER', 'raven'], ['G.V.W.', 'wigram'], ['J.G.B.', 'bellett']])
    expect(ministry('Mr. Raven said the raven was fed. Raven alone is a bird.').map(([t]) => t)).toEqual(['Mr. Raven'])
    expect(ministry('Stoney on Hebrews')[0][1]).toEqual({ author: 'stoney', book: 58 })
  })
  it('on the passage named after it', () => {
    expect(ministry('JND on John 3:16 is helpful')).toEqual([['JND', { author: 'darby', ref: { book: 43, chapter: 3, v1: 16 } }]])
    expect(ministry('Mr. Coates, Genesis 22')).toEqual([['Mr. Coates', { author: 'coates', ref: { book: 1, chapter: 22 } }]])
    expect(ministry("JND's Synopsis on romans 8:28")).toEqual([["JND's Synopsis", { author: 'darby', ref: { book: 45, chapter: 8, v1: 28 } }]])
    expect(ministry('Coates (Matthew 5)')).toEqual([['Coates', { author: 'coates', ref: { book: 40, chapter: 5 } }]])
  })
  it('on the book named after it, or else the author', () => {
    expect(ministry('Coates on Genesis')).toEqual([['Coates', { author: 'coates', book: 1 }]])
    expect(ministry('the Synopsis of Romans')).toEqual([['Synopsis', { author: 'darby', book: 45 }]])
    expect(ministry('as JND says')).toEqual([['JND', { author: 'darby' }]])
    // a passage further off is not his subject
    expect(ministry('JND said this, which reminds me of John 3:16')).toEqual([['JND', { author: 'darby' }]])
  })
  it('leaves out an author the edition hides', () => {
    expect(ministry('Mr. Coates on Genesis', a => a !== 'coates')).toEqual([])
  })
})

describe('scripture written out', () => {
  it('is looked for in quotations of four words or more and in lines of six or more', () => {
    const t = 'He said “God so loved the world” to me.\nFor God sent not his Son into the world to judge\nshort line here'
    expect(quoteCandidates(t, []).map(q => q.text)).toEqual(['God so loved the world', 'For God sent not his Son into the world to judge'])
  })
  it('never where a reference or a link already is', () => {
    const t = 'God so loved the world, John 3:16 says it all'
    const r = scanTypedRefs(t)
    expect(quoteCandidates(t, r)).toEqual([])
  })
  it('is compared word for word, brackets and case aside, whole first then its two ends', () => {
    expect(quoteWords('In [the] beginning, God!')).toEqual(['in', 'the', 'beginning', 'god'])
    expect(quotePhrases('God so loved the world')).toEqual(['god so loved the world'])
    expect(quotePhrases('For God so loved the world, that he gave his only-begotten Son')).toEqual([
      'for god so loved the world that he gave his only begotten son', 'for god so loved the world', 'he gave his only begotten son'])
    expect(quotePhrases('too short')).toEqual([])
  })
})
