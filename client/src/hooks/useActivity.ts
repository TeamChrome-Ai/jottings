import { useCallback, useEffect, useRef } from 'react'
import { useFocusEffect } from 'expo-router'
import { AppState, Platform } from 'react-native'
import type { Badge, StreakInfo } from '@shared/types'
import type { Shape } from '@shared/readThrough'
import { post } from '../lib/api'
import { localDay, tzOffsetMin } from '../lib/localDay'
import { adopt, earned, estimate, judgeLocal, newVisit, noteHeard, noteScreen, takeEvidence, type Standing, type Visit } from '../lib/readCredit'
import { noteLocalRead } from '../lib/paths'
import { sessionId } from '../lib/session'
import { useAuth } from '../store/auth'

/** `date`: the reader-local day the beat was credited to. `reading`: where the beat's chapter stands. */
export interface BeatResult { date?: string; active_seconds_today: number; pages_today: number; credited?: { book: number; chapter: number }; streak: StreakInfo; new_badges: Badge[]; /** reactions from friends not yet seen on Stats */ unseen_reactions?: number; /** friend invites waiting (none while invites are off) */ incoming_invites?: number; reading?: Standing }
type Listener = (r: BeatResult) => void
const listeners = new Set<Listener>()
export const onBeat = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l) } }

/** No touch or scroll for this long and the reader is taken to have stopped. Kept at a minute whatever is on screen: the
 *  touch and scroll sensor is the rule's first guard against a phone left on a page (the owner, 2026-10-14). */
const IDLE_MS = 60_000
const BEAT_MS = 15_000
/** How often the screen is looked at between scrolls, for the glance (lib/readCredit.ts `Glance`). */
const LOOK_MS = 1_000
const SIGNAL_DEBOUNCE_MS = 4_000
/** An early beat goes this long after the rule looks met, so the server's tally (whole seconds) has it too. */
const PROMPT_SLACK_MS = 600

/** When the session last sent a beat: the server counts the time since then toward the next one. */
let lastBeatAt: number | null = null
/** Beats go one at a time, so the one closing a chapter reaches the server before the one opening the next. */
let queue: Promise<unknown> = Promise.resolve()

/** What `toCredit` answers: until the chapter counts if the reader stays (`ms`, null while `gaps` are still to read),
 *  and whether the time is counting now. */
export interface CreditWait { ms: number | null; gaps: [number, number][]; counting: boolean }

/** Where the reader is and what it can say about it. */
export interface ActivitySource {
  getProgress: () => number
  /** The chapter named is showing its end; false for any other. */
  atEnd: (book: number, chapter: number) => boolean
  /** The verses on screen, or that went across it since the last call; null before the text is laid out. */
  seen: () => [number, number] | null
  /** The voice is reading this chapter now. */
  listening: () => boolean
  /** The shown chapter's verses as the rule weighs them, once its text is in. */
  shape: Shape | undefined
}

/**
 * Streak heartbeat and the read-through rule (docs/READING.md). While the reader is the focused screen, POST
 * /activity/beat every 15 s, and once more on leaving the chapter so the time since the last beat lands on the chapter
 * it was spent on. Each beat says which verses were on screen and which the voice finished since the last; the server
 * keeps the chapter's state and credits it once all of it has gone past the reader and the time spent matches its
 * length. The device mirrors the rule to say how far off that is (`toCredit`) and sends a beat the moment it looks met.
 * A reader left mounted under another tab or under paged mode stays quiet: it shares the session, so its beats would
 * move `last_beat_at` under the reader actually in use.
 * `mark()` is what the reader calls on touches and scrolls: it resets the idle clock, counts one signal per 4 s burst
 * and reads the screen. `hear(v)` notes a verse the voice finished. While the voice reads, a beat with the app hidden
 * (the screen locked) still brings the time those verses take. Each beat names the device's date and UTC offset.
 */
export function useActivity(book: number | undefined, chapter: number | undefined, source: ActivitySource) {
  const { user } = useAuth()
  const lastInput = useRef(Date.now())
  const signals = useRef(0)
  const lastSignal = useRef(0)
  const visible = useRef(AppState.currentState === 'active' || AppState.currentState === 'unknown')
  const src = useRef(source)
  src.current = source
  /** The chapter `src` speaks for: between a chapter change and the effect that closes the old visit, it is the new one. */
  const srcKey = useRef('')
  srcKey.current = `${book}.${chapter}`
  /** This reader is the focused screen; a reader left mounted under another stays quiet (no beats, no early beats). */
  const focused = useRef(false)
  /** The chapter being read; kept across a blur and refocus of the same chapter. */
  const visit = useRef<Visit | null>(null)
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendRef = useRef<(v: Visit) => void>(() => {})
  const signedIn = useRef(false)

  const isActive = () => Date.now() - lastInput.current < IDLE_MS
  /** The time is counting: the reader active on a showing screen, or the voice reading. */
  const counting = () => (isActive() && visible.current) || src.current.listening()
  const estimateNow = (v: Visit) => {
    const shape = v.shape
    return shape ? estimate(v, shape, earned(lastBeatAt, Date.now(), counting())) : null
  }
  /** A beat soon if the rule looks met within one beat. At most one early beat a beat apart, so a server that sees it
   *  otherwise is not asked again and again. */
  const promptCredit = useCallback((v: Visit) => {
    if (!focused.current || !signedIn.current || v.credited || visit.current !== v || Date.now() - v.promptedAt < BEAT_MS) return
    const e = estimateNow(v)
    if (!e || e.ms === null || e.ms >= BEAT_MS) return
    if (soon.current) clearTimeout(soon.current)
    soon.current = setTimeout(() => {
      soon.current = null
      if (visit.current === v && !v.credited) { v.promptedAt = Date.now(); sendRef.current(v) }
    }, e.ms + PROMPT_SLACK_MS)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  /** Reads the screen into the visit: the verses on it and the time on them, the furthest progress, the end. */
  const observe = useCallback((v: Visit) => {
    if (srcKey.current !== `${v.book}.${v.chapter}`) return
    if (src.current.shape) v.shape = src.current.shape
    v.progress = Math.max(v.progress, Math.max(0, Math.min(1, src.current.getProgress())))
    v.reached = src.current.atEnd(v.book, v.chapter)
    noteScreen(v, v.shape, visible.current ? src.current.seen() : null, Date.now(), isActive() && visible.current)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const mark = useCallback(() => {
    const now = Date.now()
    lastInput.current = now
    if (now - lastSignal.current > SIGNAL_DEBOUNCE_MS) { signals.current++; lastSignal.current = now }
    const v = visit.current
    if (v && focused.current) { observe(v); promptCredit(v) }
  }, [observe, promptCredit])
  /** The voice finished verse `n` of chapter `b`:`c` (the chapter's last: the voice reached its end). */
  const hear = useCallback((b: number, c: number, n: number) => {
    const v = visit.current
    if (!focused.current || !v || v.book !== b || v.chapter !== c) return
    lastInput.current = Date.now()
    noteHeard(v, n)
    promptCredit(v)
  }, [promptCredit])

  const uid = user?.id
  signedIn.current = !!uid
  /** How far the chapter showing is from counting (`CreditWait`). Null signed out, before its text is in and once
   *  credited. The line at the chapter's end reads it on its own clock, so nothing here renders. */
  const toCredit = useCallback((): CreditWait | null => {
    const v = visit.current
    if (!signedIn.current || !v || v.credited) return null
    const e = estimateNow(v)
    return e && { ...e, counting: counting() }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps
  // a fresh chapter counts as input
  useEffect(() => { lastInput.current = Date.now() }, [book, chapter])

  useFocusEffect(useCallback(() => {
    if (!book || !chapter) return
    const v = visit.current && visit.current.book === book && visit.current.chapter === chapter ? visit.current : newVisit(book, chapter)
    visit.current = v
    focused.current = true
    visible.current = AppState.currentState === 'active' || AppState.currentState === 'unknown'
    const sub = AppState.addEventListener('change', s => { visible.current = s === 'active'; observe(v) })
    const looks = setInterval(() => { if (visible.current) observe(v) }, LOOK_MS)
    if (!uid) {
      // signed out: no beats, but the same rule judged on the device feeds the path's local read set (docs/PATHS.md rule 1)
      let last: number | null = null
      const judge = (closing = false) => {
        // the closing look runs with the screen already on the next chapter: what was seen is as last read
        if (!closing) observe(v)
        const now = Date.now(), shape = v.shape
        if (shape && judgeLocal(v, shape, last === null ? 0 : now - last, { active: isActive(), visible: visible.current, listening: src.current.listening() }, now)) {
          v.credited = true
          noteLocalRead(v.book, v.chapter)
        }
        last = now
      }
      sendRef.current = () => judge()
      const t = setInterval(() => judge(), BEAT_MS)
      judge()
      return () => { focused.current = false; clearInterval(t); clearInterval(looks); sub.remove(); if (soon.current) { clearTimeout(soon.current); soon.current = null }; judge(true) }
    }
    const send = (sv: Visit, closing = false) => {
      const t = new Date(), now = t.getTime(), active = isActive()
      lastBeatAt = now
      const ev = takeEvidence(sv, sv.shape)
      const body = {
        local_date: localDay(t), tz_offset_min: tzOffsetMin(t), session_id: sessionId, book: sv.book, chapter: sv.chapter, progress: sv.progress,
        reached_end: sv.reached, signals: signals.current, active, visible: visible.current, device: Platform.OS === 'web' ? 'web' : 'mobile',
        // the voice finishing a verse is the voice reading, though it goes quiet at the chapter's end
        seen: ev.seen, heard: ev.heard, listening: (!closing && src.current.listening()) || ev.heard.length > 0,
      }
      signals.current = 0
      queue = queue.then(() => post<BeatResult>('/activity/beat', body)).then(r => {
        const st = r.reading
        // the server's word on the chapter, a new day included (a visit kept open past midnight counts again)
        if (st && st.book === sv.book && st.chapter === sv.chapter) { adopt(sv, st.through, sv.shape); sv.credited = st.credited_today; if (st.audio_ms) sv.audioMs = st.audio_ms; sv.msPerWord = st.ms_per_word }
        if (r.credited && r.credited.book === sv.book && r.credited.chapter === sv.chapter) { sv.credited = true; noteLocalRead(sv.book, sv.chapter) }
        listeners.forEach(l => l(r))
        promptCredit(sv)
      }, () => { ev.restore() /* offline: the verses ride with the next beat (the server counts at most 20 s of the gap) */ })
    }
    sendRef.current = send
    const tick = () => { observe(v); send(v) }
    const t = setInterval(tick, BEAT_MS)
    tick()
    return () => {
      focused.current = false
      clearInterval(t); clearInterval(looks); sub.remove()
      if (soon.current) { clearTimeout(soon.current); soon.current = null }
      // the time since the last beat belongs to this chapter, and so do the verses read since
      send(v, true)
    }
  }, [uid, book, chapter, observe, promptCredit]))  // eslint-disable-line react-hooks/exhaustive-deps

  return { mark, hear, toCredit }
}
