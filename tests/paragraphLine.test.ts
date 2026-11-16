// A paragraph of the library as a line of a study (client/src/lib/paragraphLine.ts, docs/ASSISTANT.md): the words that
// name it, the app's own web address for it, and that address read back as the place in the app it opens.
import { describe, it, expect } from 'vitest'
import { BRAND, siteUrl } from '../shared/brand'
import { paragraphAddress, paragraphLabel, paragraphRoute, printedLink, shownByWords } from '../client/src/lib/paragraphLine'

const DARBY = { id: 4711, author: 'darby', work: { id: 'cw-12', title: 'Collected Writings 12', collection: 'cw' }, n: 3, para: 5, section: 'On assurance' }

describe('the words of a paragraph line', () => {
  it('name the writer as the sources under an answer do, then the work and the section', () => {
    expect(paragraphLabel(DARBY)).toBe('Darby, Collected Writings 12, On assurance')
    expect(paragraphLabel({ ...DARBY, author: 'coates', work: { ...DARBY.work, title: 'An Outline of Romans' }, section: 'Romans 8' })).toBe('Coates, An Outline of Romans, Romans 8')
  })
  it('leave out a section that has no name of its own, and are never longer than a link’s words may be', () => {
    expect(paragraphLabel({ ...DARBY, section: '' })).toBe('Darby, Collected Writings 12')
    expect(paragraphLabel({ ...DARBY, section: 'Collected Writings 12' })).toBe('Darby, Collected Writings 12')
    expect(paragraphLabel({ ...DARBY, section: 'x'.repeat(400) }).length).toBeLessThanOrEqual(200)
  })
  it('give a writer the app has no name for by the library’s own word for them', () => {
    expect(paragraphLabel({ ...DARBY, author: 'someone' })).toBe('someone, Collected Writings 12, On assurance')
  })
})

describe('the address of a paragraph line', () => {
  it('is the app’s own web address for that paragraph: the site, the library’s screen, and the paragraph’s place', () => {
    expect(paragraphAddress(DARBY)).toBe(siteUrl('/companion?author=darby&work=cw-12&n=3&p=5'))
    expect(paragraphAddress(DARBY)).toMatch(/^https:\/\/[a-z.]+\/companion\?/)
    expect(paragraphAddress({ ...DARBY, work: { ...DARBY.work, id: 'notes & comments/1' } })).toBe(siteUrl('/companion?author=darby&work=notes%20%26%20comments%2F1&n=3&p=5'))
  })
  it('opens that paragraph in the app: read back, it is the place the sources under an answer open', () => {
    expect(paragraphRoute(paragraphAddress(DARBY))).toEqual({ pathname: '/companion', params: { author: 'darby', work: 'cw-12', n: '3', p: '5' } })
    expect(paragraphRoute(paragraphAddress({ ...DARBY, work: { ...DARBY.work, id: 'notes & comments/1' } }))).toEqual({ pathname: '/companion', params: { author: 'darby', work: 'notes & comments/1', n: '3', p: '5' } })
  })
  it('is known at an earlier address of the site too, and with or without www', () => {
    for (const host of [BRAND.host, `www.${BRAND.host}`, ...BRAND.extraHosts]) {
      expect(paragraphRoute(`https://${host}/companion?author=darby&work=cw-12&n=3&p=5`), host).toEqual({ pathname: '/companion', params: { author: 'darby', work: 'cw-12', n: '3', p: '5' } })
    }
  })
  it('is no place in the app when it is another site’s, another screen’s, or names no paragraph', () => {
    for (const url of [
      // (a host no brand has: the brand of a public copy of this code has a site of its own)
      'https://elsewhere.invalid/companion?author=darby&work=cw-12&n=3&p=5',
      `https://${BRAND.host}.example.org/companion?author=darby&work=cw-12&n=3&p=5`,
      `https://${BRAND.host}/outlines?author=darby&work=cw-12&n=3&p=5`,
      `https://${BRAND.host}/companion`,
      `https://${BRAND.host}/companion?author=darby`,
      `https://${BRAND.host}/companion?author=darby&work=cw-12&n=three&p=5`,
      `https://${BRAND.host}/companion?author=darby&work=cw-12&n=3`,
      `ftp://${BRAND.host}/companion?author=darby&work=cw-12&n=3&p=5`,
      'not an address', '',
    ]) expect(paragraphRoute(url), url).toBeNull()
  })
})

// In the app a paragraph line is its words: they say where it goes, and a tap opens it. The address is for where
// nobody can tap: the printed jotting. A link the reader put in themselves is shown as it always was.
describe('how a link line is shown', () => {
  const words = 'Darby, Collected Writings 12, On assurance'
  it('by its words alone in the app when its address is the app’s own for a paragraph, and it has words', () => {
    expect(shownByWords({ text: words, url: paragraphAddress(DARBY) })).toBe(true)
    for (const host of BRAND.extraHosts) expect(shownByWords({ text: words, url: `https://${host}/companion?author=darby&work=cw-12&n=3&p=5` }), host).toBe(true)
  })
  it('with its address, as before, when it is any other address: another site’s, or the site’s own that is no paragraph’s', () => {
    for (const url of [
      'https://elsewhere.invalid/an-article',
      'https://elsewhere.invalid/companion?author=darby&work=cw-12&n=3&p=5',
      siteUrl('/'), siteUrl('/o/abc123'), siteUrl('/outlines'), siteUrl('/companion'), siteUrl('/companion?author=darby'), siteUrl('/companion?author=darby&work=cw-12'),
      siteUrl('/read/43/3?v=16'),
    ]) expect(shownByWords({ text: 'A link of the reader’s own', url }), url).toBe(false)
  })
  it('with its address when it has no words to be shown by', () => {
    for (const text of [null, undefined, '', '   ']) expect(shownByWords({ text, url: paragraphAddress(DARBY) }), String(text)).toBe(false)
    expect(shownByWords({ text: words, url: null })).toBe(false)
  })
  it('on paper, a paragraph line is its words and its address, which nobody can tap there; any other link is printed as before, by its words, or by its address when it has none', () => {
    expect(printedLink({ text: words, url: paragraphAddress(DARBY) })).toEqual({ words, address: paragraphAddress(DARBY) })
    expect(printedLink({ text: 'A link of the reader’s own', url: 'https://elsewhere.invalid/an-article' })).toEqual({ words: 'A link of the reader’s own', address: null })
    expect(printedLink({ text: null, url: 'https://elsewhere.invalid/an-article' })).toEqual({ words: 'https://elsewhere.invalid/an-article', address: null })
    expect(printedLink({ text: '', url: paragraphAddress(DARBY) })).toEqual({ words: paragraphAddress(DARBY), address: null })
  })
})
