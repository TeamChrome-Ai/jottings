import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What a car asks of the app (client/src/lib/car.ts), with the phone's media session and the player stood in for: a
 * command comes as the service sends it, and the test reads what the player was asked to do and what the session was
 * told. No screen is mounted anywhere here, as none is when a car starts the app.
 */
type Command = { seq: number; type: string; id?: string; query?: string; speed?: number; ms?: number }
type State = { status: string; book: number; chapter: number; spoken: { book: number; chapter: number; v: number; off: null } | null; error: string | null; source: null }

const fx = vi.hoisted(() => {
  const fx = {
    command: (_: unknown) => {},
    described: [] as Record<string, unknown>[],
    published: [] as string[],
    places: [] as (string | null)[],
    found: [] as [string, string][],
    onFile: null as string | null,
    place: null as string | null,
    listening: 0,
    calls: [] as string[],
    state: { status: 'idle', book: 0, chapter: 0, spoken: null, error: null, source: null } as unknown,
    settled: [] as ((s: unknown) => void)[],
    prefs: { ttsSpeed: 1, lang: 'en', bible: 'auto' } as Record<string, unknown>,
    prefsHeard: [] as (() => void)[],
    position: null as { book: number; chapter: number; verse: number } | null,
    woken: 0,
    outside: false,
  }
  return fx
})
const set = (s: Partial<State>) => { fx.state = { ...(fx.state as State), ...s }; fx.settled.forEach(f => f(fx.state)) }

vi.mock('../client/src/lib/mediaLibrary', () => ({
  mediaLibrary: {
    listen: () => { fx.listening++ },
    describe: (r: Record<string, unknown>) => { fx.described.push(r) },
    catalogueKey: () => fx.onFile,
    publish: (key: string, json: string) => { fx.published.push(json); fx.onFile = key },
    place: () => fx.place,
    setPlace: (json: string | null) => { fx.places.push(json); fx.place = json },
    found: (query: string, items: string) => { fx.found.push([query, items]) },
    addListener: (_: string, f: (c: unknown) => void) => { fx.command = f; return { remove() {} } },
  },
}))
vi.mock('../client/src/store/player', () => ({
  playerEngine: () => ({
    getState: () => fx.state,
    onSettled: (f: (s: unknown) => void) => { fx.settled.push(f); return () => {} },
    start: (b: number, c: number, v = 1) => { fx.calls.push(`start ${b}:${c}:${v}`); set({ status: 'loading', book: b, chapter: c }) },
    toggle: () => { fx.calls.push('toggle'); set({ status: (fx.state as State).status === 'playing' ? 'paused' : 'playing' }) },
    stop: () => { fx.calls.push('stop'); set({ status: 'idle', spoken: null }) },
    heldOutside: () => { fx.calls.push('outside'); fx.outside = true },
    isHeldOutside: () => fx.outside,
    seekVerse: (b: number, c: number, v: number) => { fx.calls.push(`seek ${b}:${c}:${v}`) },
    // a recording of four-second verses, of John 3 alone
    marksOf: (b: number, c: number) => (b === 43 && c === 3 ? { duration: 144_000, heading: null, verses: Array.from({ length: 36 }, (_, i) => ({ v: i + 1, start: i * 4000, end: (i + 1) * 4000 })) } : null),
  }),
}))
vi.mock('../client/src/store/prefs', () => ({
  loadPrefs: async () => {},
  prefsStore: { get: () => fx.prefs, set: (p: Record<string, unknown>) => { fx.prefs = { ...fx.prefs, ...p }; fx.prefsHeard.forEach(f => f()) }, subscribe: (f: () => void) => { fx.prefsHeard.push(f); return () => {} } },
}))
vi.mock('../client/src/i18n', async () => ({ ...(await import('../shared/i18n')), langOf: () => 'en', loadLanguage: async () => {} }))
vi.mock('../client/src/lib/api', () => ({ loadApiBase: async () => '' }))
vi.mock('../client/src/lib/edition', () => ({ loadEdition: async () => 'darby' }))
vi.mock('../client/src/lib/text', () => ({ setText: () => {}, onSourceChange: () => () => {} }))
vi.mock('../client/src/lib/mediaArt', () => ({ mediaArt: async () => 'file:///art.png' }))
vi.mock('../client/src/lib/readAloudClock', () => ({ wakeClock: () => { fx.woken++ } }))
vi.mock('../client/src/lib/tts', () => ({ SPEEDS: [0.8, 0.9, 1, 1.1, 1.25, 1.5] }))
vi.mock('../client/src/hooks/usePosition', () => ({ localPosition: async () => fx.position }))
vi.mock('../client/src/lib/bible', () => ({
  nextChapter: (b: number, c: number) => (b === 43 && c === 21 ? { book: 44, chapter: 1 } : { book: b, chapter: c + 1 }),
  prevChapter: (b: number, c: number) => (c > 1 ? { book: b, chapter: c - 1 } : null),
}))

let seq = 0
/** A command as the service sends it; resolves when the app has dealt with it. */
async function ask(type: string, more: Partial<Command> = {}) {
  fx.command({ seq: ++seq, type, ...more })
  for (let i = 0; i < 20; i++) await Promise.resolve()
  await new Promise(r => setTimeout(r, 0))
}
const last = () => fx.described[fx.described.length - 1]

beforeEach(async () => {
  vi.resetModules()
  seq = 0
  Object.assign(fx, { described: [], published: [], places: [], found: [], onFile: null, place: null, listening: 0, calls: [], settled: [], prefsHeard: [], position: null, woken: 0, outside: false })
  fx.state = { status: 'idle', book: 0, chapter: 0, spoken: null, error: null, source: null }
  fx.prefs = { ttsSpeed: 1, lang: 'en', bible: 'auto' }
  const { registerCar } = await import('../client/src/lib/car')
  registerCar()
})

describe('a car\'s commands, with no screen', () => {
  it('says it is listening as it registers, and builds nothing until it is asked', () => {
    expect(fx.listening).toBe(1)
    expect(fx.published).toEqual([])
    expect(fx.described).toEqual([])
  })

  it('plays the chapter an entry of the tree names, from its verse', async () => {
    await ask('play', { id: 'c/19/23' })
    expect(fx.calls).toEqual(['outside', 'start 19:23:1'])
    await ask('play', { id: 'c/43/3/16' })
    expect(fx.calls.slice(2)).toEqual(['outside', 'start 43:3:16'])
  })

  it('plays what "play John 3" names', async () => {
    await ask('play', { query: 'John 3' })
    expect(fx.calls).toEqual(['outside', 'start 43:3:1'])
  })

  it('keeps the app\'s timers running for a command that arrives with the app closed', async () => {
    await ask('play', { id: 'c/19/23' })
    expect(fx.woken).toBe(1)
  })

  it('a bare Play resumes a paused reading, and leaves a reading that is going alone', async () => {
    set({ status: 'paused', book: 43, chapter: 3 })
    await ask('play')
    expect(fx.calls).toEqual(['toggle'])
    await ask('play')
    expect(fx.calls).toEqual(['toggle'])
  })

  it('a bare Play with nothing in hand, or words that name no book, goes on from the place last reached', async () => {
    fx.place = JSON.stringify({ id: 'c/45/8/28', t: 'Romans 8' })
    await ask('play')
    expect(fx.calls).toEqual(['outside', 'start 45:8:28'])
    set({ status: 'idle' })
    await ask('play', { query: 'the weather tomorrow' })
    expect(fx.calls.slice(2)).toEqual(['outside', 'start 45:8:28'])
  })

  it('with no place saved, starts where the reader last read, or at John 1', async () => {
    fx.position = { book: 19, chapter: 119, verse: 105 }
    await ask('play')
    expect(fx.calls).toEqual(['outside', 'start 19:119:1'])
    set({ status: 'idle' })
    fx.position = null
    await ask('play')
    expect(fx.calls.slice(2)).toEqual(['outside', 'start 43:1:1'])
  })

  it('pauses a reading, and stops one still loading', async () => {
    set({ status: 'playing', book: 43, chapter: 3 })
    await ask('pause')
    expect(fx.calls).toEqual(['toggle'])
    set({ status: 'loading' })
    await ask('pause')
    expect(fx.calls).toEqual(['toggle', 'stop'])
  })

  it('Next and Previous move by a chapter, across a book\'s end', async () => {
    set({ status: 'playing', book: 43, chapter: 3 })
    await ask('next')
    expect(fx.calls).toEqual(['outside', 'start 43:4:1'])
    await ask('previous')
    expect(fx.calls.slice(2)).toEqual(['outside', 'start 43:3:1'])
    set({ book: 43, chapter: 21 })
    await ask('next')
    expect(fx.calls.slice(4)).toEqual(['outside', 'start 44:1:1'])
  })

  it('the speed button steps the Listening setting through its speeds and round again', async () => {
    const seen: unknown[] = []
    for (let i = 0; i < 6; i++) { await ask('speed'); seen.push(fx.prefs.ttsSpeed) }
    expect(seen).toEqual([1.1, 1.25, 1.5, 0.8, 0.9, 1])
    await ask('speed', { speed: 1.3 })
    expect(fx.prefs.ttsSpeed).toBe(1.25)
  })

  it('the car going pauses the reading it asked for, and stops one still loading', async () => {
    await ask('play', { id: 'c/43/3' })
    set({ status: 'playing' })
    await ask('gone')
    expect(fx.calls.slice(2)).toEqual(['toggle'])
    expect((fx.state as State).status).toBe('paused')
    set({ status: 'loading' })
    await ask('gone')
    expect(fx.calls.slice(3)).toEqual(['stop'])
  })

  it('the car going leaves alone a reading the screens started', async () => {
    set({ status: 'playing', book: 43, chapter: 3 })
    await ask('gone')
    expect(fx.calls).toEqual([])
  })

  it('knows no place in time: a seek moves nothing', async () => {
    await ask('play', { id: 'c/43/3' })
    set({ status: 'playing' })
    await ask('seek', { ms: 61_500 })
    expect(fx.calls.slice(2)).toEqual([])
    expect((fx.state as State).status).toBe('playing')
  })

  it('answers a search with the chapters it names', async () => {
    await ask('find', { query: 'John 3' })
    await ask('find', { query: 'the weather tomorrow' })
    expect(fx.found).toEqual([['John 3', JSON.stringify([{ id: 'c/43/3', t: 'John 3' }])], ['the weather tomorrow', '[]']])
  })
})

describe('what the session is told', () => {
  it('the chapter, its state and the speed, with the command it answers', async () => {
    await ask('play', { id: 'c/43/3' })
    expect(last()).toMatchObject({ on: true, status: 'loading', id: 'c/43/3', title: 'John 3', art: 'file:///art.png', speed: 1, speedLabel: 'Speed 1×', ack: 1 })
    set({ status: 'playing' })
    expect(last()).toMatchObject({ on: true, status: 'playing', ack: 1 })
    await ask('speed')
    expect(last()).toMatchObject({ speed: 1.1, speedLabel: 'Speed 1.1×', ack: 2 })
  })

  it('nothing that claims a place in time: no length, no position, for a recording as for the device voice', async () => {
    await ask('play', { id: 'c/43/3' })
    set({ status: 'playing', spoken: { book: 43, chapter: 3, v: 16, off: null } })
    expect(last()).toMatchObject({ on: true, status: 'playing', id: 'c/43/3' })
    expect(last()).not.toHaveProperty('duration')
    expect(last()).not.toHaveProperty('position')
    const told = fx.described.length
    set({ spoken: { book: 43, chapter: 3, v: 17, off: null } })
    expect(fx.described).toHaveLength(told)   // a new verse is no news to the session
    await ask('play', { id: 'c/19/23' })
    set({ status: 'playing', spoken: { book: 19, chapter: 23, v: 2, off: null } })
    expect(last()).not.toHaveProperty('duration')
    expect(last()).not.toHaveProperty('position')
  })

  it('nothing in hand once the reading is stopped', async () => {
    await ask('play', { id: 'c/43/3' })
    await ask('stop')
    expect(last()).toMatchObject({ on: false, status: 'idle', ack: 2 })
  })

  it('a change of speed in the Listening sheet', async () => {
    await ask('play', { id: 'c/43/3' })
    fx.prefs = { ...fx.prefs, ttsSpeed: 1.5 }
    fx.prefsHeard.forEach(f => f())
    expect(last()).toMatchObject({ speed: 1.5, speedLabel: 'Speed 1.5×' })
  })

  it('the same thing is not told twice', async () => {
    await ask('play', { id: 'c/43/3' })
    const n = fx.described.length
    set({ status: 'loading' })
    expect(fx.described).toHaveLength(n)
  })
})

describe('the place to continue from', () => {
  it('follows the verse being read, one saving a verse', async () => {
    await ask('play', { id: 'c/43/3' })
    set({ status: 'playing', spoken: { book: 43, chapter: 3, v: 0, off: null } })
    set({ spoken: { book: 43, chapter: 3, v: 1, off: null } })
    set({ spoken: { book: 43, chapter: 3, v: 16, off: null } })
    set({ spoken: { book: 43, chapter: 3, v: 16, off: null } })
    expect(fx.places.map(p => JSON.parse(p!))).toEqual([{ id: 'c/43/3', t: 'John 3' }, { id: 'c/43/3/16', t: 'John 3', s: 'From verse 16' }])
  })

  it('stays where the reading stopped', async () => {
    await ask('play', { id: 'c/43/3' })
    set({ status: 'playing', spoken: { book: 43, chapter: 3, v: 16, off: null } })
    await ask('stop')
    expect(JSON.parse(fx.place!)).toMatchObject({ id: 'c/43/3/16' })
  })
})

describe('the tree', () => {
  it('is written when the service asks for it and none is on file', async () => {
    await ask('tree')
    expect(fx.published).toHaveLength(1)
    const tree = JSON.parse(fx.published[0]) as { key: string; nodes: Record<string, { c?: string[] }> }
    expect(tree.nodes.root.c).toEqual(['continue', 'bible'])
    expect(tree.nodes['b/43'].c).toHaveLength(21)
  })

  it('is not written again while the one on file is in the app\'s language and Bible', async () => {
    await ask('tree')
    await ask('tree')
    await ask('play', { id: 'c/43/3' })
    expect(fx.published).toHaveLength(1)
  })

  it('is written again when the one on file is another language\'s', async () => {
    fx.onFile = '1:fr:fr'
    await ask('tree')
    expect(fx.published).toHaveLength(1)
  })
})
