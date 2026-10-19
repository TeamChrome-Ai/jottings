import AsyncStorage from '@react-native-async-storage/async-storage'
import { AppState, Platform } from 'react-native'
import Constants from 'expo-constants'
import { appVersionLabel, DIAGNOSTICS_MAX } from './feedback'
import { exitsNow, phoneNow, watchScene } from './readAloudClock'
import { interrupter, KEEP_MS, phoneWords, reportText, sceneKey, sceneWords, trimLog, troubles, type LogEvent, type Scene, type Trouble } from './readAloudLogCore'

/**
 * The read-aloud log: what the player did over the last two days, kept on the phone so that a reading that stopped by
 * itself (on a drive, with the screen off) can be traced. It never leaves the phone by itself: the reader sends it, from
 * the "Read aloud stopped" sheet (components/ReadAloudReport.tsx) or with feedback. Android only: the reports came from
 * Android, and only Android says why it closed the app.
 */
const ON = Platform.OS === 'android'
const KEY = 'readAloudLog'
const ASKED_KEY = 'readAloudLogAsked'
/** The reader is offered the report at most this often. */
const ASK_EVERY_MS = 3 * 24 * 3600_000
const TICK_MS = 15_000
/** A session (the phone noted, the scene watched) outlives the reading by this much, so the next chapter keeps it; less
 *  than the 30 s the read-aloud task is held past it (readAloudClock.ts), after which the timers stop with the screen off. */
const SESSION_GRACE_MS = 25_000

let events: LogEvent[] = []
let loaded: Promise<void> | null = null
let saving: ReturnType<typeof setTimeout> | null = null

// what was noted before the stored log came back goes after it
const load = () => loaded ??= AsyncStorage.getItem(KEY).then(s => { events = [...(s ? JSON.parse(s) as LogEvent[] : []), ...events] }).catch(() => {})
function save() {
  if (saving) return
  saving = setTimeout(() => {
    saving = null
    void load().then(() => { events = trimLog(events, Date.now()); return AsyncStorage.setItem(KEY, JSON.stringify(events)) }).catch(() => {})
  }, 2000)
}

export function note(e: string, d?: string, w?: string) {
  if (!ON) return
  events.push({ t: Date.now(), e, ...(d ? { d } : {}), ...(w ? { w } : {}) })
  save()
}

const appVersion = () => appVersionLabel(Constants.expoConfig?.version, Constants.expoConfig?.android?.versionCode)
/** At startup (index.ts): a launch after a reading that never stopped is how a closed app shows. */
export const noteLaunch = () => note('launch', appVersion())

type Describe = () => { w?: string; d: string; playing: boolean }
let describe: Describe | null = null
let on = false
let session: (() => void) | null = null
let ending: ReturnType<typeof setTimeout> | null = null
let recent: { t: number; s: Scene }[] = []

/** The player, on every change of its status: a session runs while a reading is on, and a little past it. */
export function watchReading(reading: boolean, what: Describe) {
  if (!ON) return
  describe = what
  on = reading
  // the log never stands in the reading's way: whatever the phone answers, nothing here throws into the player
  try {
    if (reading) {
      if (ending) { clearTimeout(ending); ending = null }
      session ??= begin()
    } else if (session && !ending) ending = setTimeout(() => { ending = null; try { session?.() } catch { /* already gone */ } session = null }, SESSION_GRACE_MS)
  } catch { /* no log this time */ }
}

function begin(): () => void {
  const phone = phoneNow()
  if (phone) note('phone', phoneWords(phone))
  let said = ''
  const unscene = watchScene(s => {
    recent = [...recent.filter(r => Date.now() - r.t < 10_000), { t: Date.now(), s }]
    // noted when something other than a media player changed: a call, a voice, where the sound goes, the volume
    try { const k = sceneKey(s); if (k !== said) { said = k; note('scene', sceneWords(s)) } } catch { /* an answer of a shape not known */ }
  })
  const app = AppState.addEventListener('change', s => note('app', s))
  let last = Date.now(), n = 0, wasOn = on
  const beat = () => {
    const now = Date.now()
    // a late tick counts only if a reading was on at the last one: past the reading, timers stopping is Android's due
    if (wasOn && now - last >= TICK_MS * 3) note('stall', String(Math.round((now - last) / 1000)))
    last = now; wasOn = on
    if (++n % 4 || !describe) return
    const x = describe()
    if (!x.playing) return
    const p = phoneNow()
    note('beat', `${x.d}${p?.screenOn != null ? ` · screen ${p.screenOn ? 'on' : 'off'}` : ''}${p?.volume != null ? ` · volume ${p.volume}/${p.volumeMax}` : ''}`, x.w)
  }
  const tick = setInterval(() => { try { beat() } catch { /* a beat missed */ } }, TICK_MS)
  return () => { clearInterval(tick); unscene(); app.remove(); recent = [] }
}

/** The player stopped by itself: a `cut` as well when a call or another voice sounded then or in the seconds before. */
export function noteStill(w: string | undefined, d: string) {
  if (!ON) return
  note('still', d, w)
  try {
    const why = interrupter(phoneNow()) ?? recent.filter(r => Date.now() - r.t < 10_000).map(r => interrupter(r.s)).find(Boolean)
    if (why) note('cut', why, w)
  } catch { /* the still is noted */ }
}

/** The text a reader may send (null when nothing was read aloud in the last two days, or off Android). */
export async function readAloudReport(): Promise<string | null> {
  if (!ON) return null
  await load()
  if (!events.some(x => x.e === 'start')) return null
  const now = Date.now(), exits = exitsNow()
  return reportText({ app: `${appVersion()} · ${Platform.OS}`, phone: phoneNow(), exits, events, troubles: troubles(events, exits, now), now, max: DIAGNOSTICS_MAX })
}

/** Something was read aloud in the last two days: the feedback sheet offers to add the log. */
export async function hasReadAloudLog(): Promise<boolean> {
  if (!ON) return false
  await load()
  return events.some(x => x.e === 'start' && x.t >= Date.now() - KEEP_MS)
}

/** The stops by itself since the reader was last offered the report; none within three days of that. */
export async function troublesToAsk(): Promise<Trouble[]> {
  if (!ON) return []
  await load()
  const asked = Number(await AsyncStorage.getItem(ASKED_KEY).catch(() => null)) || 0
  if (Date.now() - asked < ASK_EVERY_MS) return []
  return troubles(events, exitsNow(), Date.now()).filter(x => x.t > asked)
}

export function markAsked() {
  if (!ON) return
  note('asked')
  AsyncStorage.setItem(ASKED_KEY, String(Date.now())).catch(() => {})
}
