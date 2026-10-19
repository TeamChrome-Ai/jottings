/**
 * One headless task held open while a reading is on, so Android keeps the app's timers running with the screen off
 * (lib/readAloudClock.ts says why). The opener and the timer are passed in, so this is tested without a phone.
 *
 * The task is let go a while after the reading stops, not at once: a finished chapter moves on by the reader opening
 * the next one and starting it there, and that hand-over (a navigation, a fetch with a time limit) needs the timers.
 */
export interface Hold {
  /** The task Android runs: open while the reading is, settled at once if the reading ended before it got here. */
  task: () => Promise<void>
  /** Called on every change of the player's status: true from loading until it goes idle or fails. */
  set: (reading: boolean) => void
  readonly held: boolean
}

export function createHold(open: () => boolean, after: (fn: () => void, ms: number) => () => void, graceMs: number): Hold {
  let held: Promise<void> | null = null
  let release: (() => void) | null = null
  let cancel: (() => void) | null = null
  const letGo = () => { cancel = null; const r = release; held = null; release = null; r?.() }
  return {
    task: () => held ?? Promise.resolve(),
    set(reading) {
      if (reading) {
        cancel?.(); cancel = null
        if (held) return
        held = new Promise<void>(r => { release = r })
        if (!open()) { held = null; release = null }
      } else if (held && !cancel) cancel = after(letGo, graceMs)
    },
    get held() { return held !== null },
  }
}
