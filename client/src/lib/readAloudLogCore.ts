import { BOOKS } from '@shared/books'

/**
 * The read-aloud log's pure parts (lib/readAloudLog.ts keeps it on the phone): what is kept, what counts as the reading
 * having stopped by itself, and the text a reader may choose to send with feedback. Nothing here leaves the phone on its
 * own.
 *
 * The events, by name (`w` is where the reading was, "Psalm 118:12"):
 * - `launch` the app's process started; `app` it came to the front or went behind
 * - `status` the player's status; `start` Listen, with the settings; `load` how the recording came (whole or streamed)
 * - `phone` the phone's state as a reading starts; `scene` what else sounds and where the sound goes, on each change
 * - `beat` once a minute while the voice plays; `stall` the log's 15 s clock came round late (the app's timers stopped)
 * - `still` the player stopped by itself; `cut` it did so while something else sounded (a call, a navigation voice);
 *   `resume` it went on by itself, or by a Play from outside the app (the lock screen, the car)
 * - `play`, `pause`, `stop`, `jump` pressed in the app; `lost` the recording stopped coming; `recover` what took over
 * - `end` a chapter finished; `next` the reader asked for the next one; `no-next` it did not move on, and why
 * - `error` the reading failed; `asked` the reader was offered the report
 */
export interface LogEvent { t: number; e: string; d?: string; w?: string }

/** "Psalm 118:12" for the log; never throws, so a log line can never stop a reading. */
export const place = (book: number, chapter: number, v?: number) => `${BOOKS[book - 1]?.name ?? `book ${book}`} ${chapter}${v ? `:${v}` : ''}`
/** One of Android's records of the app's process ending (ActivityManager.getHistoricalProcessExitReasons). */
export interface ExitInfo { t: number; reason: number; importance?: number; status?: number; description?: string | null }
/** What else sounds ("usage:state" per player), where the sound can go, and the media volume. */
export interface Scene { mode?: number; playing?: string[]; outputs?: number[]; volume?: number; volumeMax?: number }
export interface Phone extends Scene {
  sdk?: number; release?: string; maker?: string; model?: string
  unrestricted?: boolean | null; powerSave?: boolean | null; dozing?: boolean | null; screenOn?: boolean | null
  backgroundRestricted?: boolean | null; bucket?: number | null
}
export type TroubleKind = 'closed' | 'error' | 'stalled' | 'interrupted' | 'no-next'
/** A time the reading stopped and nobody in the app had asked it to. */
export interface Trouble { t: number; kind: TroubleKind; w?: string; what: string }

export const KEEP_MS = 48 * 3600_000
export const MAX_EVENTS = 1500
/** The next chapter is asked for at a chapter's end; this long without it starting is a hand-over that failed. */
export const NEXT_MS = 90_000
/** A gap this long in the log's 15 s clock while a reading is on: the app's timers stood still. */
export const STALL_MS = 60_000
/** A pause by an interruption that has not gone on after this long, with nothing pressed since, is reported. */
export const CUT_MS = 60_000

export function trimLog(events: LogEvent[], now: number): LogEvent[] {
  const kept = events.filter(x => x.t >= now - KEEP_MS)
  return kept.length > MAX_EVENTS ? kept.slice(-MAX_EVENTS) : kept
}

const EXIT_REASONS: Record<number, string> = {
  0: 'unknown', 1: 'the app ended itself', 2: 'killed by a signal', 3: 'low memory', 4: 'crash', 5: 'native crash', 6: 'not responding',
  7: 'failed to start', 8: 'a permission changed', 9: 'too much battery or memory', 10: 'stopped by the user', 11: 'stopped by the user',
  12: 'a dependency died', 13: 'other', 14: 'frozen', 15: 'the app was disabled', 16: 'the app was updated',
}
export const exitWords = (x: ExitInfo) => `${EXIT_REASONS[x.reason] ?? `reason ${x.reason}`}${x.description ? ` (${x.description})` : ''}`
/** Closed on purpose: force-stopped, swiped away from the recent apps ("remove task"), or updated. */
export const exitByUser = (x: ExitInfo) => x.reason === 10 || x.reason === 11 || x.reason === 16 || /remove task/i.test(x.description ?? '')

const USAGE: Record<number, string> = {
  0: 'unknown', 1: 'media', 2: 'a call', 3: 'a call', 4: 'an alarm', 5: 'a notification', 6: 'a ringtone', 7: 'a notification', 8: 'a notification',
  9: 'a notification', 10: 'a notification', 11: 'accessibility', 12: 'a navigation voice', 13: 'a system sound', 14: 'a game', 16: 'the assistant', 17: 'a call',
}
const MODE: Record<number, string> = { 1: 'ringing', 2: 'in a call', 3: 'in a call (internet)', 4: 'screening a call', 5: 'in a call', 6: 'in a call' }
const OUTPUT: Record<number, string> = {
  3: 'wired headset', 4: 'wired headphones', 5: 'line out', 7: 'bluetooth (call)', 8: 'bluetooth', 9: 'HDMI', 11: 'USB', 12: 'USB',
  13: 'dock', 19: 'aux', 21: 'car', 22: 'USB headset', 23: 'hearing aid', 26: 'bluetooth LE', 27: 'bluetooth LE speaker', 30: 'bluetooth LE',
}
const BUCKET: Record<number, string> = { 5: 'exempt', 10: 'active', 20: 'working set', 30: 'frequent', 40: 'rare', 45: 'restricted', 50: 'never' }

/** What in the scene would take the sound from read-aloud: a call, a ringtone, a navigation voice; null for nothing. */
export function interrupter(s: Scene | null | undefined): string | null {
  if (!s) return null
  if (s.mode && MODE[s.mode]) return s.mode === 1 ? 'a ringtone' : 'a call'
  for (const p of s.playing ?? []) {
    const [u, state] = p.split(':')
    const usage = Number(u)
    if (usage === 0 || usage === 1 || usage === 14) continue
    if (!state || state === 'started') return USAGE[usage] ?? `sound of usage ${usage}`
  }
  return null
}

export function sceneWords(s: Scene): string {
  const parts: string[] = []
  if (s.mode && MODE[s.mode]) parts.push(MODE[s.mode])
  const playing = (s.playing ?? []).map(p => { const [u, state] = p.split(':'); return `${USAGE[Number(u)] ?? `usage ${u}`}${state ? ` ${state}` : ''}` })
  parts.push(playing.length ? `players: ${playing.join(', ')}` : 'no players')
  const outs = [...new Set((s.outputs ?? []).map(o => OUTPUT[o]).filter(Boolean))]
  parts.push(`sound to ${outs.length ? outs.join(', ') : 'the phone'}`)
  if (s.volume !== undefined) parts.push(`volume ${s.volume}/${s.volumeMax ?? '?'}`)
  return parts.join(' · ')
}

/** A scene as the log compares it: media players left out, as `interrupter` leaves them. Our own player starts and
 *  stops at every verse (Psalm 119 would fill a fifth of the log), and a media player never takes the sound. */
export const sceneKey = (s: Scene) => sceneWords({ ...s, playing: (s.playing ?? []).filter(p => ![0, 1, 14].includes(Number(p.split(':')[0]))) })

export function phoneWords(p: Phone): string {
  const parts = [`${p.maker ?? '?'} ${p.model ?? '?'}, Android ${p.release ?? '?'} (SDK ${p.sdk ?? '?'})`]
  parts.push(p.unrestricted ? 'battery: unrestricted' : p.unrestricted === false ? 'battery: optimised' : 'battery: ?')
  if (p.backgroundRestricted) parts.push('background use restricted')
  if (p.powerSave) parts.push('battery saver on')
  if (p.dozing) parts.push('dozing')
  if (p.bucket != null) parts.push(`standby: ${BUCKET[p.bucket] ?? p.bucket}`)
  if (p.screenOn != null) parts.push(p.screenOn ? 'screen on' : 'screen off')
  return parts.join(' · ')
}

/**
 * The times the reading stopped and nobody in the app had asked it to, oldest first:
 * - `closed` Android ended the app while it read (its own record says why; a swipe or a force stop is not counted)
 * - `error` the reading failed
 * - `stalled` the app's timers stood still for a minute or more while it read
 * - `interrupted` a call or another voice took the sound, and the reading did not go on by itself afterwards
 * - `no-next` a chapter ended, the next was asked for, and it never started
 * A pause from the lock screen or the car looks the same to the app as a stop by itself, so a `still` alone is logged and
 * not counted.
 */
export function troubles(events: LogEvent[], exits: ExitInfo[], now: number): Trouble[] {
  const out: Trouble[] = []
  let reading = false
  let where: string | undefined
  let last: LogEvent | undefined
  let cut: LogEvent | null = null
  let handoff: LogEvent | null = null
  const cutStays = () => {
    if (cut) out.push({ t: cut.t, kind: 'interrupted', w: cut.w, what: `the voice stopped for ${cut.d ?? 'another sound'} and did not go on by itself` })
    cut = null
  }
  const lostHandoff = () => {
    if (handoff) out.push({ t: handoff.t, kind: 'no-next', w: handoff.w, what: `the next chapter (${handoff.w ?? '?'}) was asked for and never started` })
    handoff = null
  }
  for (const x of events) {
    if (handoff && x.e !== 'launch' && x.t - handoff.t > NEXT_MS) lostHandoff()
    switch (x.e) {
      case 'launch': {
        const before = last
        // reading, or between a chapter's end and the next one starting: Android's record says whether it closed the app
        // (a hand-over it did not close and nobody else did either is lost)
        const exit = before && (reading || handoff) ? exits.find(z => z.t >= before.t - 5000 && z.t <= x.t) : undefined
        if (exit && !exitByUser(exit)) out.push({ t: exit.t, kind: 'closed', w: where, what: `Android closed the app while it read (${exitWords(exit)})` })
        else if (!exit && handoff && x.t - handoff.t > NEXT_MS) lostHandoff()
        cut = null; handoff = null; reading = false
        break
      }
      case 'status': reading = x.d === 'loading' || x.d === 'playing'; break
      case 'cut': cut = x; break
      case 'resume': cut = null; break
      case 'play': case 'stop': case 'start': case 'jump': cutStays(); break
      case 'next': handoff = x; break
      case 'error': out.push({ t: x.t, kind: 'error', w: x.w ?? where, what: `read aloud failed (${x.d ?? 'no reason given'})` }); break
      case 'stall': if (Number(x.d) * 1000 >= STALL_MS) out.push({ t: x.t, kind: 'stalled', w: where, what: `the app's timers stood still for ${x.d} s while it read` }); break
    }
    if (x.e === 'start') handoff = null
    if (x.w && x.e !== 'next') where = x.w
    last = x
  }
  if (handoff && now - (handoff as LogEvent).t > NEXT_MS) lostHandoff()
  if (cut && now - (cut as LogEvent).t > CUT_MS) cutStays()
  return out.sort((a, b) => a.t - b.t)
}

const two = (n: number) => String(n).padStart(2, '0')
/** "10-18 21:40:12", the phone's own time. */
export function stamp(t: number): string {
  const d = new Date(t)
  return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
/** "UTC-04:00": the offset the stamps are in. */
export function utcOffset(t: number): string {
  const m = -new Date(t).getTimezoneOffset()
  return `UTC${m < 0 ? '-' : '+'}${two(Math.floor(Math.abs(m) / 60))}:${two(Math.abs(m) % 60)}`
}
export const eventLine = (x: LogEvent) => `${stamp(x.t)} ${x.e}${x.w ? ` ${x.w}` : ''}${x.d ? ` · ${x.d}` : ''}`

/**
 * The text sent with feedback, at most `max` characters: the app and phone, the stops, Android's records of ending the
 * app, then as many of the newest events as fit, oldest first.
 */
export function reportText(r: { app: string; phone: Phone | null; exits: ExitInfo[]; events: LogEvent[]; troubles: Trouble[]; now: number; max: number }): string {
  const head = [`Read-aloud log · ${r.app} · times are the phone's (${utcOffset(r.now)})`]
  if (r.phone) head.push(`Phone: ${phoneWords(r.phone)}`)
  if (r.phone) head.push(`Now: ${sceneWords(r.phone)}`)
  head.push(r.troubles.length ? 'Stopped by itself:' : 'Stopped by itself: nothing the app could tell')
  for (const x of r.troubles) head.push(`  ${stamp(x.t)}${x.w ? ` ${x.w}` : ''} · ${x.what}`)
  const exits = r.exits.filter(x => x.t >= r.now - KEEP_MS)
  if (exits.length) {
    head.push('Android ended the app (its own record):')
    for (const x of exits) head.push(`  ${stamp(x.t)} ${exitWords(x)}`)
  }
  head.push('Events, oldest first:')
  let text = head.join('\n')
  const lines: string[] = []
  let size = text.length
  for (let i = r.events.length - 1; i >= 0; i--) {
    const line = `\n${eventLine(r.events[i])}`
    // room kept for the line that says how many were left out
    if (size + line.length > r.max - 60) { lines.push(`\n(${i + 1} earlier events left out)`); break }
    lines.push(line)
    size += line.length
  }
  text += lines.reverse().join('')
  return text.slice(0, r.max)
}
