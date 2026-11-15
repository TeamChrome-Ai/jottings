import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ChapterMarks, VerseMark } from '../client/src/lib/tts'

/**
 * The read-aloud player (client/src/store/player.tsx) driven whole, its own code unchanged. The provider keeps its work
 * in refs and callbacks, so a hand-wound set of React's hooks renders it, and a render after a change of state gives
 * the callbacks a reader's tap would reach. The recordings play on a fake clock; the device voice speaks until the
 * test says it is done, and a stop is reported a moment later, as Android does.
 */
const fx = vi.hoisted(() => {
  /** An expo-audio player: its clock runs while it plays, and it stops at the end of the clip. */
  class Clip {
    src: string | null = null
    duration = 0
    muted = false
    volume = 1
    isBuffering = false
    currentStatus = { playbackState: 'ready' }
    private at = 0
    private since = 0
    private on = false
    private settle() { if (this.on && this.duration > 0 && this.at + (Date.now() - this.since) / 1000 >= this.duration) { this.at = this.duration; this.on = false } }
    get playing() { this.settle(); return this.on }
    get currentTime() { this.settle(); return this.on ? this.at + (Date.now() - this.since) / 1000 : this.at }
    replace(s: { uri: string }) { this.src = s.uri; this.at = 0; this.on = false; this.duration = s.uri.startsWith('number/') ? fx.numberSeconds : 60 }
    play() {
      if (this.playing) return
      if (fx.restartAtEnd && this.at >= this.duration) this.at = 0
      if (this.at === 0) fx.begun.push(this.src!)
      this.since = Date.now(); this.on = true
    }
    pause() { this.at = this.currentTime; this.on = false }
    async seekTo(s: number) { this.at = s; this.since = Date.now() }
    setPlaybackRate() {}
    setActiveForLockScreen() {}
    updateLockScreenMetadata() {}
    clearLockScreenControls() {}
    remove() {}
  }

  type Utterance = { text: string; opts: { onDone?: () => void; onStopped?: () => void; onError?: (e: Error) => void } }
  const speech = {
    said: [] as string[],
    now: null as Utterance | null,
    /** How a stop is reported: Android's onStopped, or the web's error ("interrupted"). */
    stopsAs: 'stopped' as 'stopped' | 'error',
    speak(text: string, opts: Utterance['opts']) { speech.said.push(text); speech.now = { text, opts } },
    stop() {
      const u = speech.now
      speech.now = null
      if (u) setTimeout(() => (speech.stopsAs === 'error' ? u.opts.onError?.(new Error('interrupted')) : u.opts.onStopped?.()), 10)
    },
    finish() { const u = speech.now!; speech.now = null; u.opts.onDone?.() },
  }

  // React's hooks, enough of them for one provider
  type Slot = { v?: unknown; deps?: unknown[]; cleanup?: unknown }
  type Tree = { slots: Slot[]; i: number; dirty: boolean; effects: (() => void)[]; value: unknown }
  let rendering: Tree | null = null
  const slot = (): [Tree, Slot] => { const r = rendering!; const k = r.i++; return [r, (r.slots[k] ??= {})] }
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]))
  const hooks = {
    useRef: (init: unknown) => { const [, s] = slot(); return (s.v ??= { current: init }) },
    useState: (init: unknown) => {
      const [r, s] = slot()
      if (!('v' in s)) s.v = init
      const set = (u: unknown) => { const next = typeof u === 'function' ? (u as (x: unknown) => unknown)(s.v) : u; if (!Object.is(next, s.v)) { s.v = next; r.dirty = true } }
      return [s.v, set]
    },
    useMemo: (f: () => unknown, deps: unknown[]) => { const [, s] = slot(); if (!same(s.deps, deps)) { s.v = f(); s.deps = deps } return s.v },
    useCallback: (f: unknown, deps: unknown[]) => hooks.useMemo(() => f, deps),
    useEffect: (f: () => unknown, deps: unknown[]) => {
      const [r, s] = slot()
      if (same(s.deps, deps)) return
      s.deps = deps
      r.effects.push(() => { if (typeof s.cleanup === 'function') s.cleanup(); s.cleanup = f() })
    },
  }
  /** Render the provider; the returned function renders it again when its state has changed, and gives its value. */
  function mount<T>(Provider: (p: { children: null }) => unknown): () => T {
    const r: Tree = { slots: [], i: 0, dirty: true, effects: [], value: null }
    return () => {
      while (r.dirty) {
        r.dirty = false; r.i = 0; rendering = r
        try { r.value = (Provider({ children: null }) as { props: { value: unknown } }).props.value } finally { rendering = null }
        for (const f of r.effects.splice(0)) f()
      }
      return r.value as T
    }
  }

  const later = () => { let release = () => {}; const p = new Promise<void>(r => { release = r }); return { p, release } }
  const fx = {
    Clip, speech, hooks, mount,
    clips: [] as InstanceType<typeof Clip>[],
    prefs: {} as Record<string, unknown>,
    marks: new Map<string, ChapterMarksLike>(),
    texts: new Map<string, { v: number; t: string }[]>(),
    /** Recordings not down yet: the download waits until released. */
    slowAudio: new Map<string, ReturnType<typeof later>>(),
    /** Marks not come yet. */
    slowMarks: new Map<string, ReturnType<typeof later>>(),
    downloads: [] as string[],
    /** Each clip as it begins from its top. */
    begun: [] as string[],
    /** play() on a clip that has ended starts it again from the top, as on the web. */
    restartAtEnd: false,
    /** How long a spoken number's clip is. */
    numberSeconds: 0.6,
    later,
    reset() {
      fx.clips = []; fx.downloads = []; fx.begun = []; fx.restartAtEnd = false; fx.numberSeconds = 0.6; fx.slowAudio.clear(); fx.slowMarks.clear()
      speech.said = []; speech.now = null; speech.stopsAs = 'stopped'
      fx.prefs = { ttsDevice: false, ttsVoice: 'adam', ttsSpeed: 1, ttsPause: 'none', ttsNumbers: false, ttsAutoNext: false, ttsHeading: false, ttsWord: false }
    },
  }
  type ChapterMarksLike = { voice: string; book: number; chapter: number; duration: number; heading: null; verses: unknown[] }
  return fx
})

vi.mock('../client/node_modules/react', async orig => ({ ...(await orig<object>()), ...fx.hooks }))
vi.mock('../client/node_modules/react-native', () => ({ AppState: { currentState: 'active' }, Platform: { OS: 'android' } }))
vi.mock('../client/node_modules/expo-audio', () => ({
  createAudioPlayer: () => { const c = new fx.Clip(); fx.clips.push(c); return c },
  preload: (s: { uri: string }) => { fx.downloads.push(s.uri); return fx.slowAudio.get(s.uri)?.p ?? Promise.resolve() },
  clearPreloadedSource: async () => {},
  setAudioModeAsync: async () => {},
}))
vi.mock('../client/node_modules/expo-speech', () => ({ speak: fx.speech.speak, stop: fx.speech.stop }))
vi.mock('../client/src/lib/mediaArt', () => ({ mediaArt: async () => undefined }))
vi.mock('../client/src/lib/bible', () => ({
  book: () => ({ name: 'Genesis', nameEn: 'Genesis' }),
  fetchChapter: async (b: number, c: number) => ({ book: b, chapter: c, verses: fx.texts.get(`${b}/${c}`) ?? [] }),
  warmChapter: () => {},
}))
vi.mock('../client/src/lib/readAloudClock', () => ({ keepClock: () => {} }))
vi.mock('../client/src/lib/readAloudLog', () => ({ note: () => {}, noteStill: () => {}, watchReading: () => {} }))
vi.mock('../client/src/lib/tts', () => ({
  chapterAudioUrl: (v: string, b: number, c: number) => `chapter/${v}/${b}/${c}`,
  numberAudioUrl: (v: string, n: number) => `number/${v}/${n}`,
  fetchMarks: async (v: string, b: number, c: number) => {
    await fx.slowMarks.get(`${v}/${b}/${c}`)?.p
    const m = fx.marks.get(`${b}/${c}`)
    if (!m) throw new Error('not recorded')
    return { ...m, voice: v }
  },
  PAUSE_MS: { none: 0, short: 500, long: 1200 },
  positionAt: () => null,
}))
vi.mock('../client/src/store/prefs', () => ({ usePrefsStore: () => ({ get: () => fx.prefs }) }))

type Player = ReturnType<typeof import('../client/src/store/player').usePlayer>

/** A recorded chapter of four-second verses. */
function recorded(book: number, chapter: number, verses = 3) {
  const vs: VerseMark[] = Array.from({ length: verses }, (_, i) => ({ v: i + 1, start: i * 4000, end: (i + 1) * 4000, words: [{ off: 0, start: i * 4000, end: i * 4000 + 500 }] }))
  const m: ChapterMarks = { voice: 'adam', book, chapter, duration: verses * 4000, heading: null, verses: vs }
  fx.marks.set(`${book}/${chapter}`, m)
  fx.texts.set(`${book}/${chapter}`, vs.map(x => ({ v: x.v, t: `Verse ${x.v} of ${book}:${chapter}.` })))
}

const adv = (ms: number) => vi.advanceTimersByTimeAsync(ms)
async function until(f: () => boolean, max = 30_000) {
  for (let t = 0; t < max; t += 10) { if (f()) return; await adv(10) }
  throw new Error('it never came')
}

let player: () => Player
beforeEach(async () => {
  vi.useFakeTimers()
  fx.reset()
  vi.resetModules()
  const { PlayerProvider } = await import('../client/src/store/player')
  player = fx.mount<Player>(PlayerProvider as never)
  player()
})
afterEach(() => { vi.useRealTimers() })

describe('the read-aloud player', () => {
  it('reads a recorded chapter verse by verse to its end', async () => {
    recorded(19, 117, 2)
    const ended: string[] = []
    player().onEnded((b, c) => ended.push(`${b}:${c}`))
    player().start(19, 117)
    await adv(100)
    const rec = fx.clips[0]
    expect(rec.src).toBe('chapter/adam/19/117')
    expect(player().status).toBe('playing')
    await until(() => player().status === 'idle')
    expect(rec.currentTime).toBeGreaterThan(7.8)
    expect(ended).toEqual(['19:117'])
  })
})

describe('a chapter left while it loads', () => {
  it('does not take the player from the chapter started after it, when its recording comes down later', async () => {
    recorded(1, 1); recorded(43, 3)
    fx.slowAudio.set('chapter/adam/1/1', fx.later())   // Genesis 1 is not down yet: Listen waits up to 6 s for it
    player().start(1, 1)
    await adv(500)
    player().start(43, 3)                                 // John 3 is down already
    await adv(1000)
    const rec = fx.clips[0]
    expect(rec.src).toBe('chapter/adam/43/3')
    expect(rec.playing).toBe(true)
    await adv(6000)                                       // Genesis's wait runs out
    expect(player().book).toBe(43)
    expect(rec.src).toBe('chapter/adam/43/3')
    expect(rec.playing).toBe(true)
  })

  it('does not take the player from the chapter started after it, when its marks come later', async () => {
    recorded(1, 1); recorded(43, 3)
    const marks = fx.later()
    fx.slowMarks.set('adam/1/1', marks)
    player().start(1, 1)
    await adv(500)
    player().start(43, 3)
    await adv(1000)
    const rec = fx.clips[0]
    expect(rec.src).toBe('chapter/adam/43/3')
    marks.release()
    await adv(7000)
    expect(rec.src).toBe('chapter/adam/43/3')
    expect(rec.playing).toBe(true)
    expect(fx.downloads).not.toContain('chapter/adam/1/1')   // nor is the chapter left fetched
  })

  it('does not take the player from the chapter started after it, when another voice chosen in the sheet comes down later', async () => {
    recorded(43, 3); recorded(43, 4)
    player().start(43, 3)
    await adv(1000)
    const rec = fx.clips[0]
    fx.prefs.ttsVoice = 'bob'                             // the Listening sheet: another voice, from the next verse
    fx.slowAudio.set('chapter/bob/43/3', fx.later())
    await adv(4000)                                       // verse 2: bob's John 3 is not down yet
    fx.prefs.ttsVoice = 'adam'
    player().start(43, 4)
    await adv(1000)
    expect(rec.src).toBe('chapter/adam/43/4')
    await adv(6000)
    expect(rec.src).toBe('chapter/adam/43/4')
    expect(rec.playing).toBe(true)
  })
})

describe('a pause with the verse numbers said', () => {
  it('Play goes on with the number where the pause held it, and then the verse from its start', async () => {
    recorded(1, 2)
    fx.prefs.ttsNumbers = true
    player().start(1, 2)
    await adv(300)                                        // "One" is being said (a clip of 0.6 s)
    const [rec, num] = fx.clips
    expect(num.src).toBe('number/adam/1')
    expect(num.playing).toBe(true)
    player().toggle()
    await adv(5000)                                       // longer than the 4 s a number's clip is given to start
    expect(player().status).toBe('paused')
    expect(num.playing).toBe(false)
    player().toggle()
    await adv(100)
    expect(num.playing).toBe(true)                        // the number goes on
    expect(rec.playing).toBe(false)                       // and the chapter waits for it
    await adv(250)
    expect(num.currentTime).toBeCloseTo(0.6)              // said to its end
    await until(() => rec.playing)
    expect(rec.currentTime).toBeLessThan(0.1)             // verse 1 from its first word
  })

  it('a pause that comes as the number ends does not have Play say it again', async () => {
    recorded(1, 2)
    fx.prefs.ttsNumbers = true
    fx.restartAtEnd = true
    // "One" ends at 0.63 s, between the ticks at 0.56 (too soon to call it done) and 0.64
    fx.numberSeconds = 0.63
    player().start(1, 2)
    await adv(635)
    player().toggle()
    await adv(1000)
    player().toggle()
    const rec = fx.clips[0]
    await until(() => rec.playing)
    expect(fx.begun.filter(s => s.startsWith('number/'))).toEqual(['number/adam/1'])
    expect(rec.currentTime).toBeLessThan(0.1)
  })

  it('Play in the pause between verses says the next number with the chapter waiting, not under it', async () => {
    recorded(1, 2)
    fx.prefs.ttsNumbers = true
    fx.prefs.ttsPause = 'long'                            // 1.2 s between verses
    player().start(1, 2)
    await until(() => (fx.clips[0]?.currentTime ?? 0) > 3.5 && !fx.clips[0].playing)   // verse 1 read: the pause after it
    const [rec, num] = fx.clips
    player().toggle()
    await adv(2000)
    player().toggle()
    await adv(100)
    expect(num.src).toBe('number/adam/2')
    expect(num.playing).toBe(true)
    expect(rec.playing).toBe(false)
    await until(() => rec.playing)
    expect(rec.currentTime).toBeGreaterThan(3.5)          // verse 2 from its start, heard once
    expect(rec.currentTime).toBeLessThan(4.1)
  })
})

/** A chapter whose first verse the recording service refused in part: its middle clause is left to the device voice. */
function partlyRecorded() {
  const text = 'In the beginning, said the Lord, all was dark.'
  const a = text.indexOf(' said'), b = text.indexOf(' all')
  fx.marks.set('1/3', { voice: 'adam', book: 1, chapter: 3, duration: 9000, heading: null, verses: [
    { v: 1, start: 0, end: 5000, words: [], parts: [{ a: 0, b: a, start: 0, end: 2000 }, { a, b }, { a: b, b: text.length, start: 3000, end: 5000 }] },
    { v: 2, start: 5000, end: 9000, words: [{ off: 0, start: 5000, end: 5500 }] },
  ] })
  fx.texts.set('1/3', [{ v: 1, t: text }, { v: 2, t: 'And there was light.' }])
}

describe('a pause while the device voice reads', () => {
  it('silences a clause the recording lacks, and Play says it again before the recording reads on', async () => {
    partlyRecorded()
    player().start(1, 3)
    await until(() => fx.speech.now?.text === 'said the Lord,')
    const rec = fx.clips[0]
    player().toggle()
    await adv(200)
    expect(fx.speech.now).toBeNull()                      // silent
    await adv(2000)
    expect(player().status).toBe('paused')
    player().toggle()
    await adv(200)
    expect(fx.speech.now?.text).toBe('said the Lord,')    // the clause again, from its start
    expect(rec.playing).toBe(false)                       // the recording waits for it
    fx.speech.finish()
    await until(() => rec.playing)
    expect(rec.currentTime).toBeGreaterThanOrEqual(3)     // the next recorded clause
    expect(rec.currentTime).toBeLessThan(3.1)
    expect(fx.speech.said).toEqual(['said the Lord,', 'said the Lord,'])
    await until(() => player().status === 'idle')         // and on to the chapter's end
  })

  it('reads on the same where the stop is reported as an error, as on the web', async () => {
    fx.speech.stopsAs = 'error'
    partlyRecorded()
    player().start(1, 3)
    await until(() => fx.speech.now?.text === 'said the Lord,')
    const rec = fx.clips[0]
    player().toggle()
    await adv(200)
    expect(fx.speech.now).toBeNull()
    await adv(2000)
    expect(player().status).toBe('paused')
    player().toggle()
    await adv(200)
    expect(player().status).toBe('playing')
    expect(fx.speech.now?.text).toBe('said the Lord,')
    fx.speech.finish()
    await until(() => rec.playing)
    expect(rec.currentTime).toBeGreaterThanOrEqual(3)
    await until(() => player().status === 'idle')
  })

  it('with the device voice alone, stops it, and Play reads the verse again', async () => {
    fx.prefs.ttsDevice = true
    fx.texts.set('19/117', [{ v: 1, t: 'O praise the LORD.' }, { v: 2, t: 'For his loving-kindness is great.' }])
    player().start(19, 117)
    await adv(100)
    expect(fx.speech.now?.text).toBe('O praise the LORD.')
    player().toggle()
    await adv(200)
    expect(fx.speech.now).toBeNull()
    expect(player().status).toBe('paused')
    player().toggle()
    await adv(100)
    expect(fx.speech.now?.text).toBe('O praise the LORD.')
    fx.speech.finish()
    await adv(100)
    expect(fx.speech.now?.text).toBe('For his loving-kindness is great.')
    fx.speech.finish()
    await adv(100)
    expect(player().status).toBe('idle')
  })
})
