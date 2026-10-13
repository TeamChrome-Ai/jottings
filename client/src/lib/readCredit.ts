import { requiredSeconds } from '@shared/reading'

/** The server counts at most this much of the time between two beats (rs/src/activity.rs `MAX_BEAT_SECONDS`). */
export const MAX_BEAT_MS = 20_000

/** One stay on a chapter, as the client keeps it to know when the server will credit it. */
export interface Visit {
  book: number; chapter: number
  /** At the end right now (the last beat's truth); leaving the end clears it, and only a beat sent at the end credits. */
  reached: boolean
  /** Active time the server has been sent for this chapter, counted the way it counts it. */
  dwellMs: number
  /** Furthest scroll progress, for the beat that closes the visit (by then the screen shows another chapter). */
  progress: number
  /** A beat has been sent early because the rule looked met; one per visit. */
  prompted: boolean
  credited: boolean
}

export const newVisit = (book: number, chapter: number): Visit => ({ book, chapter, reached: false, dwellMs: 0, progress: 0, prompted: false, credited: false })

/** What a beat sent at `now` adds to the visit: the time since the previous beat, capped, when the reader was active.
 *  The server counts whole seconds between arrivals, so a 15 s beat can land as 14: the estimate takes a second off
 *  and never runs ahead of the server's tally. */
export function earned(lastBeatAt: number | null, now: number, active: boolean): number {
  if (!active || lastBeatAt === null || now <= lastBeatAt) return 0
  const ms = now - lastBeatAt
  return ms >= MAX_BEAT_MS + 1000 ? MAX_BEAT_MS : Math.max(0, Math.floor(ms / 1000) - 1) * 1000
}

/** Milliseconds until the visit meets the rule if the reader stays active (0: a beat now would credit it); null while the
 *  end has not been reached, the length is unknown, or it is already credited. */
export function msToCredit(v: Visit, words: number | undefined, lastBeatAt: number | null, now: number, active: boolean): number | null {
  if (!v.reached || v.credited || words === undefined) return null
  return Math.max(0, requiredSeconds(words) * 1000 - v.dwellMs - earned(lastBeatAt, now, active))
}
