import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TextHit, TextSearch } from '../shared/ministry'

vi.mock('../client/src/lib/api', () => ({ get: vi.fn() }))
vi.mock('../client/src/lib/companion', () => ({ loadCompanionIndex: vi.fn(async () => null), loadCompanionSection: vi.fn(async () => null) }))

import { get } from '../client/src/lib/api'
import { createMinistryLoaders } from '../client/src/lib/ministryCore'
import { apartAt, paragraphLink, readerLink, searchNote, textAuthorChoices, textHeading } from '../client/src/lib/libraryNav'

class HttpError extends Error { constructor(public status: number) { super(`HTTP ${status}`) } }

const hit = (author: string, para: number, apart?: true): TextHit => ({
  author, work: { id: 'volume-6', title: 'Ministry 6', collection: 'ministry' }, n: 3, section: 'The Spirit', para,
  snippet: 'ye were sealed with the Spirit of promise', hl: [8, 30], ...(apart ? { apart } : null),
})
const answer = (over: Partial<TextSearch> = {}): TextSearch => ({
  q: 'sealed with the spirit', total: 2, exact: 1, page: 1, pages: 1,
  authors: [{ id: 'darby', short: 'Darby', total: 1 }, { id: 'stoney', short: 'Stoney', total: 1 }],
  items: [hit('darby', 4), hit('stoney', 120, true)], ...over,
})
const asked = () => vi.mocked(get).mock.calls.map(([p]) => String(p))

describe('the text search’s loader', () => {
  beforeEach(() => { vi.mocked(get).mockReset() })

  it('keeps a found answer per words, author and page, and asks once for two calls made together', async () => {
    vi.mocked(get).mockImplementation(async () => answer())
    const l = createMinistryLoaders(null)
    const [a, b] = await Promise.all([l.searchText('sealed with the Spirit'), l.searchText('sealed with the Spirit')])
    expect(a).toEqual({ kind: 'found', ...answer() })
    expect(b).toEqual(a)
    expect(asked()).toEqual(['/ministry/text?q=sealed%20with%20the%20Spirit'])
    await l.searchText('  sealed with the Spirit ')
    await l.searchText('sealed with the Spirit', { page: 2 })
    await l.searchText('sealed with the Spirit', { author: 'darby' })
    await l.searchText('sealed with the Spirit', { page: 2 })
    expect(asked()).toEqual(['/ministry/text?q=sealed%20with%20the%20Spirit', '/ministry/text?q=sealed%20with%20the%20Spirit&page=2', '/ministry/text?q=sealed%20with%20the%20Spirit&author=darby'])
  })

  it('forgets found answers on reset', async () => {
    vi.mocked(get).mockImplementation(async () => answer())
    const l = createMinistryLoaders(null)
    await l.searchText('the love of God')
    l.reset()
    await l.searchText('the love of God')
    expect(asked()).toHaveLength(2)
  })

  it('does not keep or share an answer asked for before reset: it is another edition’s', async () => {
    let arrive!: (s: TextSearch) => void
    vi.mocked(get).mockImplementationOnce(() => new Promise(r => { arrive = r as (s: TextSearch) => void }))
    const l = createMinistryLoaders(null)
    const early = l.searchText('the love of God')
    l.reset()
    vi.mocked(get).mockImplementation(async () => answer({ total: 1 }))
    const late = l.searchText('the love of God')
    arrive(answer({ total: 99 }))
    await early
    expect(await late).toMatchObject({ kind: 'found', total: 1 })
    expect(await l.searchText('the love of God')).toMatchObject({ kind: 'found', total: 1 })
    expect(asked()).toHaveLength(2)
  })

  it('takes a 404 for the whole library as a server without the search, and never asks it again', async () => {
    vi.mocked(get).mockRejectedValue(new HttpError(404))
    const l = createMinistryLoaders(null)
    expect(await l.searchText('the love of God')).toEqual({ kind: 'unsupported' })
    l.reset()
    expect(await l.searchText('new creation')).toEqual({ kind: 'unsupported' })
    expect(await l.searchText('new creation', { author: 'darby' })).toEqual({ kind: 'unsupported' })
    expect(asked()).toHaveLength(1)
  })

  it('takes a 404 for one author as unavailable, and asks again', async () => {
    vi.mocked(get).mockRejectedValue(new HttpError(404))
    const l = createMinistryLoaders(null)
    expect(await l.searchText('the love of God', { author: 'kelly' })).toEqual({ kind: 'unavailable' })
    vi.mocked(get).mockImplementation(async () => answer())
    expect((await l.searchText('the love of God')).kind).toBe('found')
  })

  it.each([
    ['no connection', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a server error', () => Promise.reject(new HttpError(503))],
    ['an answer of another shape', () => Promise.resolve({ hits: [] })],
    ['items of another shape', () => Promise.resolve({ ...answer(), items: [{ title: 'x' }] })],
  ])('says unavailable for %s, and asks again next time', async (_, fail) => {
    vi.mocked(get).mockImplementation(fail as () => Promise<never>)
    const l = createMinistryLoaders(null)
    expect(await l.searchText('the love of God')).toEqual({ kind: 'unavailable' })
    vi.mocked(get).mockImplementation(async () => answer())
    expect((await l.searchText('the love of God')).kind).toBe('found')
    expect(asked()).toHaveLength(2)
  })

  it('sends the words trimmed and encoded, and asks nothing for none', async () => {
    vi.mocked(get).mockImplementation(async () => answer())
    const l = createMinistryLoaders(null)
    await l.searchText(' Lord’s supper & table ', { author: 'darby', page: 3 })
    expect(asked()).toEqual(['/ministry/text?q=Lord%E2%80%99s%20supper%20%26%20table&page=3&author=darby'])
    expect(await l.searchText('   ')).toMatchObject({ kind: 'found', total: 0, items: [] })
    expect(asked()).toHaveLength(1)
  })
})

describe('the text block', () => {
  it('heads the list with the paragraphs as typed, then those near', () => {
    expect(textHeading({ total: 217, exact: 15 })).toBe('15 paragraphs · 202 near')
    expect(textHeading({ total: 15, exact: 15 })).toBe('15 paragraphs')
    expect(textHeading({ total: 1, exact: 1 })).toBe('1 paragraph')
    expect(textHeading({ total: 1927, exact: 1927 })).toBe('1,927 paragraphs')
    expect(textHeading({ total: 12, exact: 0 })).toBe('12 paragraphs with the words near one another')
    expect(textHeading({ total: 0, exact: 0 })).toBe('')
  })

  it('puts "The words near one another" before a page’s first paragraph with them apart', () => {
    expect(apartAt(answer())).toBe(1)
    expect(apartAt(answer({ items: [hit('darby', 4), hit('darby', 5)] }))).toBeNull()
    expect(apartAt(answer({ page: 2, items: [hit('darby', 4, true), hit('darby', 5, true)] }))).toBe(0)
    expect(apartAt(answer({ exact: 0, items: [hit('darby', 4, true)] }))).toBeNull()
  })

  it('offers every author with a count after all of them together, only when two or more have the words', () => {
    expect(textAuthorChoices(answer({ authors: [{ id: 'darby', short: 'Darby', total: 1200 }, { id: 'coates', short: 'Coates', total: 17 }] }))).toEqual([
      { value: '', label: 'All 1,217' }, { value: 'darby', label: 'Darby 1,200' }, { value: 'coates', label: 'Coates 17' },
    ])
    expect(textAuthorChoices(answer({ authors: [{ id: 'darby', short: 'Darby', total: 3 }] }))).toBeNull()
  })

  it('opens a paragraph in the reader at it, with no verse to go back to', () => {
    const link = paragraphLink('stoney', hit('stoney', 120))
    expect(link).toEqual({ pathname: '/companion', params: { author: 'stoney', work: 'volume-6', n: '3', p: '120' } })
    expect(readerLink(link.params)).toEqual({ n: 3, p: 120, from: null })
    expect(paragraphLink('darby', hit('darby', 2), '43.3.16').params.from).toBe('43.3.16')
  })

  it('says "Nothing for" only when nothing is listed, both searches have answered and the text search could be asked', () => {
    const found = { kind: 'found' as const, ...answer() }
    const none = { kind: 'found' as const, ...answer({ total: 0, exact: 0, authors: [], items: [] }) }
    expect(searchNote(0, none, false)).toBe('nothing')
    expect(searchNote(0, { kind: 'unsupported' }, false)).toBe('nothing')
    expect(searchNote(0, none, true)).toBe('searching')
    expect(searchNote(0, undefined, true)).toBe('searching')
    expect(searchNote(0, { kind: 'unavailable' }, false)).toBeNull()
    expect(searchNote(0, found, false)).toBeNull()
    expect(searchNote(0, found, true)).toBeNull()
    expect(searchNote(2, none, false)).toBeNull()
  })
})
