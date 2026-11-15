import { afterEach, describe, it, expect } from 'vitest'
import { parseRef, formatRef, formatVerseRuns, scanRefs, looksLikeRef, bareBook } from '../shared/ref'
import { findBookFuzzy, editDistance, setNamesLang } from '../shared/books'
import { findBook } from '../shared/books'
import { setShownText } from '../shared/texts'

describe('findBook', () => {
  it('resolves names, abbreviations and aliases', () => {
    expect(findBook('Genesis')?.n).toBe(1)
    expect(findBook('gen')?.n).toBe(1)
    expect(findBook('jn')?.n).toBe(43)
    expect(findBook('1 cor')?.n).toBe(46)
    expect(findBook('1cor')?.n).toBe(46)
    expect(findBook('I John')?.n).toBe(62)
    expect(findBook('song of solomon')?.n).toBe(22)
    expect(findBook('Phil')?.n).toBe(50)
    expect(findBook('Phlm')?.n).toBe(57)
    expect(findBook('rev')?.n).toBe(66)
    expect(findBook('xyz')).toBeUndefined()
  })
})

describe('parseRef', () => {
  it('parses chapter, verse and ranges', () => {
    expect(parseRef('jn 3:16')).toEqual({ book: 43, chapter: 3, v1: 16 })
    expect(parseRef('John 3.16')).toEqual({ book: 43, chapter: 3, v1: 16 })
    expect(parseRef('1 cor 13:4-7')).toEqual({ book: 46, chapter: 13, v1: 4, v2: 7 })
    expect(parseRef('ps 23')).toEqual({ book: 19, chapter: 23 })
    expect(parseRef('Psalm 119:105')).toEqual({ book: 19, chapter: 119, v1: 105 })
    expect(parseRef('jude 3')).toEqual({ book: 65, chapter: 1, v1: 3 })
    expect(parseRef('rev')).toEqual({ book: 66, chapter: 1 })
  })
  it('rejects nonsense', () => {
    expect(parseRef('gen 51')).toBeNull()
    expect(parseRef('love')).toBeNull()
    expect(parseRef('jn 3:20-16')).toBeNull()
  })
  it('bareBook is a book name with no chapter or verse (bare_book in rs/src/refparse.rs)', () => {
    for (const [q, n] of [['song', 22], ['Mark', 41], ['1 kings', 11], ['song of solomon', 22], ['sos', 22], ['first john', 62], [' gen. ', 1]] as const) expect(bareBook(q)?.n, q).toBe(n)
    for (const q of ['song 2', 'song 2:1', 'song of solomon 2', 'jn 3:16', '1 kings 8', 'jude 3', 'love', 'kings']) expect(bareBook(q), q).toBeUndefined()
  })
  it('looksLikeRef gates free text', () => {
    expect(looksLikeRef('jn 3:16')).toBe(true)
    expect(looksLikeRef('faith hope love')).toBe(false)
    expect(looksLikeRef('loving-kindness')).toBe(false)
  })
})

describe('formatRef / scanRefs', () => {
  it('formats single-chapter books without a chapter', () => {
    expect(formatRef({ book: 57, chapter: 1, v1: 3 })).toBe('Philemon 3')
    expect(formatRef({ book: 43, chapter: 3, v1: 16, v2: 18 }, 'abbr')).toBe('John 3:16-18')
  })
  it('finds references inside prose', () => {
    const refs = scanRefs('Compare John 3:16 with 1 John 4:9-10 and Psalm 23; Gen 1 too.')
    expect(refs.map(r => [r.ref.book, r.ref.chapter, r.ref.v1, r.ref.v2])).toEqual([[43, 3, 16, undefined], [62, 4, 9, 10], [19, 23, undefined, undefined], [1, 1, undefined, undefined]])
  })
  const flat = (s: string, ctx?: { book: number; chapter: number }) => scanRefs(s, ctx).map(r => `${s.slice(r.start, r.end)}=${r.ref.book}.${r.ref.chapter}${r.ref.v1 !== undefined ? ':' + r.ref.v1 : ''}${r.ref.v2 !== undefined ? '-' + r.ref.v2 : ''}`)
  it('reads a numbered book after a capitalised word as that book, not as the one without the figure', () => {
    // "See 1" is no book; the figure belongs to the name after it
    expect(flat('See 1 John 4:9, where it is said.')).toEqual(['1 John 4:9=62.4:9'])
    expect(flat('Compare 1 John 4:9 with John 4:9.')).toEqual(['1 John 4:9=62.4:9', 'John 4:9=43.4:9'])
    expect(flat('Read 1 Cor 13, then 2 Tim. 3:16; In 2 Peter 1:21 also.')).toEqual(['1 Cor 13=46.13', '2 Tim. 3:16=55.3:16', '2 Peter 1:21=61.1:21'])
    // a capitalised word and a figure with no book after them are still nothing
    expect(flat('Step 2 is next. Chapter 3 opens. Never 5 of them.')).toEqual([])
  })
  it('a word that takes a number of its own keeps its figure: the book after it is the one without a figure', () => {
    expect(flat('Chapter 3 John 1:1')).toEqual(['John 1:1=43.1:1'])
    expect(flat('Chapter 2 John 10')).toEqual(['John 10=43.10'])
    expect(flat('See Chapter 3 John 1:1 there.')).toEqual(['John 1:1=43.1:1'])
    expect(flat('Verse 2 Peter saw')).toEqual([])
    for (const word of ['Chapters', 'Verse', 'Verses', 'Page', 'Part', 'Section', 'Volume', 'Book', 'Question', 'Lesson', 'Hymn', 'Paragraph', 'Chap.', 'Ch.', 'Ver.', 'Vol.', 'No.', 'Sect.', 'Pt.']) {
      expect(flat(`${word} 3 John 2:1`), word).toEqual(['John 2:1=43.2:1'])
    }
    // a word that is itself a book keeps its figure as it always did, and the book after it is linked too. "Number"
    // is one: the scanner reads the opening of a book's name as the book, so "Number 3" is Numbers 3 as it was before
    expect(flat('Psalm 1 John 3:16')).toEqual(['Psalm 1=19.1', 'John 3:16=43.3:16'])
    expect(flat('Number 3 John 2:1')).toEqual(['Number 3=4.3', 'John 2:1=43.2:1'])
  })
  it('any other capitalised word gives a figure 1 to 3 to the numbered book that follows', () => {
    expect(flat('See 1 John 4:9')).toEqual(['1 John 4:9=62.4:9'])
    expect(flat('Read 1 Cor 13')).toEqual(['1 Cor 13=46.13'])
    expect(flat('In 2 Samuel 7')).toEqual(['2 Samuel 7=10.7'])
    expect(flat('Compare 1 Peter 1:3')).toEqual(['1 Peter 1:3=60.1:3'])
    expect(flat('And 2 Tim. 3:16 says, See Also 3 John 4.')).toEqual(['2 Tim. 3:16=55.3:16', '3 John 4=64.1:4'])
  })
  it('“Note” gives its figure to the book, as the footnotes write it (“see Note 1 Sam 2:8”: the note at 1 Samuel 2:8)', () => {
    expect(flat("Or 'earth:' see Note 1 Sam 2:8 and Matt 5:5.")).toEqual(['1 Sam 2:8=9.2:8', 'Matt 5:5=40.5:5'])
    expect(flat('Diakonos: see Note. 1Cor 4:1.')).toEqual(['1Cor 4:1=46.4:1'])
    expect(flat('[understanding]: see Note 1Cor 1:5.')).toEqual(['1Cor 1:5=46.1:5'])
    expect(flat('Note 3 John 1')).toEqual(['3 John 1=64.1:1'])
  })
  it('a full word with a stop after it ended a sentence, and an abbreviation without its stop is a word like any other', () => {
    expect(flat('That closes the Chapter. 1 John 4:9 goes on.')).toEqual(['1 John 4:9=62.4:9'])
    expect(flat('So ends the first Part. 1 Tim. 3 follows.')).toEqual(['1 Tim. 3=54.3'])
    // French "Par" is "by", not the short form of paragraph
    setNamesLang('fr'); setShownText('fr')
    expect(flat('Par 1 Jean 4:9 nous le savons.')).toEqual(['1 Jean 4:9=62.4:9'])
  })
  it('a figure 4 to 9, or of more than one digit, is never given to the book', () => {
    expect(flat('See 4 John 1:1')).toEqual(['John 1:1=43.1:1'])
    expect(flat('Read 9 John 2:1, And 12 John 3:16, Compare 21 John 4:1, Then 30 John 5:1')).toEqual(['John 2:1=43.2:1', 'John 3:16=43.3:16', 'John 4:1=43.4:1', 'John 5:1=43.5:1'])
    expect(flat('Chapter 9 John 1:1')).toEqual(['John 1:1=43.1:1'])
  })
  it('reads the same in German, French, Italian, Dutch and Swedish: the language’s own words for chapter and verse keep their figure', () => {
    setNamesLang('de'); setShownText('de')
    expect(flat('Kapitel 3. Johannes 1,1')).toEqual(['Johannes 1,1=43.1:1'])
    expect(flat('Kapitel 3 Johannes 1,1')).toEqual(['Johannes 1,1=43.1:1'])
    expect(flat('Vers 2 Johannes 3,16 und Kap. 1 Johannes 4,9')).toEqual(['Johannes 3,16=43.3:16', 'Johannes 4,9=43.4:9'])
    expect(flat('Siehe 1. Johannes 4,9')).toEqual(['1. Johannes 4,9=62.4:9'])
    // as the German footnotes write it
    expect(flat('Vergl. 1. Mose 3,15; Vergl. 2. Kor 5,17')).toEqual(['1. Mose 3,15=1.3:15', '2. Kor 5,17=47.5:17'])
    setNamesLang('fr'); setShownText('fr')
    expect(flat('Chapitre 3 Jean 1:1')).toEqual(['Jean 1:1=43.1:1'])
    expect(flat('Verset 2 Jean 3:16')).toEqual(['Jean 3:16=43.3:16'])
    expect(flat('Voir 1 Jean 4:9')).toEqual(['1 Jean 4:9=62.4:9'])
    setShownText('en')
    setNamesLang('it')
    expect(flat('Capitolo 3 Giovanni 1:1; Vedi 1 Giovanni 4:9')).toEqual(['Giovanni 1:1=43.1:1', '1 Giovanni 4:9=62.4:9'])
    setNamesLang('nl')
    expect(flat('Hoofdstuk 3 Johannes 1:1; Zie 1 Johannes 4:9')).toEqual(['Johannes 1:1=43.1:1', '1 Johannes 4:9=62.4:9'])
    setNamesLang('sv')
    expect(flat('Kapitel 3 Johannes 1:1; Jämför 1 Johannes 4:9')).toEqual(['Johannes 1:1=43.1:1', '1 Johannes 4:9=62.4:9'])
    // English words still keep their figure whatever language the app is in: the texts are English
    expect(flat('Chapter 3 Johannes 1:1')).toEqual(['Johannes 1:1=43.1:1'])
  })
  it('still ends on a long string of such words', () => {
    // each word is looked up as a book once or twice and the scan moves on: 100,000 characters in well under the
    // five seconds a test may take (about a second on a two-core box)
    const t0 = Date.now()
    expect(flat('See 1 '.repeat(5000) + 'John 4:9')).toEqual(['1 John 4:9=62.4:9'])
    expect(flat('Chapter 3 '.repeat(5000) + 'John 1:1')).toEqual(['John 1:1=43.1:1'])
    expect(flat('See 1 Chapter 2 Then 3 '.repeat(2000))).toEqual([])
    expect(Date.now() - t0).toBeLessThan(4000)
  })
  it('carries the book into bare chapter.verse continuations (Darby note style)', () => {
    expect(flat("see Gen 9:26 and 24.7. Other names: see Ex 3:14,15; Isa 40:28.")).toEqual(['Gen 9:26=1.9:26', '24.7=1.24:7', 'Ex 3:14=2.3:14', '15=2.3:15', 'Isa 40:28=23.40:28'])
    expect(flat("Lit. 'bondmen:' so chs. 6:12; 7.8; 8.14; and elsewhere.", { book: 2, chapter: 21 })).toEqual(['chs. 6:12=2.6:12', '7.8=2.7:8', '8.14=2.8:14'])
  })
  it('resolves ch. and ver. against the chapter the note sits in', () => {
    expect(flat("'Lest perhaps:' see ch. 5:25 and Mark 4:12.", { book: 40, chapter: 13 })).toEqual(['ch. 5:25=40.5:25', 'Mark 4:12=41.4:12'])
    expect(flat('i.e. Judah: see ver. 15.', { book: 1, chapter: 49 })).toEqual(['ver. 15=1.49:15'])
    expect(flat("Or 'plaited-work:' so vers. 13,14,25, and ch. 39:6,13,16,18; Ps 45:13.", { book: 2, chapter: 28 })).toEqual(['vers. 13=2.28:13', '14=2.28:14', '25=2.28:25', 'ch. 39:6=2.39:6', '13=2.39:13', '16=2.39:16', '18=2.39:18', 'Ps 45:13=19.45:13'])
    expect(flat('as ch. 11:11.', { book: 66, chapter: 13 })).toEqual(['ch. 11:11=66.11:11'])
    expect(flat('see ver. 15', undefined)).toEqual([])
  })
  it('does not link loose numbers', () => {
    expect(flat('There were 12 baskets, 5 loaves and 2 fish; 3.14 is pi.')).toEqual([])
    expect(flat('Adamah, soil: as Deut 26:2; in ver. 12 it is erets.', { book: 1, chapter: 2 })).toEqual(['Deut 26:2=5.26:2', 'ver. 12=1.2:12'])
  })
  it('links a citation that runs into the next chapter from its first verse, through the last of the citation', () => {
    // the link covers every word of the citation and opens where it starts; a reference is one chapter, so it names no end
    expect(flat('destroyed (2 Kings 9:30-10:28).')).toEqual(['2 Kings 9:30-10:28=12.9:30'])
    expect(flat('see 2 Kings 24:18-25:30 and')).toEqual(['2 Kings 24:18-25:30=12.24:18'])
    expect(flat('Colossians 1:24-2:5')).toEqual(['Colossians 1:24-2:5=51.1:24'])
    expect(flat('Luke 9:51–19:27')).toEqual(['Luke 9:51–19:27=42.9:51'])
    expect(flat('see ch. 3:7–4:13.', { book: 58, chapter: 1 })).toEqual(['ch. 3:7–4:13=58.3:7'])
  })
  it('reads that range in the French and German forms, and a German verse list stays a list', () => {
    setNamesLang('fr')
    expect(flat('Colossiens 1:24-2:5')).toEqual(['Colossiens 1:24-2:5=51.1:24'])
    expect(flat('2 Rois 9.30-10.28')).toEqual(['2 Rois 9.30-10.28=12.9:30'])
    setNamesLang('it')
    expect(flat('Colossesi 1:24-2:5')).toEqual(['Colossesi 1:24-2:5=51.1:24'])
    setNamesLang('de')
    expect(flat('2. Könige 9,30-10,28')).toEqual(['2. Könige 9,30-10,28=12.9:30'])
    expect(flat('2. Könige 24,18-25,30')).toEqual(['2. Könige 24,18-25,30=12.24:18'])
    expect(flat('Ex 3,14-15,16')).toEqual(['Ex 3,14-15=2.3:14-15', '16=2.3:16'])
    expect(flat('Joh 3,16-18')).toEqual(['Joh 3,16-18=43.3:16-18'])
  })
  it('does not take the next sentence for the end of a range', () => {
    expect(flat('See John 3:16-18. 2 Kings 5:8.')).toEqual(['John 3:16-18=43.3:16-18', '2 Kings 5:8=12.5:8'])
    // a number after the range is the next chapter only when it follows the citation's own separator
    expect(flat('1 Cor 13:4-7. 8 is love.')).toEqual(['1 Cor 13:4-7=46.13:4-7'])
    expect(flat('Ps 23:1-6. 7 is not a verse.')).toEqual(['Ps 23:1-6=19.23:1-6'])
    expect(flat('Rom 8.1-4. 5 follows.')).toEqual(['Rom 8.1-4=45.8:1-4'])
  })
  it('reads a colon into the next chapter with a space after it, as the ministry prints some', () => {
    expect(flat('Gen. 1:1–2: 3')).toEqual(['Gen. 1:1–2: 3=1.1:1'])
    expect(flat('Rev. 21:9–22: 5')).toEqual(['Rev. 21:9–22: 5=66.21:9'])
    expect(flat('Gal. 2:19–3: 14')).toEqual(['Gal. 2:19–3: 14=48.2:19'])
  })
  it('reads a one-chapter book’s lone number as a verse, and a list continues there', () => {
    // the notes: Matt 15:27, Acts 4:24, Rom 5:13, Eph 5:4, 1 John 2:28, 1 John 3:1
    expect(flat('see Philemon 20 and Jude 4')).toEqual(['Philemon 20=57.1:20', 'Jude 4=65.1:4'])
    expect(flat('see Philemon 20, and so it is taken by many.')).toEqual(['Philemon 20=57.1:20'])
    expect(flat('2Pet 2:1; Jude 4; Rev 6:10.')).toEqual(['2Pet 2:1=61.2:1', 'Jude 4=65.1:4', 'Rev 6:10=66.6:10'])
    expect(flat('this only in Philem. 18.')).toEqual(['Philem. 18=57.1:18'])
    expect(flat("see Col 3:18, Philem. 8, 'fitting'")).toEqual(['Col 3:18=51.3:18', 'Philem. 8=57.1:8'])
    expect(flat('(so 3John 10) sets out')).toEqual(['3John 10=64.1:10'])
    expect(flat('2John 1,4,13; 3John 4.')).toEqual(['2John 1=63.1:1', '4=63.1:4', '13=63.1:13', '3John 4=64.1:4'])
  })
})

afterEach(() => { setNamesLang('en'); setShownText('en') })


describe('misspelt book names', () => {
  it('measures swaps as one edit', () => {
    expect(editDistance('jhon', 'john')).toBe(1)
    expect(editDistance('pslams', 'psalms')).toBe(1)
    expect(editDistance('galations', 'galatians')).toBe(1)
  })
  it('finds the intended book for common typos', () => {
    expect(findBookFuzzy('Jhon')?.name).toBe('John')
    expect(findBookFuzzy('Pslams')?.name).toBe('Psalms')
    expect(findBookFuzzy('Galations')?.name).toBe('Galatians')
    expect(findBookFuzzy('Revalation')?.name).toBe('Revelation')
    expect(findBookFuzzy('Mathew')?.name).toBe('Matthew')
    expect(findBookFuzzy('Ecclesiates')?.name).toBe('Ecclesiastes')
    expect(findBookFuzzy('1 Corinthans')?.name).toBe('1 Corinthians')
  })
  it('does not guess from short or unrelated words', () => {
    expect(findBookFuzzy('god')).toBeUndefined()
    expect(findBookFuzzy('lord')).toBeUndefined()
    expect(findBookFuzzy('shepherd')).toBeUndefined()
  })
  it('parses a misspelt reference only when asked', () => {
    expect(parseRef('Jhon 3:16')).toBeNull()
    expect(parseRef('Jhon 3:16', { fuzzy: true })).toEqual({ book: 43, chapter: 3, v1: 16 })
    expect(parseRef('pslam 23', { fuzzy: true })).toEqual({ book: 19, chapter: 23 })
  })
})

it('v separates chapter and verse like a colon', () => {
  expect(parseRef('jn 3v16')).toEqual({ book: 43, chapter: 3, v1: 16 })
  expect(parseRef('Lev 3 v 4-6')).toEqual({ book: 3, chapter: 3, v1: 4, v2: 6 })
  expect(parseRef('rev')).toEqual({ book: 66, chapter: 1 })
})

describe('formatVerseRuns', () => {
  it('compresses every run, not just the first', () => {
    expect(formatVerseRuns(1, 1, [1, 2, 4, 5])).toBe('Genesis 1:1-2, 4-5')
    expect(formatVerseRuns(1, 1, [1, 2, 4, 5], 'abbr')).toBe('Gen 1:1-2, 4-5')
    expect(formatVerseRuns(1, 1, [1, 2, 3, 7, 9, 10, 11])).toBe('Genesis 1:1-3, 7, 9-11')
  })
  it('handles single verses, one run and unsorted or repeated input', () => {
    expect(formatVerseRuns(43, 3, [16])).toBe('John 3:16')
    expect(formatVerseRuns(43, 3, [16, 17, 18])).toBe('John 3:16-18')
    expect(formatVerseRuns(43, 3, [18, 16, 17, 16, 20])).toBe('John 3:16-18, 20')
    expect(formatVerseRuns(43, 3, [1, 3, 5])).toBe('John 3:1, 3, 5')
  })
  it('names the chapter when nothing is selected and drops the chapter for one-chapter books', () => {
    expect(formatVerseRuns(19, 23, [])).toBe('Psalms 23')
    expect(formatVerseRuns(65, 1, [3, 4, 6])).toBe('Jude 3-4, 6')
  })
})
