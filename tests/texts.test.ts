// The Bibles read beside Darby's (docs/LANGUAGES.md): the King James Version and Young's Literal Translation are
// English Bibles that are not the English Bible, so a Bible's id is not its language; Darby stays everyone's default;
// each added text has one switch that leaves it out.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setNamesLang } from '@shared/books'
import { LANGS } from '@shared/i18n'
import { formatRef, parseRef, scanRefs } from '@shared/ref'
import { TEXTS, TEXT_LANG, TEXT_NAMES, TEXT_SAMPLE, TEXT_SHORT, isText, ownChapters, ownNumber, parseBiblePref, setShownText, setVerseMap, textOf, textOfLang, type BibleText, type VerseMap } from '@shared/texts'
import { SOURCES, archivePath, chapterEdition, chapterPath, chapterStoreKey, parseStoreKey, setEditionState, withEdition } from '../client/src/lib/editionCore'
import { HAS_TEXTS } from './_texts'

const ROOT = join(__dirname, '..')
// the one place they and Darby number differently, as the data build writes it (client/public/bible-<id>/map.json)
const MAP: VerseMap = { '66.12': [[18, 1, 13, 1]] }
const ADDED = ['kjv', 'ylt'] as const
for (const id of ADDED) setVerseMap(id as BibleText, MAP)
afterEach(() => { setShownText('en'); setNamesLang('en'); vi.unstubAllEnvs(); vi.resetModules() })

describe('a Bible’s id is not its language', () => {
  it('knows the two English Bibles beside Darby’s, in English', () => {
    expect([...TEXTS]).toEqual(['en', 'kjv', 'ylt', 'fr', 'de'])
    for (const id of ADDED) {
      expect(isText(id)).toBe(true)
      expect(TEXT_LANG[id as BibleText]).toBe('en')
    }
    expect([TEXT_LANG.en, TEXT_LANG.fr, TEXT_LANG.de]).toEqual(['en', 'fr', 'de'])
    expect([TEXT_NAMES['kjv' as BibleText], TEXT_NAMES['ylt' as BibleText]]).toEqual(['King James Version', 'Young’s Literal Translation'])
    expect([TEXT_SHORT['kjv' as BibleText], TEXT_SHORT['ylt' as BibleText]]).toEqual(['KJV', 'YLT'])
  })
  it('keeps Darby the Bible of every language: no language’s own Bible is an added one', () => {
    for (const l of LANGS) expect(['en', 'fr', 'de']).toContain(textOfLang(l))
    expect(textOf('auto', 'en')).toBe('en')
    expect(textOf(parseBiblePref(undefined), 'en')).toBe('en')
    // chosen, it is the Bible read whatever the app's language
    expect([textOf(parseBiblePref('kjv'), 'en'), textOf(parseBiblePref('ylt'), 'fr')]).toEqual(['kjv', 'ylt'])
  })
  it.skipIf(!HAS_TEXTS)('shows John 1:1-3 of each as its text has it', () => {
    for (const id of ADDED) {
      const ch = JSON.parse(readFileSync(join(ROOT, `data/text_${id}.json`), 'utf8')).books[42].chapters[0] as { verses: { t: string }[] }
      expect([...TEXT_SAMPLE[id as BibleText]]).toEqual(ch.verses.slice(0, 3).map(v => v.t))
    }
  })

  it('writes and reads references in English, in the text’s own numbers', () => {
    for (const id of ADDED) {
      setShownText(id as BibleText)
      expect(formatRef({ book: 43, chapter: 3, v1: 16 })).toBe('John 3:16')
      // Darby's Revelation 12:18 is the opening of their 13:1
      expect(formatRef({ book: 66, chapter: 12, v1: 18 })).toBe('Revelation 13:1')
      expect(formatRef({ book: 66, chapter: 13, v1: 1 })).toBe('Revelation 13:1')
      expect(formatRef({ book: 66, chapter: 12, v1: 17 })).toBe('Revelation 12:17')
      expect(ownNumber(66, 12, 18)).toEqual({ c: 13, v: 1 })
      expect(parseRef('Revelation 13:1')).toEqual({ book: 66, chapter: 12, v1: 18 })
      expect(parseRef('Rev 13:2')).toEqual({ book: 66, chapter: 13, v1: 2 })
      expect(parseRef('John 3:16')).toEqual({ book: 43, chapter: 3, v1: 16 })
      // their chapter 13 begins at Darby's 12:18; every other chapter where Darby's does
      expect(ownChapters(66).filter(c => c.v !== 1).map(c => [c.n, c.c, c.v])).toEqual([[13, 12, 18]])
      expect(scanRefs('see John 3:16 and Rev 13:1').map(s => s.ref)).toEqual([{ book: 43, chapter: 3, v1: 16 }, { book: 66, chapter: 12, v1: 18 }])
    }
  })
  it('reads a word before a figure (“See 1 John 4:9”, “Chapter 3 John 1:1”) by the Bible’s language, as with the English Darby', () => {
    // a capitalised word that is no book, before a lone figure, is looked up in the words of the language the Bible is
    // in ("chapter", "Kapitel"): a language, which the Bible's id is not
    for (const id of ADDED) {
      setShownText(id as BibleText)
      expect(scanRefs('See 1 John 4:9').map(s => s.ref)).toEqual([{ book: 62, chapter: 4, v1: 9 }])
      expect(scanRefs('Chapter 3 John 1:1').map(s => s.ref)).toEqual([{ book: 43, chapter: 1, v1: 1 }])
    }
  })
  it('separates chapter and verse as the Bible’s language does, not as its id is spelt', () => {
    // German screens over the King James Version: the app's language sets the comma, as over the English Darby
    setNamesLang('de'); setShownText('kjv' as BibleText)
    expect(formatRef({ book: 43, chapter: 3, v1: 16 })).toBe('Johannes 3,16')
    setNamesLang('en')
    expect(formatRef({ book: 43, chapter: 3, v1: 16 })).toBe('John 3:16')
    expect(scanRefs('John 3,16').map(s => s.ref)).not.toEqual([{ book: 43, chapter: 3, v1: 16 }])
  })

  it('offers the recorded voices only with the words they read', async () => {
    const { voicesFor } = await import('@shared/texts')
    // the recordings are of the English Darby; his French and the Elberfelder list them with a line saying so, as they
    // always have; an English Bible beside his would have them read other words than the page's, so they are not offered
    expect([voicesFor('en'), voicesFor('fr'), voicesFor('de')]).toEqual(['recorded', 'stated', 'stated'])
    for (const id of ADDED) expect(voicesFor(id as BibleText)).toBe('device')
  })
  it('stores, fetches and names each one’s chapters as its own', () => {
    expect([...SOURCES]).toEqual(['1961', '1890', 'kjv', 'ylt', 'fr', 'de'])
    for (const id of ADDED) {
      expect(chapterStoreKey(id as never, 43, 3)).toBe(`${id}:43.3`)
      expect(parseStoreKey(`${id}:43.3`)).toEqual({ edition: id, book: 43, chapter: 3 })
      expect(chapterPath(id as never, 43, 3, 'abc')).toBe(`/bible-${id}/43/3.json?v=abc`)
      expect(archivePath(id as never, 'abc')).toBe(`/bible-${id}/all.json?v=abc`)
      // a stored chapter says which Bible it is: never taken for the English Darby's
      expect(chapterEdition({ tx: id })).toBe(id)
    }
    expect([chapterEdition({ tx: 'fr' }), chapterEdition({ tx: 'xx' }), chapterEdition({})]).toEqual(['fr', '1961', '1961'])
    expect(parseStoreKey('xx:43.3')).toBeNull()
  })
  it('asks the server for the Bible read by its id', () => {
    setEditionState('1961')
    setShownText('kjv' as BibleText)
    expect(withEdition('/search?q=begotten')).toBe('/search?q=begotten&ed=1961&tx=kjv')
    setShownText('en')
    expect(withEdition('/search?q=begotten')).toBe('/search?q=begotten&ed=1961')
  })
})

describe('leaving a text out of a build (BEREAN_WITHOUT_KJV=1, BEREAN_WITHOUT_YLT=1)', () => {
  const load = async (env: Record<string, string>) => {
    vi.resetModules(); vi.unstubAllEnvs()
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
    return import('@shared/texts')
  }
  it('lists every text when nothing is switched', async () => {
    expect([...(await load({})).TEXTS]).toEqual(['en', 'kjv', 'ylt', 'fr', 'de'])
  })
  it('leaves out the one switched and nothing else', async () => {
    expect([...(await load({ BEREAN_WITHOUT_KJV: '1' })).TEXTS]).toEqual(['en', 'ylt', 'fr', 'de'])
    expect([...(await load({ BEREAN_WITHOUT_YLT: '1' })).TEXTS]).toEqual(['en', 'kjv', 'fr', 'de'])
    expect([...(await load({ BEREAN_WITHOUT_KJV: '1', BEREAN_WITHOUT_YLT: '1' })).TEXTS]).toEqual(['en', 'fr', 'de'])
    // only "1" switches; Darby's own Bibles have no switch
    expect([...(await load({ BEREAN_WITHOUT_KJV: '0', BEREAN_WITHOUT_FR: '1', BEREAN_WITHOUT_EN: '1' })).TEXTS]).toEqual(['en', 'kjv', 'ylt', 'fr', 'de'])
  })
  it('credits each text with its source and its public-domain standing, and not one that is left out', async () => {
    const rows = async (env: Record<string, string>) => {
      await load(env)
      const { creditsFor } = await import('../client/src/lib/credits')
      return (['1961', '1890'] as const).map(e => creditsFor(e, false)[0].items.map(i => ({ name: i.name, what: i.what, licence: i.licence, url: i.url })))
    }
    for (const list of await rows({})) {
      const kjv = list.find(i => /King James Version/.test(i.name)), ylt = list.find(i => /Young’s Literal Translation/.test(i.name))
      expect([kjv?.licence, kjv?.url, ylt?.licence, ylt?.url]).toEqual(['Public domain', 'https://ebible.org/find/details.php?id=eng-kjv2006', 'Public domain', 'https://ebible.org/find/details.php?id=engylt'])
      expect(`${kjv?.what} ${ylt?.what}`).toMatch(/eBible\.org.*eBible\.org/)
    }
    for (const list of await rows({ BEREAN_WITHOUT_KJV: '1' })) expect(list.filter(i => /King James Version \(|Young’s Literal/.test(i.name)).map(i => i.url)).toEqual(['https://ebible.org/find/details.php?id=engylt'])
    for (const list of await rows({ BEREAN_WITHOUT_YLT: '1' })) expect(list.filter(i => /King James Version \(|Young’s Literal/.test(i.name)).map(i => i.url)).toEqual(['https://ebible.org/find/details.php?id=eng-kjv2006'])
  })
  it('reads Darby where a reader had chosen the text left out, and keeps what they chose', async () => {
    const x = await load({ BEREAN_WITHOUT_KJV: '1' })
    // the stored choice is still a Bible's id, so nothing rewrites it; it is simply not what is shown
    expect(x.parseBiblePref('kjv')).toBe('kjv')
    expect(x.isText('kjv')).toBe(true)
    expect([x.textOf('kjv' as never, 'en'), x.textOf('kjv' as never, 'fr'), x.textOf('ylt' as never, 'en')]).toEqual(['en', 'fr', 'ylt'])
    // nor is it set beside the Bible read
    expect([x.secondText('kjv' as never), x.secondText('ylt' as never), x.secondText('')]).toEqual(['', 'ylt', ''])
  })
})

describe.skipIf(!existsSync(join(ROOT, 'client/public/bible-kjv/66/12.json')))('the added texts as built (client/public/bible-<id>)', () => {
  it.each(ADDED)('%s: its chapter files say whose they are and carry its own number where it differs', id => {
    const read = (p: string) => JSON.parse(readFileSync(join(ROOT, `client/public/bible-${id}/${p}`), 'utf8'))
    expect(read('map.json')).toEqual(MAP)
    expect(typeof read('meta.json').v).toBe('string')
    const ch = read('66/12.json') as { tx: string; verses: { v: number; t: string; nv?: number; nc?: number }[] }
    expect(ch.tx).toBe(id)
    expect(ch.verses.length).toBe(18)
    expect(ch.verses[17]).toEqual({ v: 18, t: 'And I stood upon the sand of the sea,', nv: 1, nc: 13 })
    expect((read('66/13.json') as typeof ch).verses[0].nv).toBeUndefined()
    // no note, no Strong's number, nothing but the words (and the King James Version's italics)
    const john3 = JSON.stringify(read('43/3.json'))
    expect(john3).not.toMatch(/"notes"|strong|\\\\|¶/)
  })
  it('reads John 3:16 in each', () => {
    const v16 = (id: string) => (JSON.parse(readFileSync(join(ROOT, `client/public/bible-${id}/43/3.json`), 'utf8')) as { verses: { t: string }[] }).verses[15].t
    expect(v16('kjv')).toContain('should not perish, but have everlasting life')
    expect(v16('ylt')).toContain('may not perish, but may have life age-during')
  })
})
