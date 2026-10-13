import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { nextPortion, readSetOf, type PathAccount } from '@shared/paths'
import { getApiBase } from './api'
import { bundledChapter } from './bundledBible'
import { localPathNext, peekPathNext } from './paths'
import { PATH_BOOK, VERSE_NOTIFY_MIN_DAYS, VERSE_NOTIFY_PREFIX, needsTopUp, readVerseNotify, verseNotices, type PathNext, type VerseNotifyPref } from './verseNotifyPlan'

/**
 * The morning verses as notifications, local only (no server, no push): at each refresh the next 14 mornings of every
 * item (a book, or any book, at a time) are scheduled as date triggers, each carrying its own day's reference and text
 * (`verseNotifyPlan.ts`), so the content is right without the app running. A repeating trigger could not do that:
 * the verse changes daily. Refreshed on app start, on the app coming forward and by the background task
 * (`inviteTask.ts`, which tops the queue up when fewer than 7 mornings remain). Native only: `verseNotify.web.ts`
 * is inert.
 */

export type VerseNotifyConfig = VerseNotifyPref
const CHANNEL = { id: 'verse-of-the-day', name: 'Verse of the day', description: 'A verse each morning.' }
const PREFS_KEY = 'berean_prefs'

let config: VerseNotifyConfig | null = null
/** The plan on the device, so a foreground that changes nothing does not cancel and schedule again. */
let applied: string | null = null
let running: Promise<void> | null = null
let again = false
let logged = false

export function configureVerseNotify(c: VerseNotifyConfig) {
  if (config && JSON.stringify(c.items) === JSON.stringify(config.items)) return
  config = c
  void rescheduleVerseNotify()
}

/** One apply at a time; calls that arrive meanwhile fold into one more pass with the newest inputs. */
export function rescheduleVerseNotify(): Promise<void> {
  if (running) { again = true; return running }
  running = (async () => {
    do { again = false; await apply().catch(() => { applied = null }) } while (again)
  })().finally(() => { running = null })
  return running
}

async function apply() {
  if (!config) return
  if (!config.items.length) {
    if (applied !== '') { await cancelOurs(); applied = '' }
    return
  }
  if ((await Notifications.getPermissionsAsync()).status !== 'granted') return
  const path = config.items.some(it => it.book === PATH_BOOK) ? await pathNext() : null
  if (path === undefined) return   // the path is unknown here: what is scheduled stands until the app can say
  const notices = verseNotices(new Date(), config.items, bundledChapter, undefined, path)
  // the path item keeps its identifiers from morning to morning while its chapter moves on: the title is part of the key
  const key = JSON.stringify(notices.map(n => [n.identifier, n.title]))
  if (key === applied) return
  await cancelOurs()
  await ensureChannel()
  for (const n of notices) {
    await Notifications.scheduleNotificationAsync({
      identifier: n.identifier,
      content: { title: n.title, body: n.body, data: { url: n.url } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: n.at, channelId: CHANNEL.id },
    })
  }
  applied = key
  if (__DEV__ && !logged) {
    logged = true
    const all = await Notifications.getAllScheduledNotificationsAsync()
    console.log('[verseNotify] scheduled', all.filter(n => n.identifier.startsWith(VERSE_NOTIFY_PREFIX)).map(n => `${n.identifier} ${n.content.title}`))
  }
}

/**
 * The background task's entry: reads the pref the app left on the device, and rebuilds the queue only when fewer than
 * 7 mornings are still ahead. Nothing happens with no items or notifications not allowed.
 */
export async function topUpVerseNotify() {
  const pref = await readPref()
  if (!pref) return
  if (!pref.items.length) { await cancelOurs(); return }
  if ((await Notifications.getPermissionsAsync()).status !== 'granted') return
  const all = await Notifications.getAllScheduledNotificationsAsync()
  const ours = all.filter(n => n.identifier.startsWith(VERSE_NOTIFY_PREFIX))
  const times = ours.map(n => { const t = n.trigger as { value?: unknown; date?: unknown } | null; const v = t?.value ?? t?.date; return typeof v === 'number' ? v : v instanceof Date ? v.getTime() : Number(n.identifier.split('-').pop()) })
  if (!needsTopUp(times, new Date(), VERSE_NOTIFY_MIN_DAYS)) return
  config = pref
  applied = null
  await rescheduleVerseNotify()
}

/**
 * The path and its next portion for the path item: the app's store when it has loaded (the reader's credits land there
 * at once); otherwise (the background task) the account's from the server with the session token the app left, or the
 * device's own path signed out. Undefined when it cannot be known (the server unreachable): nothing is rescheduled.
 */
async function pathNext(): Promise<PathNext | undefined> {
  const live = peekPathNext()
  if (live !== undefined) return live
  const token = await SecureStore.getItemAsync('berean_token').catch(() => null)
  if (!token) return localPathNext()
  try {
    const res = await fetch(`${getApiBase()}/api/me/path`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } })
    if (!res.ok) return undefined
    const acc = await res.json() as PathAccount
    return acc.path ? { path: acc.path, next: nextPortion(acc.path, readSetOf(acc.read))?.portion ?? null } : null
  } catch { return undefined }
}

/** The stored pref as `store/prefs.tsx` writes it, in either shape it has had; unreadable storage means nothing to do. */
async function readPref(): Promise<VerseNotifyConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY)
    const p = raw ? JSON.parse(raw) as { verseNotify?: unknown } : null
    return readVerseNotify(p?.verseNotify)
  } catch { return null }
}

/** Only this feature's notifications; the streak reminder and the invites keep theirs. */
async function cancelOurs() {
  const all = await Notifications.getAllScheduledNotificationsAsync()
  await Promise.all(all.filter(n => n.identifier.startsWith(VERSE_NOTIFY_PREFIX)).map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)))
}

async function ensureChannel() {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(CHANNEL.id, { name: CHANNEL.name, description: CHANNEL.description, importance: Notifications.AndroidImportance.DEFAULT })
}
