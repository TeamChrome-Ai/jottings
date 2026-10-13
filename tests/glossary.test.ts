import { describe, it, expect, beforeAll } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { buildGlossary, glossaryList, glossaryTerm, lookupGlossary, plainText, termKey, type GlossaryEntry } from '../shared/glossary'
import { proseWords, wordAtOffset, wordTapAt } from '../shared/wordTap'
import { HAS_TEXTS } from './_texts'

const ROOT = path.resolve(__dirname, '..')

describe.skipIf(!HAS_TEXTS)('data/glossary/darby.json', () => {
  let entries: GlossaryEntry[] = [], g = buildGlossary(entries)
  beforeAll(() => { entries = JSON.parse(readFileSync(path.join(ROOT, 'data/glossary/darby.json'), 'utf8')); g = buildGlossary(entries) })
  const tap = (word: string, prev = '', next = '') => lookupGlossary(g, { word, prev, next })?.term
  it('is 40 to 80 entries of the documented shape', () => {
    expect(entries.length).toBeGreaterThanOrEqual(40)
    expect(entries.length).toBeLessThanOrEqual(80)
    for (const e of entries) {
      expect(Object.keys(e).sort()).toEqual(['aliases', 'short', 'source', 'term'])
      expect(e.term.trim()).toBe(e.term)
      expect(e.term.length).toBeGreaterThan(1)
      expect(Array.isArray(e.aliases)).toBe(true)
      for (const a of e.aliases) expect(a.trim().length).toBeGreaterThan(1)
      // one sentence: ends with a full stop and holds no second one
      expect(e.short).toMatch(/\.$/)
      expect(e.short.slice(0, -1)).not.toMatch(/[.!?] [A-Z]/)
      expect(e.short.length).toBeLessThan(260)
      expect(Object.keys(e.source).sort()).toEqual(['author', 'n', 'quote', 'work'])
      expect(Number.isInteger(e.source.n) && e.source.n >= 1).toBe(true)
      expect(e.source.quote.length).toBeGreaterThan(20)
    }
  })
  it('has no duplicate terms, and no alias that names another entry', () => {
    const terms = entries.map(e => termKey(e.term))
    expect(new Set(terms).size).toBe(terms.length)
    const owner = new Map<string, string>()
    for (const e of entries) for (const name of [e.term, ...e.aliases]) {
      const k = termKey(name)
      expect(owner.get(k) ?? e.term, `“${name}” is under both “${owner.get(k)}” and “${e.term}”`).toBe(e.term)
      owner.set(k, e.term)
    }
    // no alias repeats its own term
    for (const e of entries) expect(new Set(e.aliases.map(termKey)).size).toBe(e.aliases.length)
  })
  it('sources resolve: the work and section exist under data/ministry, and the quote is in that section’s text', () => {
    const works = new Map<string, { sections: { text: string }[] }>()
    for (const e of entries) {
      const file = path.join(ROOT, 'data/ministry', e.source.author, `${e.source.work}.json`)
      expect(existsSync(file), `${e.term}: no ${file}`).toBe(true)
      let w = works.get(file)
      if (!w) { w = JSON.parse(readFileSync(file, 'utf8')); works.set(file, w!) }
      const section = w!.sections[e.source.n - 1]
      expect(section, `${e.term}: ${e.source.work} has no section ${e.source.n}`).toBeTruthy()
      expect(plainText(section.text).includes(plainText(e.source.quote)), `${e.term}: quote not found in ${e.source.work}/${e.source.n}`).toBe(true)
    }
  })
  it('covers the terms asked for', () => {
    for (const w of ['assembly', 'church', 'dispensation', 'remnant', 'world', 'flesh', 'rapture', 'kingdom', 'millennium', 'sonship', 'deliverance', 'law', 'mystery', 'body', 'bride', 'tabernacle', 'sabbath', 'worship', 'gift', 'office', 'clergy', 'separation', 'path', 'obedience', 'dependence', 'communion', 'sealing', 'earnest', 'brethren', 'testimony', 'walk', 'fellowship', 'priesthood', 'sanctuary'])
      expect(tap(w), w).toBeTruthy()
    expect(tap('man', 'old')).toBe('the old man')
    expect(tap('man', 'new')).toBe('the new man')
    expect(tap('table', 'Lord’s')).toBe('the Lord’s table')
    expect(tap('Lord’s', 'the', 'table')).toBe('the Lord’s table')
    expect(tap('calling', 'heavenly')).toBe('the heavenly calling')
    expect(tap('bread', 'breaking')).toBe('the breaking of bread')
    expect(tap('life', 'eternal')).toBe('eternal life')
    expect(tap('coming', 'the', 'of')).toBe('the coming of the Lord')
  })
})

describe('the resolver', () => {
  const small = buildGlossary([
    { term: 'the assembly', aliases: ['ecclesia'], short: 'x.', source: { author: 'darby', work: 'w', n: 1, quote: 'q' } },
    { term: 'the old man', aliases: ['old man'], short: 'x.', source: { author: 'darby', work: 'w', n: 1, quote: 'q' } },
    { term: 'gift', aliases: [], short: 'x.', source: { author: 'darby', work: 'w', n: 1, quote: 'q' } },
    { term: 'the Lord’s table', aliases: [], short: 'x.', source: { author: 'darby', work: 'w', n: 1, quote: 'q' } },
  ])
  const find = (word: string, prev = '', next = '') => lookupGlossary(small, { word, prev, next })?.term ?? null
  it('folds case, articles, plurals, possessives and punctuation', () => {
    expect(find('Assembly')).toBe('the assembly')
    expect(find('assemblies')).toBe('the assembly')
    expect(find('assembly’s')).toBe('the assembly')
    expect(find('ASSEMBLY')).toBe('the assembly')
    expect(find('Ecclesia')).toBe('the assembly')
    expect(find('gifts')).toBe('gift')
    expect(find('Gift')).toBe('gift')
    expect(termKey('the Lord’s table')).toBe('thelordstable')
    expect(termKey("Lord's-table")).toBe('lordstable')
  })
  it('tries the two-word phrases around the word before the word itself', () => {
    expect(find('man', 'old', 'is')).toBe('the old man')
    expect(find('old', 'the', 'man')).toBe('the old man')
    expect(find('man')).toBeNull()
    expect(find('table', 'Lord’s')).toBe('the Lord’s table')
    expect(find("Lord's", 'the', 'table')).toBe('the Lord’s table')
    expect(find('table')).toBeNull()
  })
  it('answers nothing for words Darby has no term for, and for function words', () => {
    for (const w of ['the', 'and', 'propitiation', 'Jerusalem', 'a']) expect(find(w)).toBeNull()
  })
  it('lists by term without the article, and finds an entry by its term', () => {
    expect(glossaryList(small).map(e => e.term)).toEqual(['the assembly', 'gift', 'the Lord’s table', 'the old man'])
    expect(glossaryTerm(small, 'gift')?.term).toBe('gift')
    expect(glossaryTerm(small, 'nothing')).toBeNull()
  })
  it('plainText drops markup and footnote markers and folds whitespace', () => {
    expect(plainText('The <i>assembly</i>[3] is\n\n  one.')).toBe('The assembly is one.')
  })
})

describe('the word under a tap', () => {
  const text = 'The Lord’s table, in the world-system; “assembly” (1 Cor. 10) is His.'
  it('keeps apostrophes and hyphens inside a word and leaves punctuation out', () => {
    expect(proseWords(text).map(w => w.word)).toEqual(['The', 'Lord’s', 'table', 'in', 'the', 'world-system', 'assembly', '1', 'Cor', '10', 'is', 'His'])
  })
  it('finds the word at an offset with its neighbours, and nothing on a space', () => {
    expect(wordAtOffset(text, text.indexOf('table') + 2)).toEqual({ word: 'table', prev: 'Lord’s', next: 'in' })
    expect(wordAtOffset(text, 0)).toEqual({ word: 'The', prev: '', next: 'Lord’s' })
    expect(wordAtOffset(text, text.indexOf('world-system') + 7)).toEqual({ word: 'world-system', prev: 'the', next: 'assembly' })
    // the caret lands after the last letter of a word: still that word
    expect(wordAtOffset(text, 3)?.word).toBe('The')
    expect(wordAtOffset(text, text.indexOf(', in') + 1)).toBeNull()
    expect(wordAtOffset(text, text.indexOf('His') + 3)?.word).toBe('His')
  })
  it('wordTapAt reads a tokenised run', () => {
    expect(wordTapAt(['a', 'b', 'c'], 1)).toEqual({ word: 'b', prev: 'a', next: 'c' })
    expect(wordTapAt(['a'], 0)).toEqual({ word: 'a', prev: '', next: '' })
  })
})
