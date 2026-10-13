import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { articlesFor, articleWords, buildIndex, fold, groupOf, isLookupWord, letterOf, matchWord, nameKey, paginate, searchHeadwords, sheetParts, stemForms, translitKey, twoLetterGroups, wholeWord, wordForms, type CbdIndexRow } from '../shared/cbd'
import { HAS_TEXTS } from './_texts'

// the converter's own tests are in cbd_convert.test.ts, with the other converters'
const ROOT = path.resolve(__dirname, '..')

describe('folding', () => {
  it('folds Greek, names and transliterations the way the converter does', () => {
    expect(fold('πνεῦμα')).toBe('πνευμα')
    expect(fold('Ἀββᾶ')).toBe('αββα')
    expect(fold('λόγος')).toBe('λογοσ')
    expect(nameKey("ABEL-BETH-MA'ACHAH")).toBe(nameKey('Abelbethmaachah'))
    expect(translitKey('ʼâdôwn')).toBe('adon')
    expect(translitKey('rûwach')).toBe('ruach')
    expect(translitKey('Aarṓn')).toBe('aaron')
    expect(letterOf('Abel-beth-maachah')).toBe('A')
  })

  it('makes singular and plural forms, leaving short words alone', () => {
    expect(wordForms('teachers').slice(0, 2)).toEqual(['teachers', 'teacher'])
    expect(wordForms('Spirit,')).toEqual(expect.arrayContaining(['spirit', 'spirits']))
    expect(wordForms('cities')).toContain('city')
    expect(wordForms('witnesses')).toContain('witness')
    expect(wordForms('hates')).not.toContain('hat')
    expect(wordForms("God's")).toEqual(['god'])
    expect(wordForms('as')).toEqual(['as'])
    expect(wordForms('has')).toEqual(['has'])
  })

})

describe('searchHeadwords, and the links between an article and Strong’s numbers', () => {
  const row = (id: string, headword: string, extra: Partial<{ aliases: string[]; see: string; words: [string, string][] }> = {}): CbdIndexRow =>
    [id, headword, extra.aliases ?? [], [], [], extra.see ?? '', 0, extra.words ?? []]
  const index = buildIndex([
    row('ghost', 'Ghost', { words: [['G4151', 'πνεῦμα']] }),
    row('holy-ghost', 'Holy Ghost', { aliases: ['Holy Spirit'] }),
    row('master', 'Master', { words: [['G2962', 'κύριος'], ['G1320', 'διδάσκαλος'], ['H113', 'אָדוֹן']] }),
    row('put', 'Put', { aliases: ['Phut'] }),
    row('soul', 'Soul', { words: [['G5590', 'ψυχή'], ['G4151', 'πνεῦμα']] }),
    row('spirit', 'Spirit', { see: 'soul' }),
    row('teacher', 'Teacher', { aliases: ['Teaching'], words: [['G1320', 'διδάσκαλος']] }),
    row('syn-to-touch-handle', 'To Touch, Handle', { aliases: ['Touch', 'Handle'] }),
  ])

  it('gives an article’s Greek and Hebrew as Strong’s numbers, in the article’s order', () => {
    expect(articleWords(index.byId.get('master')).map(w => w[0])).toEqual(['G2962', 'G1320', 'H113'])
    expect(articleWords(index.byId.get('holy-ghost'))).toEqual([])
    expect(articleWords(undefined)).toEqual([])
    // an index from before the numbers were added
    expect(articleWords(['old', 'Old', [], [], [], '', 0] as unknown as CbdIndexRow)).toEqual([])
  })

  it('lists a number’s articles in index order, each once, never a "See X" stub', () => {
    expect(articlesFor(index, 'G1320')).toEqual([{ id: 'master', headword: 'Master' }, { id: 'teacher', headword: 'Teacher' }])
    expect(articlesFor(index, 'G4151').map(a => a.id)).toEqual(['ghost', 'soul'])
    expect(articlesFor(index, 'H113').map(a => a.id)).toEqual(['master'])
    // H1130 is another word: numbers match exactly
    expect(articlesFor(index, 'H1130')).toEqual([])
  })

  it('searches headwords by prefix, then aliases, then contains', () => {
    expect(searchHeadwords(index, 'tea').map(r => r[0])).toEqual(['teacher'])
    expect(searchHeadwords(index, 'hand').map(r => r[0])).toEqual(['syn-to-touch-handle'])
    expect(searchHeadwords(index, 'ghost').map(r => r[0])).toEqual(['ghost', 'holy-ghost'])
    expect(searchHeadwords(index, 'phut').map(r => r[0])).toEqual(['put'])
    expect(searchHeadwords(index, '  ')).toEqual([])
  })
})

describe('browsing: two-letter groups and pages', () => {
  const r = (headword: string): CbdIndexRow => [nameKey(headword), headword, [], [], [], '', 0, []]
  it('groups a letter by its first two letters, a one-letter headword on its own, in order, with counts', () => {
    expect(groupOf('Abel-beth-maachah')).toBe('Ab')
    expect(groupOf('A')).toBe('A')
    expect(twoLetterGroups([r('Abana'), r('Aaron'), r('A'), r('Abel'), r('Adam'), r('Aaronites')])).toEqual([
      { group: 'A', count: 1 }, { group: 'Aa', count: 2 }, { group: 'Ab', count: 2 }, { group: 'Ad', count: 1 },
    ])
    expect(twoLetterGroups([])).toEqual([])
  })

  it.skipIf(!HAS_TEXTS)('groups the real index: only groups that exist, and every A headword in exactly one', () => {
    const rows = (JSON.parse(readFileSync(path.join(ROOT, 'data/cbd/index.json'), 'utf8')) as CbdIndexRow[]).filter(x => !x[0].startsWith('syn-') && letterOf(x[1]) === 'A')
    const groups = twoLetterGroups(rows)
    expect(groups.every(g => g.count > 0 && g.group.startsWith('A'))).toBe(true)
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(rows.length)
    expect(groups.find(g => g.group === 'Ab')!.count).toBeGreaterThan(30)
    expect(groups.some(g => g.group === 'Ao')).toBe(false)
  })

  it('pages a list, clamping the page and saying which items it shows', () => {
    const list = Array.from({ length: 63 }, (_, i) => i + 1)
    expect(paginate(list, 1, 30)).toMatchObject({ page: 1, pages: 3, total: 63, first: 1, last: 30 })
    expect(paginate(list, 2, 30).items).toEqual(list.slice(30, 60))
    expect(paginate(list, 3, 30)).toMatchObject({ page: 3, items: [61, 62, 63], first: 61, last: 63 })
    expect(paginate(list, 9, 30).page).toBe(3)
    expect(paginate(list, 0, 30).page).toBe(1)
    expect(paginate(list, NaN, 30).page).toBe(1)
    expect(paginate([], 4, 30)).toMatchObject({ items: [], page: 1, pages: 1, total: 0, first: 0, last: 0 })
    expect(paginate(list.slice(0, 30), 1, 30).pages).toBe(1)
  })

  it.skipIf(!HAS_TEXTS)('searches without a limit when asked, for paging', () => {
    const rows = JSON.parse(readFileSync(path.join(ROOT, 'data/cbd/index.json'), 'utf8')) as CbdIndexRow[]
    const index = buildIndex(rows)
    expect(searchHeadwords(index, 'a').length).toBe(60)
    expect(searchHeadwords(index, 'a', Infinity).length).toBeGreaterThan(1000)
  })
})

describe('matchWord: a tapped word to an article by headword alone', () => {
  const row = (id: string, headword: string, extra: Partial<{ aliases: string[]; see: string; proper: 0 | 1 }> = {}): CbdIndexRow =>
    [id, headword, extra.aliases ?? [], [], [], extra.see ?? '', extra.proper ?? 0, []]
  const index = buildIndex([
    row('aenon', 'Aenon', { proper: 1 }),
    row('disciple', 'Disciple'),
    row('john', 'John', { proper: 1 }),
    row('john-the-baptist', 'John the Baptist', { proper: 1 }),
    row('man', 'Man'),
    row('nicodemus', 'Nicodemus', { proper: 1 }),
    row('phut', 'Phut', { aliases: ['Put'] }),
    row('put', 'Put', { see: 'phut', proper: 1 }),
    row('sin', 'Sin'),
    row('son', 'Son'),
    row('son-of-man-the', 'Son of Man, The'),
    row('son-the', 'Son, The'),
    row('soul', 'Soul'),
    row('spirit', 'Spirit', { see: 'soul' }),
    row('the-word', 'The'),
    row('world-the', 'World, The'),
    row('christ-the-christ', 'Christ, the Christ'),
  ])
  const ids = (w: string) => matchWord(index, w).map(m => m.id)

  it('matches the headword exactly, singular or plural, and irregular plurals', () => {
    expect(ids('Nicodemus')).toEqual(['nicodemus'])
    expect(ids('disciples')).toEqual(['disciple'])
    expect(ids('men')).toEqual(['man'])
    expect(ids("man's")).toEqual(['man'])
  })

  it('reads through an inverted article and follows "See X" stubs', () => {
    expect(ids('world')).toEqual(['world-the'])
    expect(ids('Christ')).toEqual(['christ-the-christ'])
    expect(matchWord(index, 'spirit')[0]).toEqual({ id: 'soul', headword: 'Soul', via: 'Spirit', why: 'word' })
  })

  it('adds headwords that begin with the word only beside an exact match', () => {
    expect(ids('Son')).toEqual(['son', 'son-the', 'son-of-man-the'])
    expect(matchWord(index, 'Son')[2].why).toBe('phrase')
    expect(ids('John')).toEqual(['john', 'john-the-baptist'])
  })

  it('keeps persons and places for capitalised words, including a name reached through its stub', () => {
    expect(ids('Put')).toEqual(['phut'])
    expect(ids('put')).toEqual([])
    expect(ids('john')).toEqual([])
  })

  it('never selects on a function word, and falls back to verb stems only when nothing else matched', () => {
    expect(ids('the')).toEqual([])
    expect(ids('The')).toEqual([])
    expect(ids('sinned')).toEqual(['sin'])
    expect(matchWord(index, 'sinned')[0].why).toBe('stem')
    expect(ids('unknownword')).toEqual([])
  })

  it('tells the reader which words to make tappable: never one matchWord would refuse', () => {
    for (const w of ['the', 'The', 'and', 'unto', 'thou', 'I', 'a', '12', "it's"]) expect(isLookupWord(w)).toBe(false)
    for (const w of ['serpent', 'Nicodemus', 'non', 'Jud', "man's", 'loved']) expect(isLookupWord(w)).toBe(true)
    for (const w of ['the', 'unto', 'thou', 'shall']) expect(matchWord(index, w)).toEqual([])
  })

  it('reads the ligatures the text uses', () => {
    expect(ids('Ænon')).toEqual(['aenon'])
  })

  it('stems archaic and regular inflections, leaving short words alone', () => {
    expect(stemForms('believeth')).toContain('believe')
    expect(stemForms('sanctifieth')).toContain('sanctify')
    expect(stemForms('judged')).toContain('judge')
    expect(stemForms('king')).toEqual([])
    expect(stemForms('thing')).toEqual([])
  })

  it('joins a word the tokenizer split at a ligature', () => {
    // "in Ænon, near Judæa." as the reader's tokenizer cuts it
    const toks = [{ tok: 'in', word: true }, { tok: ' Æ', word: false }, { tok: 'non', word: true }, { tok: ', ', word: false }, { tok: 'near', word: true }, { tok: ' ', word: false }, { tok: 'Jud', word: true }, { tok: 'æ', word: false }, { tok: 'a', word: true }, { tok: '.', word: false }]
    expect(wholeWord(toks, 2)).toBe('Ænon')
    expect(wholeWord(toks, 6)).toBe('Judæa')
    expect(wholeWord(toks, 8)).toBe('Judæa')
    expect(wholeWord(toks, 0)).toBe('in')
    expect(wholeWord(toks, 4)).toBe('near')
  })

  it.skipIf(!HAS_TEXTS)('links articles and numbers both ways in the real index', () => {
    const real = buildIndex(JSON.parse(readFileSync(path.join(ROOT, 'data/cbd/index.json'), 'utf8')) as CbdIndexRow[])
    const strongs = JSON.parse(readFileSync(path.join(ROOT, 'data/strongs.json'), 'utf8')) as Record<string, { lemma?: string }>
    expect(articleWords(real.byId.get('teacher'))).toEqual([['G1320', 'διδάσκαλος']])
    expect(articlesFor(real, 'G1320').map(a => a.headword)).toEqual(expect.arrayContaining(['Master', 'Teacher']))
    // Morrish's "adon" is Strong's ʼâdôwn; "bath" (daughter) the Hebrew word the text uses most of the three so spelt
    expect(articleWords(real.byId.get('lord')).map(w => w[0])).toContain('H113')
    expect(articleWords(real.byId.get('apple-of-the-eye')).map(w => w[0])).toEqual(['H892', 'H1323'])
    // every number is Strong's, carrying Strong's own spelling, and every one leads back to its article
    for (const r of real.rows) for (const [code, lemma] of articleWords(r)) {
      expect(strongs[code]?.lemma, code).toBe(lemma)
      expect(articlesFor(real, code).some(a => a.id === r[0]), `${code} ${r[0]}`).toBe(true)
    }
  })

  it.skipIf(!HAS_TEXTS)('finds an article for the names and nouns of John 3 in the real index', () => {
    const real = buildIndex(JSON.parse(readFileSync(path.join(ROOT, 'data/cbd/index.json'), 'utf8')) as CbdIndexRow[])
    const first = (w: string) => matchWord(real, w)[0]?.headword
    expect(first('Nicodemus')).toBe('Nicodemus')
    expect(first('Pharisees')).toBe('Pharisees')
    expect(first('serpent')).toBe('Serpent')
    expect(first('wilderness')).toBe('Wilderness')
    expect(first('Ænon')).toBe('Aenon')
    expect(first('Judæa')).toBe('Judaea')
    expect(first('bridegroom')).toBe('Bridegroom')
    expect(first('put')).toBeUndefined()
    expect(first('that')).toBeUndefined()
  })
})

describe('the word sheet’s parts', () => {
  it('opens a tagged word on the word, the subject folded beneath; any other word on the subject alone', () => {
    expect(sheetParts('G1320', 'teacher')).toEqual(['word', 'subject'])
    expect(sheetParts('', 'Nicodemus')).toEqual(['subject'])
  })
  it('opens a number with no tapped word (a chip in an article) on the word alone', () => {
    expect(sheetParts('H430', '')).toEqual(['word'])
    expect(sheetParts('', '')).toEqual([])
  })
})
