import { useCallback, useEffect, useRef } from 'react'
import { useFocusEffect } from 'expo-router'
import { AppState, Platform } from 'react-native'
import type { Badge, StreakInfo } from '@shared/types'
import { post } from '../lib/api'
import { localDay, tzOffsetMin } from '../lib/localDay'
import { earned, msToCredit, newVisit, type Visit } from '../lib/readCredit'
import { noteLocalRead } from '../lib/paths'
import { sessionId } from '../lib/session'
import { useAuth } from '../store/auth'

/** `date`: the reader-local day the beat was credited to. */
export interface BeatResult { date?: string; active_seconds_today: number; pages_today: number; credited?: { book: number; chapter: number }; streak: StreakInfo; new_badges: Badge[]; /** reactions from friends not yet seen on Stats */ unseen_reactions?: number; /** friend invites waiting (none while invites are off) */ incoming_invites?: number }
type Listener = (r: BeatResult) => void
const listeners = new Set<Listener>()
export const onBeat = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l) } }

const IDLE_MS = 60_000
const BEAT_MS = 15_000
const SIGNAL_DEBOUNCE_MS = 4_000
/** An early beat goes this long after the rule looks met, so the server's tally (whole seconds) has it too. */
const PROMPT_SLACK_MS = 600

/** When the session last sent a beat: the server counts the time since then toward the next one. */
let lastBeatAt: number | null = null
/** Beats go one at a time, so the one closing a chapter reaches the server before the one opening the next. */
let queue: Promise<unknown> = Promise.resolve()

/** Where the reader is and what it can say about it. `atEnd` answers for the chapter named, false for any other. */
export interface ActivitySource {
  getProgress: () => number
  atEnd: (book: number, chapter: number) => boolean
  /** The shown chapter's word count (`chapterWords`), once its text is in. */
  words: number | undefined
}

/**
 * Streak heartbeat. While the reader is the focused screen and the app is in the foreground, POST /activity/beat
 * every 15 s, and once more on leaving the chapter so the time since the last beat lands on the chapter it was spent
 * on. A reader left mounted under another tab or under paged mode stays quiet: it shares the session, so its beats
 * would move `last_beat_at` under the reader actually in use and credit a chapter nobody is looking at.
 * `mark()` is what the reader calls on touches and scrolls: it resets the idle clock, counts one signal per 4 s burst
 * and notes the chapter's end once `atEnd` says it is showing. `reachEnd()` notes it for what the scroll cannot see
 * (the voice finishing the chapter). A chapter is credited by the server once the end has been reached and the time
 * on it matches its length (`shared/reading.ts`); the client sends a beat the moment that looks true, so the read
 * mark does not wait for the next 15 s. A beat with no input in the last 60 s or with the app backgrounded earns
 * nothing. Each beat names the device's calendar date and UTC offset, so the time lands on the reader's own day.
 */
export function useActivity(book: number | undefined, chapter: number | undefined, source: ActivitySource) {
  const { user } = useAuth()
  const lastInput = useRef(Date.now())
  const signals = useRef(0)
  const lastSignal = useRef(0)
  const visible = useRef(AppState.currentState === 'active' || AppState.currentState === 'unknown')
  const src = useRef(source)
  src.current = source
  /** The chapter being read; kept across a blur and refocus of the same chapter. */
  const visit = useRef<Visit | null>(null)
  const soon = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendRef = useRef<(v: Visit) => void>(() => {})

  const isActive = () => Date.now() - lastInput.current < IDLE_MS
  /** A beat now if the rule already looks met, a timer if it will be within one beat. */
  const promptCredit = useCallback((v: Visit) => {
    if (v.prompted || visit.current !== v) return
    const ms = msToCredit(v, src.current.words, lastBeatAt, Date.now(), isActive() && visible.current)
    if (ms === null || ms >= BEAT_MS) return
    if (soon.current) clearTimeout(soon.current)
    soon.current = setTimeout(() => { soon.current = null; if (visit.current === v && !v.prompted) { v.prompted = true; sendRef.current(v) } }, ms + PROMPT_SLACK_MS)
  }, [])
  /** Reads the screen into the visit: the end, and the furthest progress. */
  const observe = useCallback((v: Visit) => {
    v.progress = Math.max(v.progress, Math.max(0, Math.min(1, src.current.getProgress())))
    const atEnd = src.current.atEnd(v.book, v.chapter)
    if (atEnd && !v.reached) { v.reached = true; v.prompted = false; promptCredit(v) }
    else if (!atEnd && v.reached) { v.reached = false; if (soon.current) { clearTimeout(soon.current); soon.current = null } }
  }, [promptCredit])

  const mark = useCallback(() => {
    const now = Date.now()
    lastInput.current = now
    if (now - lastSignal.current > SIGNAL_DEBOUNCE_MS) { signals.current++; lastSignal.current = now }
    if (visit.current) observe(visit.current)
  }, [observe])
  const reachEnd = useCallback((b: number, c: number) => {
    const v = visit.current
    if (!v || v.book !== b || v.chapter !== c || v.reached) return
    v.reached = true
    promptCredit(v)
  }, [promptCredit])

  const uid = user?.id
  // a fresh chapter counts as input
  useEffect(() => { lastInput.current = Date.now() }, [book, chapter])

  useFocusEffect(useCallback(() => {
    if (!book || !chapter) return
    const v = visit.current && visit.current.book === book && visit.current.chapter === chapter ? visit.current : newVisit(book, chapter)
    visit.current = v
    if (!uid) {
      // signed out: no beats, but the same rule judged on the device feeds the path's local read set (docs/PATHS.md rule 1)
      let last: number | null = null
      const judge = () => {
        observe(v)
        const now = Date.now()
        v.dwellMs += earned(last, now, isActive() && visible.current)
        last = now
        if (!v.credited && msToCredit(v, src.current.words, null, now, false) === 0) { v.credited = true; noteLocalRead(v.book, v.chapter) }
      }
      sendRef.current = judge
      const t = setInterval(judge, BEAT_MS)
      judge()
      return () => { clearInterval(t); if (soon.current) { clearTimeout(soon.current); soon.current = null }; judge() }
    }
    visible.current = AppState.currentState === 'active' || AppState.currentState === 'unknown'
    const sub = AppState.addEventListener('change', s => { visible.current = s === 'active' })
    const send = (sv: Visit) => {
      const t = new Date(), now = t.getTime(), active = isActive()
      sv.dwellMs += earned(lastBeatAt, now, active && visible.current)
      lastBeatAt = now
      const body = {
        local_date: localDay(t), tz_offset_min: tzOffsetMin(t), session_id: sessionId, book: sv.book, chapter: sv.chapter, progress: sv.progress,
        reached_end: sv.reached, signals: signals.current, active, visible: visible.current, device: Platform.OS === 'web' ? 'web' : 'mobile',
      }
      signals.current = 0
      queue = queue.then(() => post<BeatResult>('/activity/beat', body)).then(r => {
        if (r.credited && r.credited.book === sv.book && r.credited.chapter === sv.chapter) { sv.credited = true; noteLocalRead(sv.book, sv.chapter) }
        listeners.forEach(l => l(r))
      }, () => { /* offline: the next beat catches up (server credits max 20 s per beat) */ })
    }
    sendRef.current = send
    const tick = () => { observe(v); send(v); promptCredit(v) }
    const t = setInterval(tick, BEAT_MS)
    tick()
    return () => {
      clearInterval(t); sub.remove()
      if (soon.current) { clearTimeout(soon.current); soon.current = null }
      // the time since the last beat belongs to this chapter, and the end may have been reached since
      send(v)
    }
  }, [uid, book, chapter, observe, promptCredit]))

  return { mark, reachEnd }
}
