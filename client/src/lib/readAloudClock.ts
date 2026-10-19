import { AppRegistry, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import { createHold } from './readAloudHold'
import type { ExitInfo, Phone, Scene } from './readAloudLogCore'

/**
 * Android runs the app's timers only while it is on screen or a headless task is open. Read-aloud is timers (a verse's
 * end, the pause after it, the move to the next chapter), and so are the listening heartbeat and the network time
 * limits: with the screen locked, or Maps in front, the reading went silent at the next verse pause or at the chapter's
 * end, and picked up where it had stopped only when the phone was unlocked. So while a reading is on, the app holds one
 * headless task open (modules/read-aloud-clock). The web and iOS keep timers running behind playing audio.
 */
const TASK = 'ReadAloudClock'
interface Native {
  hold(task: string): boolean
  snapshot(): Phone
  exitReasons(max: number): ExitInfo[]
  watch(on: boolean): void
  addListener(event: 'onAudioScene', fn: (s: Scene) => void): { remove(): void }
}
const native = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('ReadAloudClock') : null
const hold = createHold(() => native?.hold(TASK) ?? false, (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) }, 30_000)

/** Registered at startup (index.ts), before Android can be asked for the task. */
export function registerReadAloudTask() { if (native) AppRegistry.registerHeadlessTask(TASK, () => hold.task) }

/** The player's status, on every change: a reading is on from loading until it goes idle or fails. */
export const keepClock = (reading: boolean) => hold.set(reading)

/** The phone's state for the read-aloud log (lib/readAloudLog.ts); null off Android. */
export function phoneNow(): Phone | null { try { return native?.snapshot() ?? null } catch { return null } }
/** Android's own records of the app's process ending, newest first (Android 11+). */
export function exitsNow(): ExitInfo[] { try { return native?.exitReasons(8) ?? [] } catch { return [] } }
/** Every change in what else sounds and where the sound goes, until the returned function is called. */
export function watchScene(fn: (s: Scene) => void): () => void {
  if (!native) return () => {}
  try {
    const sub = native.addListener('onAudioScene', fn)
    native.watch(true)
    return () => { sub.remove(); native.watch(false) }
  } catch { return () => {} }
}
