import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Platform } from 'react-native'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import { mediaArt } from '../lib/mediaArt'
import * as Speech from 'expo-speech'
import type { Verse } from '@shared/types'
import { book as bookMeta, fetchChapter } from '../lib/bible'
import { chapterAudioUrl, fetchMarks, numberAudioUrl, PAUSE_MS, positionAt, type ChapterMarks } from '../lib/tts'
import { usePrefsStore } from './prefs'
import { BRAND } from '@shared/brand'

/**
 * Read-aloud. One recorded chapter plays verse by verse from its word timings: an optional spoken verse number
 * (its own small clip per number), the verse itself, an optional pause. With no pauses and no numbers the chapter
 * simply plays on and the verse index follows the clock, so nothing is ever seeked twice. Where a chapter has
 * not been recorded, or offline, the device's own voice reads verse by verse (no word timings, so only the verse
 * is highlighted).
 *
 * Every start, stop or jump bumps `run`; a loop or tick that finds a newer token exits without touching the
 * players, because the newer run owns them. (A stale tick pausing the player after a jump was how "skip" kept
 * playing the old verse.)
 */
export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'
export interface Spoken { book: number; chapter: number; v: number; off: number | null }
interface PlayerState { status: PlayerStatus; spoken: Spoken | null; source: 'recording' | 'device' | null; error: string | null; book: number; chapter: number }
interface PlayerCtx extends PlayerState {
  /** Start reading a chapter from a verse (1 = the top, heading included). Ignored while the same chapter loads. */
  /** `cue`: load and show the bar paused at that verse, without a sound until Play (the guided tour). */
  /** `heading: false`: a passage out of a jotting is read without the chapter's spoken heading, even from verse 1. */
  start: (book: number, chapter: number, fromVerse?: number, opts?: { cue?: boolean; stopAfter?: number; heading?: boolean }) => void
  /** Jump to a verse of the chapter being read, or start that chapter there. */
  /** `stopAfter`: finish that verse and go idle (no auto-next); a later jump or seek clears it. */
  seekVerse: (book: number, chapter: number, v: number, opts?: { stopAfter?: number }) => void
  toggle: () => void
  stop: () => void
  next: () => void
  prev: () => void
  /** Fires when a chapter finishes; the reader decides whether to move on. */
  onEnded: (cb: ((book: number, chapter: number) => void) | null) => void
  /** Fires each time the voice finishes a verse, read out to its last word (a skip or a stop is not finishing it):
   *  what the read-through rule counts as heard (lib/readCredit.ts). Returns the unsubscribe. */
  onVerseHeard: (cb: (book: number, chapter: number, v: number) => void) => () => void
  /** The recording playing, while it is of this chapter: its verse timings time the verses heard. */
  marksOf: (book: number, chapter: number) => ChapterMarks | null
  /** Height of the docked player bar (0 when hidden), so other bottom bars can sit above it. */
  barHeight: number
  setBarHeight: (h: number) => void
}
const Ctx = createContext<PlayerCtx | null>(null)

const POLL_MS = 80
const STOPPED = 'stopped'

/** What is being read: the chapter, its verses, the recording's marks (null = the device voice), and the place in it. */
type Current = { book: number; chapter: number; verses: Verse[]; marks: ChapterMarks | null; index: number; heading: boolean; stopAfter: number | null }

export function PlayerProvider({ children }: { children: ReactNode }) {
  // read at call time, so a pref change never re-renders the provider
  const prefs = usePrefsStore()
  const [state, setState] = useState<PlayerState>({ status: 'idle', spoken: null, source: null, error: null, book: 0, chapter: 0 })
  const [barHeight, setBarHeight] = useState(0)
  const player = useRef<AudioPlayer | null>(null)
  const numbers = useRef<AudioPlayer | null>(null)
  const run = useRef(0)                       // bumps on every start/stop/jump so stale loops exit
  const loading = useRef<string | null>(null) // "book-chapter" while start() fetches, to swallow repeated taps
  const endedCb = useRef<((b: number, c: number) => void) | null>(null)
  const paused = useRef(false)
  /** Started with `cue`: loaded and paused; Play starts the reading loop rather than resuming it. */
  const cued = useRef(false)
  const current = useRef<Current>({ book: 0, chapter: 0, verses: [], marks: null, index: 0, heading: false, stopAfter: null })
  const heardCbs = useRef(new Set<(book: number, chapter: number, v: number) => void>())
  const heard = (book: number, chapter: number, v: number) => heardCbs.current.forEach(cb => cb(book, chapter, v))

  useEffect(() => {
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' }).catch(() => {})
    return () => { player.current?.remove(); numbers.current?.remove() }
  }, [])

  const alive = (token: number) => { if (run.current !== token) throw new Error(STOPPED) }
  const wait = (ms: number, token: number) => new Promise<void>(res => setTimeout(res, ms)).then(() => alive(token))

  /**
   * Play the chapter from `startMs` until `endMs`, resolving when the clock gets there. `verse` is what the
   * follow-along reports. `noSeek` continues from wherever the player is (continuous mode); `keepPlaying` leaves
   * the audio running at the end so the next verse needs no seek. A late tick (timers throttled with the screen
   * off) that finds the clock already past the end simply resolves; the audio has played on, nothing is replayed.
   */
  const playSpan = (startMs: number, endMs: number, token: number, verse: number, opts: { noSeek?: boolean; keepPlaying?: boolean } = {}) => new Promise<void>(async (resolve, reject) => {
    const p = player.current
    if (!p) return reject(new Error('no player'))
    try {
      if (!opts.noSeek) await p.seekTo(startMs / 1000)
      if (run.current !== token) return reject(new Error(STOPPED))
      p.play()
      // After a seek the clock can still report the old position for a tick or two. Replaying an earlier verse
      // from later in the chapter then read as "already past the end" and the verse was skipped. Until the clock
      // is seen near the start (or a grace period passes) neither the end test nor the word highlight trusts it.
      let landed = !!opts.noSeek
      const t0 = Date.now()
      let off: number | null = null
      // A verse's end mark IS the next verse's first word start (the fold leaves no gap; the breath sits at the end
      // of the span). Stopping when the clock reaches it plays the next verse's first syllable, and the seek then
      // plays it again ("...tents. A- ... And the land"): the poll lands up to 80 ms late, the clock is read at
      // poll time, and pause() takes a moment on Android. So a stop is ordered early by `lead` ms of audio (only
      // breath is cut) and the last tick is timed to the boundary. Rolling on (keepPlaying) needs no lead.
      const rate = Math.max(0.5, prefs.get().ttsSpeed || 1)
      const lead = opts.keepPlaying ? 0 : (Platform.OS === 'web' ? 45 : 130) * rate
      const stopAt = Math.max(startMs, endMs - lead)
      const tick = () => {
        if (run.current !== token) return reject(new Error(STOPPED))
        if (paused.current) return setTimeout(tick, POLL_MS)   // paused: hold position, keep polling
        const t = p.currentTime * 1000
        if (!landed) {
          if (Math.abs(t - startMs) < 1200 || Date.now() - t0 > 1500) landed = true
          else return setTimeout(tick, POLL_MS)
        }
        if (t >= stopAt || (p.duration > 0 && t >= p.duration * 1000 - 40)) { if (!opts.keepPlaying) p.pause(); return resolve() }
        const c = current.current
        if (c.marks) {
          // only this verse's own word timings move the highlight; a clock outside the span keeps the last word
          if (prefs.get().ttsWord) { const pos = positionAt(c.marks, t); if (pos && pos.v === verse) off = pos.off } else off = null
          setState(s => (s.spoken && s.spoken.v === verse && s.spoken.off === off) ? s : { ...s, spoken: { book: c.book, chapter: c.chapter, v: verse, off } })
        }
        // the last tick lands on the boundary instead of up to a poll late
        setTimeout(tick, landed ? Math.max(8, Math.min(POLL_MS, (stopAt - t) / rate)) : POLL_MS)
      }
      tick()
    } catch (e) { reject(e) }
  })

  /** One spoken number, a whole clip of its own: no seeking inside a long recording, so it can neither start
   *  early on the previous number nor run on into the next. */
  const playNumber = (n: number, token: number) => new Promise<void>((resolve, reject) => {
    if (!numbers.current) numbers.current = createAudioPlayer(null, { updateInterval: POLL_MS })
    const p = numbers.current
    p.replace({ uri: numberAudioUrl(prefs.get().ttsVoice, n) })
    p.setPlaybackRate(prefs.get().ttsSpeed, 'high')
    p.play()
    const t0 = Date.now(); let started = false
    const tick = () => {
      if (run.current !== token) { p.pause(); return reject(new Error(STOPPED)) }
      if (paused.current) return setTimeout(tick, POLL_MS)
      if (p.playing || p.currentTime > 0) started = true
      const done = (started && !p.playing) || (p.duration > 0 && p.currentTime >= p.duration - 0.06)
      if (done || Date.now() - t0 > 4000) { p.pause(); return resolve() }
      setTimeout(tick, POLL_MS)
    }
    setTimeout(tick, POLL_MS)
  })

  // Darby's [supplied words] are read as words: some engines say "bracket" or stop dead at the marks
  const speakDevice = (text: string, token: number) => new Promise<void>((resolve, reject) => {
    Speech.speak(text.replace(/[[\]]/g, ''), { rate: prefs.get().ttsSpeed, onDone: () => resolve(), onStopped: () => reject(new Error(STOPPED)), onError: () => reject(new Error('device voice failed')) })
    const guard = () => { if (run.current !== token) { Speech.stop(); return } setTimeout(guard, 200) }
    guard()
  })

  /** The reading loop for one chapter; exits when the chapter ends or the run token changes. */
  /** The Listening sheet's "voice, speed, numbers and heading apply from the next verse": the recording of another
   *  voice replaces this one at the verse about to be read (its marks fetched; not recorded = keep this voice). */
  const switchVoice = async (c: Current, voice: string, token: number) => {
    if (!c.marks || !player.current || c.marks.voice === voice) return
    const v = c.marks.verses[c.index]?.v ?? 1
    try {
      const marks = await fetchMarks(voice, c.book, c.chapter)
      if (run.current !== token) return
      player.current.replace({ uri: chapterAudioUrl(voice, c.book, c.chapter) })
      c.marks = marks
      c.index = Math.max(0, marks.verses.findIndex(m => m.v >= v))
    } catch { /* this voice has no recording of the chapter: the current one reads on */ }
  }

  const loop = useCallback(async (token: number) => {
    const c = current.current
    let p = prefs.get()
    try {
      if (c.marks && player.current) {
        player.current.setPlaybackRate(p.ttsSpeed, 'high')
        // nothing between verses: let the audio run and just follow the clock
        const settled = () => { const pause = PAUSE_MS[p.ttsPause]; return { pause, continuous: pause === 0 && !p.ttsNumbers } }
        if (c.heading && p.ttsHeading && c.marks.heading) {
          setState(s => ({ ...s, spoken: { book: c.book, chapter: c.chapter, v: 0, off: null } }))
          await playSpan(c.marks.heading[0], c.marks.heading[1], token, 0, { keepPlaying: settled().continuous })
          await wait(settled().pause, token)
        }
        for (; c.index < c.marks.verses.length; c.index++) {
          // the settings as they stand for this verse: a change in the sheet lands here, not at the next chapter
          p = prefs.get()
          await switchVoice(c, p.ttsVoice, token)
          if (run.current !== token) return
          player.current.setPlaybackRate(p.ttsSpeed, 'high')
          const { pause, continuous } = settled()
          const vm = c.marks.verses[c.index]
          const nextVm = c.marks.verses[c.index + 1]
          setState(s => ({ ...s, spoken: { book: c.book, chapter: c.chapter, v: vm.v, off: null } }))
          if (p.ttsNumbers) { await playNumber(vm.v, token); await wait(120, token) }
          const text = c.verses.find(x => x.v === vm.v)?.t.trim() ?? ''
          if (vm.parts?.length) {
            // the recording service refused part of this verse: recorded clauses play, refused ones are read by the device, in order
            for (const part of vm.parts) {
              if (part.start !== undefined && part.end !== undefined) await playSpan(part.start, part.end, token, vm.v)
              else { const clause = text.slice(part.a, part.b).trim(); if (clause) await speakDevice(clause, token) }
            }
          } else if (vm.words.length || vm.end > vm.start) {   // no word marks: span interpolated from the neighbours
            const last = c.stopAfter !== null && vm.v >= c.stopAfter
            const keep = continuous && !last && !!nextVm && !nextVm.parts?.length && nextVm.start <= vm.end + 60
            // The clock already sits at (or just before, in the breath) this verse's start whenever the previous
            // verse ended here: resume in place. A seek here lands a little early on Android (Ogg pages) and a
            // little late on the web, so the breath or the first syllable played twice ("...tents. A- ... And").
            const now = player.current.currentTime * 1000
            const near = now <= vm.start + 60 && vm.start - now < 700
            await playSpan(vm.start, vm.end, token, vm.v, { noSeek: near, keepPlaying: keep })
          } else if (text) { await speakDevice(text, token) }
          if (run.current === token) heard(c.book, c.chapter, vm.v)
          if (c.stopAfter !== null && vm.v >= c.stopAfter) { c.index++; break }
          if (nextVm) await wait(pause, token)
        }
      } else {
        // device voice: verse by verse
        if (c.heading && p.ttsHeading) await speakDevice(`${bookMeta(c.book).name}, chapter ${c.chapter}.`, token)
        for (; c.index < c.verses.length; c.index++) {
          p = prefs.get()
          const v = c.verses[c.index]
          if (!v.t.trim()) continue
          setState(s => ({ ...s, spoken: { book: c.book, chapter: c.chapter, v: v.v, off: null } }))
          await speakDevice(`${p.ttsNumbers ? `${v.v}. ` : ''}${v.t}`, token)
          if (run.current === token) heard(c.book, c.chapter, v.v)
          if (c.stopAfter !== null && v.v >= c.stopAfter) { c.index++; break }
          if (c.index < c.verses.length - 1) await wait(PAUSE_MS[p.ttsPause], token)
        }
      }
      if (run.current !== token) return
      player.current?.pause()
      setState(s => ({ ...s, status: 'idle', spoken: null }))
      // a selection that asked to stop here is not the chapter ending: no move to the next chapter
      if (c.stopAfter !== null) { c.stopAfter = null; return }
      endedCb.current?.(c.book, c.chapter)
    } catch (e) {
      if ((e as Error).message === STOPPED) return
      setState(s => ({ ...s, status: 'error', error: (e as Error).message, spoken: null }))
    }
  }, [])

  const start = useCallback(async (book: number, chapter: number, fromVerse = 1, opts?: { cue?: boolean; stopAfter?: number; heading?: boolean }) => {
    const key = `${book}-${chapter}`
    if (loading.current === key) return          // a second tap while the first is still fetching
    loading.current = key
    const token = ++run.current
    paused.current = false
    cued.current = false
    Speech.stop(); player.current?.pause(); numbers.current?.pause()
    setState({ status: 'loading', spoken: null, source: null, error: null, book, chapter })
    try {
      const voice = prefs.get().ttsVoice
      const data = await fetchChapter(book, chapter)
      let marks: ChapterMarks | null = null
      if (!prefs.get().ttsDevice) {
        try {
          marks = await fetchMarks(voice, book, chapter)
          if (!player.current) player.current = createAudioPlayer(null, { updateInterval: POLL_MS })
          player.current.replace({ uri: chapterAudioUrl(voice, book, chapter) })
          if (Platform.OS !== 'web') player.current.setActiveForLockScreen(true, { title: `${bookMeta(book).name} ${chapter}`, artist: `${BRAND.name} · Darby`, artworkUrl: await mediaArt() })
        } catch { marks = null }   // not recorded (yet) or offline: the device voice reads instead
      }
      if (run.current !== token) return
      const verses = data.verses
      const list = marks ? marks.verses.map(m => m.v) : verses.map(v => v.v)
      const index = Math.max(0, list.findIndex(v => v >= fromVerse))
      current.current = { book, chapter, verses, marks, index, heading: fromVerse <= 1 && opts?.heading !== false, stopAfter: opts?.stopAfter ?? null }
      if (opts?.cue) { cued.current = true; paused.current = true; setState(s => ({ ...s, status: 'paused', source: marks ? 'recording' : 'device' })); return }
      setState(s => ({ ...s, status: 'playing', source: marks ? 'recording' : 'device' }))
      loop(token)
    } catch (e) { if (run.current === token) setState(s => ({ ...s, status: 'error', error: (e as Error).message })) }
    finally { if (loading.current === key) loading.current = null }
  }, [loop])

  const stop = useCallback(() => {
    run.current++
    paused.current = false
    cued.current = false
    player.current?.pause(); numbers.current?.pause(); Speech.stop()
    if (Platform.OS !== 'web') player.current?.clearLockScreenControls()
    setState(s => ({ ...s, status: 'idle', spoken: null }))
  }, [])

  const toggle = useCallback(() => {
    if (state.status === 'playing') {
      paused.current = true
      player.current?.pause(); numbers.current?.pause()
      if (current.current.marks === null) Speech.stop()     // device voice cannot pause: the verse restarts on resume
      setState(s => ({ ...s, status: 'paused' }))
    } else if (state.status === 'paused') {
      paused.current = false
      if (cued.current) { cued.current = false; const token = ++run.current; loop(token) }
      else if (current.current.marks) player.current?.play()
      else { const token = ++run.current; loop(token) }
      setState(s => ({ ...s, status: 'playing' }))
    }
  }, [state.status, loop])

  /** Restart the loop at verse index `target` of the current chapter. */
  const jumpTo = useCallback((target: number) => {
    const c = current.current
    const token = ++run.current
    paused.current = false
    cued.current = false
    player.current?.pause(); numbers.current?.pause(); Speech.stop()
    current.current = { ...c, index: target, heading: false, stopAfter: null }
    setState(s => ({ ...s, status: 'playing' }))
    loop(token)
  }, [loop])

  const jump = useCallback((delta: number) => {
    const c = current.current
    if (state.status === 'idle' || state.status === 'error') return
    const n = c.marks ? c.marks.verses.length : c.verses.length
    jumpTo(Math.min(n - 1, Math.max(0, c.index + delta)))
  }, [state.status, jumpTo])

  const seekVerse = useCallback((book: number, chapter: number, v: number, opts?: { stopAfter?: number }) => {
    const c = current.current
    const active = state.status === 'playing' || state.status === 'paused'
    if (!active || c.book !== book || c.chapter !== chapter) { start(book, chapter, v, { stopAfter: opts?.stopAfter }); return }
    const list = c.marks ? c.marks.verses.map(m => m.v) : c.verses.map(x => x.v)
    const i = list.findIndex(x => x >= v)
    if (i >= 0) { jumpTo(i); current.current.stopAfter = opts?.stopAfter ?? null }
  }, [state.status, jumpTo, start])

  const onVerseHeard = useCallback((cb: (book: number, chapter: number, v: number) => void) => { heardCbs.current.add(cb); return () => { heardCbs.current.delete(cb) } }, [])
  const marksOf = useCallback((book: number, chapter: number) => { const c = current.current; return c.book === book && c.chapter === chapter ? c.marks : null }, [])
  const value = useMemo<PlayerCtx>(() => ({ ...state, start, seekVerse, toggle, stop, next: () => jump(1), prev: () => jump(-1), onEnded: cb => { endedCb.current = cb }, onVerseHeard, marksOf, barHeight, setBarHeight }), [state, start, seekVerse, toggle, stop, jump, onVerseHeard, marksOf, barHeight])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePlayer() {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePlayer outside PlayerProvider')
  return v
}
