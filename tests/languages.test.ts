import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { BOOKS, findBook, setNamesLang } from '@shared/books'
import { formatRef, parseRef, scanRefs } from '@shared/ref'
import { englishNumber, ownChapters, ownNumber, setShownText, setVerseMap, type VerseMap } from '@shared/texts'
import { langOfLocale, pluralCat, richParts, setLang, t, tc, tn } from '@shared/i18n'

// French Darby's numbering where it differs, as the data build writes it (a few chapters of it)
const FR: VerseMap = {
  '19.51': [[1, 19, 51, 3]],
  '29.2': [[28, 5, 3, 1]],
  '29.3': [[1, 21, 4, 1]],
  '39.4': [[1, 6, 3, 19]],
}
setVerseMap('fr', FR)

afterEach(() => { setShownText('en'); setNamesLang('en'); setLang('en', {}) })

describe('a Bible kept in the English numbering', () => {
  it('finds its own numbers and back', () => {
    expect(ownNumber(19, 51, 1, 'fr')).toEqual({ c: 51, v: 3 })
    expect(ownNumber(29, 2, 30, 'fr')).toEqual({ c: 3, v: 3 })
    expect(ownNumber(43, 3, 16, 'fr')).toEqual({ c: 3, v: 16 })
    expect(englishNumber(29, 4, 1, 'fr')).toEqual({ c: 3, v: 1 })
    expect(englishNumber(39, 3, 20, 'fr')).toEqual({ c: 4, v: 2 })
    // a psalm's title, numbered as a verse in the French: no English verse of its own
    expect(englishNumber(19, 51, 1, 'fr')).toBeNull()
  })

  it('writes references in the shown Bible and the app language', () => {
    expect(formatRef({ book: 19, chapter: 51, v1: 1 })).toBe('Psalms 51:1')
    setNamesLang('fr'); setShownText('fr')
    expect(formatRef({ book: 19, chapter: 51, v1: 1 })).toBe('Psaume 51:3')
    expect(formatRef({ book: 43, chapter: 3, v1: 16 })).toBe('Jean 3:16')
    expect(formatRef({ book: 29, chapter: 3 })).toBe('Joël 4')
    expect(formatRef({ book: 39, chapter: 4 })).toBe('Malachie 3:19-24')
    expect(formatRef({ book: 29, chapter: 2, v1: 27, v2: 29 })).toBe('Joël 2:27–3:2')
    expect(BOOKS[0].name).toBe('Genèse')
    setNamesLang('de'); setShownText('en')
    expect(formatRef({ book: 43, chapter: 3, v1: 16 })).toBe('Johannes 3,16')
  })

  it('reads what a reader types in their own numbering', () => {
    setNamesLang('fr'); setShownText('fr')
    expect(parseRef('Psaume 51:3')).toEqual({ book: 19, chapter: 51, v1: 1 })
    expect(parseRef('ésaïe 53')).toEqual({ book: 23, chapter: 53 })
    expect(parseRef('Joël 4')).toEqual({ book: 29, chapter: 3 })
    expect(parseRef('Joël 3')).toEqual({ book: 29, chapter: 2, v1: 28 })
    expect(parseRef('Mc 1:1')).toEqual({ book: 41, chapter: 1, v1: 1 })
    // English material keeps its own numbers
    expect(parseRef('Ps 51:1', { english: true })).toEqual({ book: 19, chapter: 51, v1: 1 })
    expect(scanRefs('voir Psaume 51. 3 et Joël 4. 2').map(s => s.ref)).toEqual([{ book: 19, chapter: 51, v1: 1 }, { book: 29, chapter: 3, v1: 2 }])
    setNamesLang('de'); setShownText('de')
    expect(parseRef('1. Mose 3,15')).toEqual({ book: 1, chapter: 3, v1: 15 })
    expect(scanRefs('Vergl. Joh 3,16').map(s => s.ref)).toEqual([{ book: 43, chapter: 3, v1: 16 }])
  })

  it('keeps the English lookups first in English', () => {
    expect(findBook('mc')?.n).toBe(33)
    setNamesLang('fr')
    expect(findBook('mc')?.n).toBe(41)
    expect(findBook('Genese')?.n).toBe(1)
  })

  it('writes and reads Italian book names over the English Darby', () => {
    setNamesLang('it'); setShownText('en')
    expect(formatRef({ book: 43, chapter: 3, v1: 16 })).toBe('Giovanni 3:16')
    expect(formatRef({ book: 19, chapter: 23 })).toBe('Salmo 23')
    expect(BOOKS[21].name).toBe('Cantico dei Cantici')
    expect(parseRef('Gv 3:16')).toEqual({ book: 43, chapter: 3, v1: 16 })
    expect(parseRef('1 co 13:4-7')).toEqual({ book: 46, chapter: 13, v1: 4, v2: 7 })
    expect(parseRef('sl 23')).toEqual({ book: 19, chapter: 23 })
    expect(parseRef('Giosuè 1')).toEqual({ book: 6, chapter: 1 })
    expect(findBook('Gna')?.n).toBe(32)
    expect(scanRefs('vedi Gv 3:16 e Ro 8:28').map(s => s.ref)).toEqual([{ book: 43, chapter: 3, v1: 16 }, { book: 45, chapter: 8, v1: 28 }])
  })
})

describe('the French Darby as built (client/public/bible-fr/map.json)', () => {
  // the texts are not in the public copy of the code (tools/public_export.sh): there this skips, as the other text tests do
  it.skipIf(!existsSync('client/public/bible-fr/19/51.json'))('numbers the chapters BPC prints differently as BPC does', () => {
    setVerseMap('fr', JSON.parse(readFileSync('client/public/bible-fr/map.json', 'utf8')) as VerseMap)
    setNamesLang('fr'); setShownText('fr')
    try {
      expect(formatRef({ book: 19, chapter: 51, v1: 1 })).toBe('Psaume 51:3')
      expect(formatRef({ book: 19, chapter: 23, v1: 1 })).toBe('Psaume 23:1')
      expect(formatRef({ book: 29, chapter: 3 })).toBe('Joël 4')
      expect(formatRef({ book: 29, chapter: 2, v1: 28 })).toBe('Joël 3:1')
      expect(formatRef({ book: 39, chapter: 4 })).toBe('Malachie 3:19-24')
      // a psalm whose title is its verses 1-2 is still "Psaume 51", not 51:3-21
      expect(formatRef({ book: 19, chapter: 51 })).toBe('Psaume 51')
      expect(formatRef({ book: 19, chapter: 3 })).toBe('Psaume 3')
      expect(formatRef({ book: 29, chapter: 2 })).toBe('Joël 2')
      expect(formatRef({ book: 3, chapter: 6, v1: 1 })).toBe('Lévitique 5:20')
      expect(formatRef({ book: 66, chapter: 13, v1: 1 })).toBe('Apocalypse 13:1')
      expect(formatRef({ book: 43, chapter: 3, v1: 16 })).toBe('Jean 3:16')
      expect(parseRef('Malachie 3:20')).toEqual({ book: 39, chapter: 4, v1: 2 })
      expect(ownChapters(29).map(c => [c.n, c.c, c.v])).toEqual([[1, 1, 1], [2, 2, 1], [3, 2, 28], [4, 3, 1]])
      expect(ownChapters(39).map(c => c.n)).toEqual([1, 2, 3])
      // each chapter file fills every English verse, in order
      const ch = JSON.parse(readFileSync('client/public/bible-fr/19/51.json', 'utf8')) as { tx: string; verses: { v: number; nv?: number }[] }
      expect(ch.tx).toBe('fr')
      expect(ch.verses.map(v => v.v)).toEqual(Array.from({ length: 19 }, (_, i) => i + 1))
      expect(ch.verses[0].nv).toBe(3)
    } finally { setVerseMap('fr', FR) }
  })
})

describe('phrases', () => {
  it('shows the English until a translation is there', () => {
    expect(t('Mark as read')).toBe('Mark as read')
    expect(tn(1, '{n} chapter', '{n} chapters')).toBe('1 chapter')
    expect(tn(0, '{n} chapter', '{n} chapters')).toBe('0 chapters')
    setLang('fr', { 'Mark as read': 'Marquer comme lu', ['done\u0004Read']: 'Lu', ['{n} chapter\u0000{n} chapters']: { one: '{n} chapitre', other: '{n} chapitres' } })
    expect(t('Mark as read')).toBe('Marquer comme lu')
    expect(tc('done', 'Read')).toBe('Lu')
    expect(tc('verb', 'Read')).toBe('Read')
    expect(tn(0, '{n} chapter', '{n} chapters')).toBe('0 chapitre')
    expect(tn(2, '{n} chapter', '{n} chapters')).toBe('2 chapitres')
    expect(t('Hello {name}', { name: 'Anne' })).toBe('Hello Anne')
  })
  it('knows the languages and their plural rules', () => {
    expect(langOfLocale('fr_CA')).toBe('fr-CA')
    expect(langOfLocale('fr-BE')).toBe('fr')
    expect(langOfLocale('de-AT')).toBe('de')
    expect(langOfLocale('it-CH')).toBe('it')
    expect(langOfLocale('es-ES')).toBe('en')
    expect(pluralCat('it', 0)).toBe('other')
    expect(pluralCat('it', 1)).toBe('one')
    expect(pluralCat('fr', 1.5)).toBe('one')
    expect(pluralCat('de', 0)).toBe('other')
    expect(richParts('Tap <b>Read</b> to begin')).toEqual(['Tap ', { tag: 'b', text: 'Read' }, ' to begin'])
  })
})
