import { describe, it, expect } from 'vitest'
import { CUT_MS, KEEP_MS, MAX_EVENTS, NEXT_MS, exitByUser, interrupter, reportText, sceneKey, sceneWords, trimLog, troubles, type ExitInfo, type LogEvent } from '../client/src/lib/readAloudLogCore'

const T0 = Date.UTC(2026, 9, 18, 20, 0, 0)
const min = 60_000
/** A log from (minute offset, event, detail, where) rows. */
const log = (...rows: [number, string, string?, string?][]): LogEvent[] => rows.map(([m, e, d, w]) => ({ t: T0 + m * min, e, ...(d ? { d } : {}), ...(w ? { w } : {}) }))
const exit = (m: number, reason: number, description?: string): ExitInfo => ({ t: T0 + m * min, reason, description })
const reading = log([0, 'launch'], [1, 'start', 'adam', 'Psalm 117:1'], [1, 'status', 'loading'], [1, 'status', 'playing'], [5, 'beat', '30.0 s, playing', 'Psalm 118:12'])

describe('the read-aloud log', () => {
  it('keeps two days, and no more than its cap', () => {
    const now = T0 + KEEP_MS + 10 * min
    const kept = trimLog(log([0, 'launch'], [20, 'start'], [KEEP_MS / min + 5, 'beat']), now)
    expect(kept.map(x => x.e)).toEqual(['start', 'beat'])
    const many = Array.from({ length: MAX_EVENTS + 50 }, (_, i) => ({ t: now - i, e: 'beat' }))
    expect(trimLog(many, now)).toHaveLength(MAX_EVENTS)
  })
})

describe('a reading that stopped by itself', () => {
  it('is Android closing the app while it read, with Android’s own reason and the verse it was on', () => {
    const t = troubles([...reading, ...log([90, 'launch'])], [exit(7, 3, 'lmkd')], T0 + 91 * min)
    expect(t).toHaveLength(1)
    expect(t[0]).toMatchObject({ kind: 'closed', w: 'Psalm 118:12', t: T0 + 7 * min })
    expect(t[0].what).toContain('low memory')
  })

  it('is not the reader closing it: swiped away, force-stopped, or the app updated', () => {
    for (const x of [exit(7, 13, 'remove task'), exit(7, 10), exit(7, 11), exit(7, 16)]) {
      expect(exitByUser(x)).toBe(true)
      expect(troubles([...reading, ...log([90, 'launch'])], [x], T0 + 91 * min)).toEqual([])
    }
  })

  it('is decided by the first exit after the reading, not a later one: Android lists them newest first', () => {
    // report #19 (1.2.0, Pixel 8): swiped away 5 s into Matthew 19, then the app's process, started again in the
    // background, killed twice for memory while cached; the newest exit was blamed and the reader told Android did it
    const exits = [{ ...exit(140, 3, 'lmkd'), importance: 400 }, { ...exit(60, 3), importance: 400 }, exit(5.1, 13, 'remove task')]
    expect(troubles([...reading, ...log([370, 'launch'])], exits, T0 + 371 * min)).toEqual([])
    // and the other way round: Android's kill first, the reader's swipe on a later process
    const t = troubles([...reading, ...log([370, 'launch'])], [exit(140, 13, 'remove task'), { ...exit(5.5, 3, 'lmkd'), importance: 125 }], T0 + 371 * min)
    expect(t.map(x => [x.kind, x.t, x.what])).toEqual([['closed', T0 + 5.5 * min, 'Android closed the app while it read (low memory (lmkd) · playing)']])
  })

  it('needs Android’s record: without one (before Android 11) a launch says nothing', () => {
    expect(troubles([...reading, ...log([90, 'launch'])], [], T0 + 91 * min)).toEqual([])
  })

  it('is not a launch after the reading had stopped, or an exit from another day', () => {
    expect(troubles([...reading, ...log([6, 'stop'], [6, 'status', 'idle'], [90, 'launch'])], [exit(30, 3)], T0 + 91 * min)).toEqual([])
    expect(troubles([...reading, ...log([90, 'launch'])], [exit(-600, 3)], T0 + 91 * min)).toEqual([])
  })

  it('is an interruption that never gave the voice back; not one it went on after', () => {
    const cut = [...reading, ...log([6, 'still', '31.2 s, ready', 'Psalm 118:13'], [6, 'cut', 'a call', 'Psalm 118:13'])]
    expect(troubles([...cut, ...log([9, 'resume'])], [], T0 + 20 * min)).toEqual([])
    const pressed = troubles([...cut, ...log([20, 'play'])], [], T0 + 21 * min)
    expect(pressed).toMatchObject([{ kind: 'interrupted', w: 'Psalm 118:13' }])
    expect(pressed[0].what).toContain('a call')
    expect(troubles(cut, [], T0 + 6 * min + CUT_MS + 1)).toHaveLength(1)
    expect(troubles(cut, [], T0 + 6 * min + CUT_MS - 1)).toEqual([])
  })

  it('is not the player stopping with nothing else sounding: the lock screen’s pause looks the same', () => {
    expect(troubles([...reading, ...log([6, 'still', '31.2 s, ready'], [30, 'play'])], [], T0 + 31 * min)).toEqual([])
  })

  it('is a next chapter asked for that never started', () => {
    const ended = [...reading, ...log([8, 'end', undefined, 'Psalm 118'], [8, 'status', 'idle'], [8, 'next', undefined, 'Psalm 119'])]
    expect(troubles([...ended, ...log([8.1, 'start', 'adam', 'Psalm 119:1'])], [], T0 + 30 * min)).toEqual([])
    const t = troubles(ended, [], T0 + 8 * min + NEXT_MS + 1)
    expect(t).toMatchObject([{ kind: 'no-next', w: 'Psalm 119' }])
    expect(troubles([...ended, ...log([20, 'app', 'active'])], [], T0 + 20 * min)).toHaveLength(1)
    // closed in the hand-over: Android's record says so, and the lost hand-over is not counted twice
    expect(troubles([...ended, ...log([30, 'launch'])], [exit(8.05, 2)], T0 + 31 * min).map(x => x.kind)).toEqual(['closed'])
  })

  it('is a failure, or the app’s timers standing still for a minute or more', () => {
    const t = troubles([...reading, ...log([6, 'error', 'device voice failed', 'Psalm 118:14'], [7, 'stall', '45'], [8, 'stall', '75'])], [], T0 + 9 * min)
    expect(t.map(x => x.kind)).toEqual(['error', 'stalled'])
    expect(t[1].what).toContain('75 s')
  })

  it('is not the timers standing still while paused: the reader paused for an appointment', () => {
    const paused = [...reading, ...log([6, 'pause', undefined, 'John 1:18'], [6, 'status', 'paused'], [7, 'app', 'background'], [136, 'stall', '7766'])]
    expect(troubles(paused, [], T0 + 140 * min)).toEqual([])
    // played again, the timers standing still count once more
    expect(troubles([...paused, ...log([150, 'play'], [150, 'status', 'playing'], [160, 'stall', '90'])], [], T0 + 161 * min).map(x => x.kind)).toEqual(['stalled'])
  })
})

describe('what else is sounding', () => {
  it('names what takes the sound: a call, a ringtone, a navigation voice; not media, ours included', () => {
    expect(interrupter({ mode: 2 })).toBe('a call')
    expect(interrupter({ mode: 3 })).toBe('a call')
    expect(interrupter({ mode: 1 })).toBe('a ringtone')
    expect(interrupter({ mode: 0, playing: ['1:started', '12:started'] })).toBe('a navigation voice')
    expect(interrupter({ mode: 0, playing: ['1:started', '12:paused'] })).toBeNull()
    expect(interrupter({ mode: 0, playing: ['5:'] })).toBe('a notification')
    expect(interrupter({ mode: 0, playing: ['1:started', '1:paused'] })).toBeNull()
    expect(interrupter(null)).toBeNull()
  })

  it('is the same scene while only media players start and stop: our own player does at every verse', () => {
    const at = (playing: string[], more: object = {}) => sceneKey({ mode: 0, playing, outputs: [2], volume: 5, volumeMax: 15, ...more })
    expect(at(['1:started'])).toBe(at([]))
    expect(at(['1:paused', '14:started'])).toBe(at([]))
    expect(at(['1:started', '12:started'])).not.toBe(at(['1:started']))
    expect(at([], { mode: 2 })).not.toBe(at([]))
    expect(at([], { outputs: [8] })).not.toBe(at([]))
    expect(at([], { volume: 9 })).not.toBe(at([]))
  })

  it('says where the sound goes in words', () => {
    expect(sceneWords({ mode: 0, playing: ['1:started'], outputs: [1, 2, 8], volume: 7, volumeMax: 15 })).toBe('players: media started · sound to bluetooth · volume 7/15')
    expect(sceneWords({ mode: 2, playing: [], outputs: [2] })).toBe('in a call · no players · sound to the phone')
  })
})

describe('the report', () => {
  const phone = { maker: 'samsung', model: 'SM-S918B', release: '14', sdk: 34, unrestricted: false, bucket: 10, screenOn: false, mode: 0, playing: [], outputs: [2], volume: 9, volumeMax: 15 }
  it('leads with the phone, the stops and Android’s records, then the events oldest first', () => {
    const events = [...reading, ...log([90, 'launch'])]
    const exits = [exit(7, 3, 'lmkd')]
    const text = reportText({ app: '1.2.0 (57) · android', phone, exits, events, troubles: troubles(events, exits, T0 + 91 * min), now: T0 + 91 * min, max: 24_000 })
    const lines = text.split('\n')
    expect(lines[0]).toMatch(/^Read-aloud log · 1\.2\.0 \(57\) · android · times are the phone's \(UTC[+-]\d\d:\d\d\)$/)
    expect(lines[1]).toBe('Phone: samsung SM-S918B, Android 14 (SDK 34) · battery: optimised · standby: active · screen off')
    expect(text).toContain('Android closed the app while it read (low memory (lmkd))')
    expect(text).toContain('Android ended the app (its own record):')
    const at = lines.indexOf('Events, oldest first:')
    expect(lines.slice(at + 1).map(l => l.split(' ')[2])).toEqual(['launch', 'start', 'status', 'status', 'beat', 'launch'])
  })

  it('keeps the newest events when the log is longer than the room, and says how many it left out', () => {
    const events = Array.from({ length: 2000 }, (_, i) => ({ t: T0 + i * 1000, e: 'beat', d: `${i} s, playing · app background`, w: 'Psalm 119:1' }))
    const text = reportText({ app: 'x', phone: null, exits: [], events, troubles: [], now: T0 + 2000 * 1000, max: 24_000 })
    expect(text.length).toBeLessThanOrEqual(24_000)
    expect(text).toContain('1999 s, playing')
    expect(text).not.toContain(' 0 s, playing')
    expect(text).toMatch(/\(\d+ earlier events left out\)/)
  })
})
