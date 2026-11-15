// What the ministry's loaders hold for the session (client/src/lib/ministryLibrary.ts on ministryCore.ts, companion.ts,
// ministry.ts) when the server switches the edition or turns the cleanse on (docs/EDITION.md): what was held is asked
// for again, and an answer asked for before the switch, landing after it, is neither kept nor shared. The stand-in
// server answers as the state was when it was asked, and can hold its answers back.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../client/src/lib/api', () => ({ get: vi.fn() }))
vi.mock('../client/src/lib/offlineMinistry', () => ({
  offlineSupported: false, isStored: async () => false, storedAuthor: async () => null, storedLibrary: async () => null,
  readContents: async () => null, readSection: async () => null, readSectionRaw: async () => null, readCompanionIndex: async () => null, readRefs: async () => null,
}))

const VERSES: Record<string, number[]> = { '1961': [16], '1890': [17], cleanse: [18] }
/** The server's answer to `path` in the state `tag` names: the state the request named when it was sent (api.ts withEdition). */
function answer(path: string, tag: string): unknown {
  if (path === '/ministry') return { authors: [], tag }
  if (path.startsWith('/ministry/search')) return { hits: [{ author: 'darby', title: tag }] }
  if (path.startsWith('/ministry/chapter/')) return { verses: VERSES[tag] }
  if (path.startsWith('/ministry/refs/')) return { groups: [], tag }
  if (/^\/ministry\/kelly\/w\/\d+$/.test(path)) return { section: { text: tag } }
  if (path === '/ministry/kelly/w') return { author: 'kelly', work: { id: 'w', title: tag }, sections: [] }
  if (path === '/companion/darby') return { works: [{ id: 'genesis', title: tag, kind: 'outline', sections: [{ title: 'Genesis 1', passages: [[1, 1, 1, 1, 0]] }] }] }
  if (path === '/companion/darby/genesis/1') return { section: { text: tag } }
  if (path === '/companion/darby/passage/1/1') return [{ author: 'darby', work: { id: 'genesis' }, n: 1, section: { text: tag } }]
  throw new Error(`no answer for ${path}`)
}

/** Lets every promise already under way finish. */
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 0)) }
/** The app's modules as they stand at launch, under the 1961 edition with the cleanse off. */
async function launch() {
  vi.resetModules()
  const { get } = await import('../client/src/lib/api')
  const E = await import('../client/src/lib/editionCore')
  let release: (() => void) | null = null
  let held: Promise<void> | null = null
  vi.mocked(get).mockReset()
  vi.mocked(get).mockImplementation(async (path: string) => {
    const tag = E.peekCleanse() ? 'cleanse' : E.peekEdition()
    if (held) await held
    return answer(path, tag)
  })
  return {
    E,
    L: await import('../client/src/lib/ministryLibrary'),
    C: await import('../client/src/lib/companion'),
    M: await import('../client/src/lib/ministry'),
    asked: () => vi.mocked(get).mock.calls.map(([p]) => String(p)),
    /** Answers from here on wait for `let go`. */
    hold: () => { held = new Promise<void>(r => { release = r }) },
    letGo: () => { held = null; release?.() },
  }
}
const tagOf = (v: unknown) => (v as { tag?: string } | null)?.tag
const textOf = (v: unknown) => (v as { text?: string } | null | undefined)?.text
const titleOf = (v: unknown) => (v as { work: { title: string } } | null | undefined)?.work.title

describe('the library (ministryCore.ts)', () => {
  it('asks again for a work’s contents and a section held from before the switch', async () => {
    const { E, L } = await launch()
    expect(titleOf(await L.loadContents('kelly', 'w'))).toBe('1961')
    expect(textOf(await L.loadSection('kelly', 'w', 1))).toBe('1961')
    E.setEditionState('1890')
    expect(L.peekContents('kelly', 'w')).toBeUndefined()
    expect(L.peekSection('kelly', 'w', 1)).toBeUndefined()
    expect(titleOf(await L.loadContents('kelly', 'w'))).toBe('1890')
    expect(textOf(await L.loadSection('kelly', 'w', 1))).toBe('1890')
  })

  it('neither shares nor keeps a list, contents, section or search asked for before the switch', async () => {
    const { E, L, asked, hold, letGo } = await launch()
    hold()
    const early = [L.loadLibrary(), L.loadContents('kelly', 'w'), L.loadSection('kelly', 'w', 2), L.searchSections('grace')]
    await settle()   // the requests are out, naming the edition as it was
    E.setCleanseState(true)
    const late = [L.loadLibrary(), L.loadContents('kelly', 'w'), L.loadSection('kelly', 'w', 2), L.searchSections('grace')]
    letGo()
    await Promise.all(early)
    const [lib, contents, section, hits] = await Promise.all(late)
    expect([tagOf(lib), titleOf(contents), textOf(section), (hits as { title: string }[])[0]?.title]).toEqual(['cleanse', 'cleanse', 'cleanse', 'cleanse'])
    expect([tagOf(L.peekLibrary()), titleOf(L.peekContents('kelly', 'w')), textOf(L.peekSection('kelly', 'w', 2))]).toEqual(['cleanse', 'cleanse', 'cleanse'])
    const n = asked().length
    expect((await L.searchSections('grace'))[0]?.title).toBe('cleanse')
    expect(asked()).toHaveLength(n)
  })
})

describe('the companion (companion.ts)', () => {
  it('asks again for the index, a chapter’s readings and a section held from before the switch', async () => {
    const { E, C, asked } = await launch()
    expect((await C.loadCompanionIndex('darby'))?.works[0].title).toBe('1961')
    expect(textOf((await C.loadCompanionChapter('darby', 1, 1))?.[0].section)).toBe('1961')
    expect(textOf(await C.loadCompanionSection('darby', 'genesis', 1))).toBe('1961')
    E.setEditionState('1890')
    expect((await C.loadCompanionIndex('darby'))?.works[0].title).toBe('1890')
    expect(textOf((await C.loadCompanionChapter('darby', 1, 1))?.[0].section)).toBe('1890')
    expect(textOf(await C.loadCompanionSection('darby', 'genesis', 1))).toBe('1890')
    expect(asked().filter(p => p === '/companion/darby')).toHaveLength(2)
  })

  it('does not keep a section or chapter asked for before the switch, nor hand it to the library', async () => {
    const { E, C, L, hold, letGo } = await launch()
    await C.loadCompanionIndex('darby')
    hold()
    const early = [C.loadCompanionSection('darby', 'genesis', 1), C.loadCompanionChapter('darby', 1, 1)]
    await settle()
    E.setCleanseState(true)
    letGo()
    await Promise.all(early)
    expect(textOf(await C.loadCompanionSection('darby', 'genesis', 1))).toBe('cleanse')
    expect(textOf((await C.loadCompanionChapter('darby', 1, 1))?.[0].section)).toBe('cleanse')
    expect(textOf(await L.loadSection('darby', 'genesis', 1))).toBe('cleanse')
  })
})

describe('Ministry on a verse (ministry.ts)', () => {
  it('neither shares nor keeps a chapter’s verses or a selection’s list asked for before the switch', async () => {
    const { E, M, hold, letGo } = await launch()
    hold()
    const early = [M.ministryVerses(43, 3), M.loadMinistryRefs(43, 3, [16])]
    await settle()
    E.setEditionState('1890')
    const late = [M.ministryVerses(43, 3), M.loadMinistryRefs(43, 3, [16])]
    letGo()
    await Promise.all(early)
    const [verses, refs] = await Promise.all(late)
    expect([...(verses as Set<number>)]).toEqual([17])
    expect(tagOf(refs)).toBe('1890')
    expect([...M.peekMinistryVerses(43, 3)!]).toEqual([17])
    expect(tagOf(await M.loadMinistryRefs(43, 3, [16]))).toBe('1890')
  })

  it('does not keep an answer that lands after the switch', async () => {
    const { E, M, hold, letGo } = await launch()
    hold()
    const early = [M.ministryVerses(43, 4), M.loadMinistryRefs(43, 4, [1])]
    await settle()
    E.setEditionState('1890')
    letGo()
    await Promise.all(early)
    await settle()
    expect(M.peekMinistryVerses(43, 4)).toBeUndefined()
    expect([...(await M.ministryVerses(43, 4))!]).toEqual([17])
    expect(tagOf(await M.loadMinistryRefs(43, 4, [1]))).toBe('1890')
  })
})
