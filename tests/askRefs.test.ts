import { afterEach, describe, it, expect } from 'vitest'
import type { ChatMessage, Sentence } from '../shared/assistantTools'
import { setNamesLang } from '../shared/books'
import { setShownText } from '../shared/texts'
import { answerRefs, answerRuns, sentenceParts, suppliedVerses, withVerses } from '../client/src/lib/askRefs'

afterEach(() => { setNamesLang('en'); setShownText('en') })
const refs = (text: string) => answerRefs(text).map(s => [text.slice(s.start, s.end), s.ref])

describe('the references in an answer that are links', () => {
  it('a verse, a range, a chapter alone, a short name with its stop', () => {
    expect(answerRuns('See John 3:16 and Rom. 8:1-4.')).toEqual([
      { text: 'See ' }, { text: 'John 3:16', ref: { book: 43, chapter: 3, v1: 16 } }, { text: ' and ' },
      { text: 'Rom. 8:1-4', ref: { book: 45, chapter: 8, v1: 1, v2: 4 } }, { text: '.' }])
    expect(refs('Read 1 Cor 13, then Psalm 23.')).toEqual([['1 Cor 13', { book: 46, chapter: 13 }], ['Psalm 23', { book: 19, chapter: 23 }]])
    expect(refs('Ps. 23 and Jude 3')).toEqual([['Ps. 23', { book: 19, chapter: 23 }], ['Jude 3', { book: 65, chapter: 1, v1: 3 }]])
  })
  it('“1 John” beside “John”: each is its own book, and the figure belongs to the name', () => {
    expect(refs('Compare 1 John 4:9 with John 4:9.')).toEqual([['1 John 4:9', { book: 62, chapter: 4, v1: 9 }], ['John 4:9', { book: 43, chapter: 4, v1: 9 }]])
  })
  it('a list keeps its book: each item is its own link', () => {
    expect(refs('Gen 9:26 and 24:7; Ex 3:14,15')).toEqual([
      ['Gen 9:26', { book: 1, chapter: 9, v1: 26 }], ['24:7', { book: 1, chapter: 24, v1: 7 }],
      ['Ex 3:14', { book: 2, chapter: 3, v1: 14 }], ['15', { book: 2, chapter: 3, v1: 15 }]])
  })
  it('a reference that does not exist is words: no such chapter, no such verse, a range past the chapter’s end or backwards', () => {
    for (const text of ['John 3:99 says so.', 'See John 22:1.', 'Jude 40', 'John 3:16-99', 'Psalm 151', 'Romans 8:40', 'John 3:16-4']) expect(answerRuns(text), text).toEqual([{ text }])
    // the one beside it that does exist is still a link
    expect(refs('John 3:99 and John 3:16')).toEqual([['John 3:16', { book: 43, chapter: 3, v1: 16 }]])
  })
  it('a chapter under a name of two letters and no stop is words; with a verse it is a reference', () => {
    for (const text of ['Is 5 the right size?', 'Am 3 of them', 'He 2 and she 3']) expect(answerRuns(text), text).toEqual([{ text }])
    expect(refs('Is 53:5')).toEqual([['Is 53:5', { book: 23, chapter: 53, v1: 5 }]])
  })
  it('words about the app are not references', () => {
    for (const text of ['The text size goes up to 32, so 400 is more than the largest size.', 'Open Settings, then Text.', 'In 1890 the notes were his own.', 'Theme: Paper → Slate', 'Chapter 3 of the guide', 'Step 2: tap Add a font.']) expect(answerRuns(text), text).toEqual([{ text }])
    expect(answerRuns('')).toEqual([])
  })
  it('French: the reader’s book names, the numbers as the English Bible has them (what the tools gave)', () => {
    setNamesLang('fr'); setShownText('fr')
    expect(refs('Voir Jean 3:16 et Romains 5:8.')).toEqual([['Jean 3:16', { book: 43, chapter: 3, v1: 16 }], ['Romains 5:8', { book: 45, chapter: 5, v1: 8 }]])
    // a reader's own note would read "Psaume 51:3" as English 51:1; Ask's numbers are already English
    expect(refs('Psaume 51:1')).toEqual([['Psaume 51:1', { book: 19, chapter: 51, v1: 1 }]])
    expect(refs('Joël 3:1')).toEqual([['Joël 3:1', { book: 29, chapter: 3, v1: 1 }]])
  })
  it('German: the comma between chapter and verse', () => {
    setNamesLang('de'); setShownText('de')
    expect(refs('Siehe Johannes 3,16 und Römer 8,1-4.')).toEqual([['Johannes 3,16', { book: 43, chapter: 3, v1: 16 }], ['Römer 8,1-4', { book: 45, chapter: 8, v1: 1, v2: 4 }]])
  })
})

describe('a sentence with the numbers of its sources', () => {
  // paragraph 7 is the answer's first source and 8 its second; 99 is one the conversation cannot place
  const number = (id: number) => (id === 7 ? 1 : id === 8 ? 2 : id === 30 ? 12 : null)
  // a whole space that does not break: with the narrow one (U+202F) the numbers 1 and 3 read as 13 on the screen
  const GAP = '\u00A0'
  it('a number stands on the sentence it follows, as a footnote’s caller does, and reads nothing of the work’s title', () => {
    expect(sentenceParts({ text: 'Grace reigns.', ids: [7] }, number)).toEqual([{ text: 'Grace reigns.' }, { text: '¹', cite: 7 }])
    expect(sentenceParts({ text: 'Grace reigns.', ids: [30] }, number)).toEqual([{ text: 'Grace reigns.' }, { text: '¹²', cite: 30 }])
  })
  it('both in one sentence: the reference is a link in the words, the numbers follow them, a space that does not break between two', () => {
    expect(sentenceParts({ text: 'Grace reigns, as Romans 5:21 says.', ids: [7, 8] }, number)).toEqual([
      { text: 'Grace reigns, as ' }, { text: 'Romans 5:21', ref: { book: 45, chapter: 5, v1: 21 } }, { text: ' says.' },
      { text: '¹', cite: 7 }, { text: GAP }, { text: '²', cite: 8 }])
  })
  it('adjacent: a reference that ends the sentence and the number after it have plain words between them', () => {
    const parts = sentenceParts({ text: 'See Romans 5:21', ids: [7, 8] }, number)
    expect(parts).toEqual([{ text: 'See ' }, { text: 'Romans 5:21', ref: { book: 45, chapter: 5, v1: 21 } }, { text: GAP }, { text: '¹', cite: 7 }, { text: GAP }, { text: '²', cite: 8 }])
    // no two links touch, anywhere
    const link = (p: (typeof parts)[number]) => 'ref' in p || 'cite' in p
    expect(parts.some((p, i) => i > 0 && link(p) && link(parts[i - 1]))).toBe(false)
  })
  it('a paragraph named twice after one sentence is one number', () => {
    expect(sentenceParts({ text: 'Grace reigns.', ids: [7, 7] }, number)).toEqual([{ text: 'Grace reigns.' }, { text: '¹', cite: 7 }])
  })
  it('a paragraph the conversation cannot place makes no number', () => {
    expect(sentenceParts({ text: 'Grace reigns.', ids: [99] }, number)).toEqual([{ text: 'Grace reigns.' }])
  })
  it('the words are the model’s, whole: nothing of them is cut or joined to make room for a number', () => {
    const text = '  Grace  reigns ; it [sic] never fails .  '
    expect(sentenceParts({ text, ids: [7] }, number).filter(p => !('cite' in p)).map(p => p.text).join('')).toBe(text)
  })
  it('French: the same', () => {
    setNamesLang('fr'); setShownText('fr')
    expect(sentenceParts({ text: 'La grâce règne, selon Romains 5:21.', ids: [7] }, number)).toEqual([
      { text: 'La grâce règne, selon ' }, { text: 'Romains 5:21', ref: { book: 45, chapter: 5, v1: 21 } }, { text: '.' }, { text: '¹', cite: 7 }])
  })
})

const asked = (id: string, name: string): ChatMessage => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: '{}' } }] })
const said = (id: string, content: unknown): ChatMessage => ({ role: 'tool', tool_call_id: id, content: JSON.stringify(content) })
const FOUND = { total: 2, verses: [{ reference: 'Ephesians 1:13', book: 49, chapter: 1, verse: 13, text: 'in whom ye also have trusted…' }, { reference: 'Ephesians 4:30', book: 49, chapter: 4, verse: 30, text: 'And do not grieve…' }] }
const READ = { reference: 'John 3:16-17', book: 43, chapter: 3, verses: [{ verse: 16, text: 'For God so loved the world…' }, { verse: 17, text: 'For God has not sent…' }] }
const LIBRARY = { paragraphs: [{ id: 7, author: 'darby', work: { id: 'w', title: 'Notes on Romans 8', collection: 'cw' }, n: 1, para: 0, section: 'Sealing', text: 'See Romans 8:1.' }] }
const TURN: ChatMessage[] = [{ role: 'user', content: 'how are we sealed' }, asked('c1', 'search_library'), said('c1', LIBRARY), asked('c2', 'search_bible'), said('c2', FOUND), asked('c3', 'read_verses'), said('c3', READ)]

describe('the verses the Bible tools gave for this message', () => {
  it('are search_bible’s verses and read_verses’ verses of the chapter it names', () => {
    expect([...suppliedVerses(TURN)].sort()).toEqual(['43.3.16', '43.3.17', '49.1.13', '49.4.30'])
  })
  it('are none from another tool’s result, though it holds verses or names them', () => {
    expect(suppliedVerses([{ role: 'user', content: 'x' }, asked('c1', 'search_library'), said('c1', { ...LIBRARY, verses: FOUND.verses }), asked('c2', 'get_settings'), said('c2', FOUND)]).size).toBe(0)
  })
  it('are none from an earlier message, nor from a result that is not what the tool gives', () => {
    expect(suppliedVerses([...TURN, { role: 'assistant', content: 'Ephesians 1:13.' }, { role: 'user', content: 'and?' }]).size).toBe(0)
    expect(suppliedVerses([{ role: 'user', content: 'x' }, asked('c1', 'search_bible'), { role: 'tool', tool_call_id: 'c1', content: 'not JSON' }, asked('c2', 'search_bible'), said('c2', { done: true }), asked('c3', 'read_verses'), said('c3', { reference: 'John 3:16', verses: [{ verse: 16 }] })]).size).toBe(0)
  })
})

describe('a sentence that rests on a verse', () => {
  const s = (text: string, ids: number[] = [], supported = ids.length > 0): Sentence => ({ text, ids, supported })
  it('is supported when a Bible tool gave that verse for this message: the verse, a range holding it, its chapter', () => {
    const got = withVerses([s('Believers are sealed.', [7]), s('Ephesians 1:13 says so.'), s('See also Eph. 4:29-32.'), s('John 3 tells of the gift.'), s('Grace reigns.')], TURN)
    expect(got.map(x => x.supported)).toEqual([true, true, true, true, false])
    expect(got.map(x => x.ids)).toEqual([[7], [], [], [], []])
  })
  it('is not when the verse is one no tool gave, or does not exist', () => {
    expect(withVerses([s('Romans 8:1 says so.'), s('Ephesians 1:14 follows.'), s('Ephesians 1:99 says so.'), s('Psalm 23 is well known.')], TURN).map(x => x.supported)).toEqual([false, false, false, false])
  })
  it('is not for a verse the library’s paragraph names: only the Bible tools give verses', () => {
    expect(withVerses([s('Romans 8:1 says so.')], [{ role: 'user', content: 'x' }, asked('c1', 'search_library'), said('c1', LIBRARY)])).toEqual([s('Romans 8:1 says so.')])
  })
  it('leaves what the server already settled as it is', () => {
    const all = [s('Open Settings, then Text.', [], true), s('Believers are sealed.', [7])]
    expect(withVerses(all, TURN)).toEqual(all)
  })
  it('French: the reader’s names, the tools’ numbers', () => {
    setNamesLang('fr'); setShownText('fr')
    expect(withVerses([s('Éphésiens 1:13 le dit.'), s('Jean 3:16 aussi.')], TURN).map(x => x.supported)).toEqual([true, true])
  })
})
