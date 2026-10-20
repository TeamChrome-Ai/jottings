import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { StreakInfo } from '@shared/types'
import { N_, t } from '@shared/i18n'
import { EMPTY_LOG, planReminders, readLog, summarizeStreak, type NudgeLog, type FireKind } from './reminderPlan'
import { localDay } from './localDay'

/**
 * Streak notifications, local only. The plan is a pure function of the pref, the latest streak and the monthly
 * log (`reminderPlan.ts`); this module applies it. Every input change (pref, sign-in, fresh stats, the app coming
 * forward) cancels what is pending and schedules the plan again. Native only: `streakReminder.web.ts` is inert.
 */

export type NotifyPermission = 'granted' | 'denied' | 'undetermined'
export interface ReminderConfig { enabled: boolean; hour: number; minute: number; signedIn: boolean }

/** The route a tap opens: the Read tab, which continues at the saved position. */
export const REMINDER_ROUTE = '/read'
// One Android channel per kind, so each can be switched off on its own in the system's notification settings.
const CHANNELS: Record<FireKind, { id: string; name: string; description: string }> = {
  daily: { id: 'streak-daily', name: N_('Daily streak reminder'), description: N_('The evening reminder on days you have not read yet.') },
  start: { id: 'streak-start', name: N_('Start a streak'), description: N_('A monthly invitation when no streak is running.') },
  lapse: { id: 'streak-lapse', name: N_('Streak paused'), description: N_('A note when a streak lapses, at most once a month.') },
}
const ID_PREFIX = 'streak-'
const LOG_KEY = 'berean_streak_nudges'

let config: ReminderConfig = { enabled: false, hour: 20, minute: 0, signedIn: false }
/** The latest streak; each apply judges it on the device's day at that moment (`summarizeStreak`). */
let latest: StreakInfo | null = null
let log: NudgeLog | null = null
/** The plan now on the device, so a heartbeat that changes nothing does not cancel and reschedule. */
let applied: string | null = null
let running: Promise<void> | null = null
let again = false

/** Fed by `publishStreak`: every /stats read and reader heartbeat. Null on sign-out. */
export function noteStreak(s: StreakInfo | null | undefined) {
  latest = s ?? null
  void reschedule()
}

/** The streak reminder is on and someone is signed in: other quiet notices (a friend's reaction) ride on the same choice. */
export const reminderAllowed = () => config.enabled && config.signedIn

export function configureReminder(c: ReminderConfig) {
  if (c.enabled === config.enabled && c.hour === config.hour && c.minute === config.minute && c.signedIn === config.signedIn) return
  config = c
  void reschedule()
}

/** Runs one apply at a time; calls that arrive meanwhile fold into one more pass with the newest inputs. */
export function reschedule(): Promise<void> {
  if (running) { again = true; return running }
  running = (async () => {
    do { again = false; await apply().catch(() => { applied = null }) } while (again)
  })().finally(() => { running = null })
  return running
}

async function apply() {
  if (!config.enabled || !config.signedIn) {
    if (applied !== '') { await cancelOurs(); applied = '' }
    return
  }
  if (!latest) return
  log ??= await loadLog()
  // today and yesterday are the device's calendar days, the same clock the reminder times are set on
  const now = new Date()
  const plan = planReminders({ now, enabled: true, hour: config.hour, minute: config.minute, streak: summarizeStreak(latest, localDay(now)), log })
  if (JSON.stringify(plan.log) !== JSON.stringify(log)) { log = plan.log; AsyncStorage.setItem(LOG_KEY, JSON.stringify(log)).catch(() => {}) }
  const key = JSON.stringify(plan.fires)
  if (key === applied) return
  await cancelOurs()
  await ensureChannel()
  for (const f of plan.fires) {
    await Notifications.scheduleNotificationAsync({
      identifier: `${ID_PREFIX}${f.kind}-${f.at.getTime()}`,
      content: { title: f.title, body: f.body, data: { url: REMINDER_ROUTE } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: f.at, channelId: CHANNELS[f.kind].id },
    })
  }
  applied = key
}

async function loadLog(): Promise<NudgeLog> {
  try { const raw = await AsyncStorage.getItem(LOG_KEY); return raw ? readLog(JSON.parse(raw)) : EMPTY_LOG } catch { return EMPTY_LOG }
}

/** Only this module's notifications: nothing else in the app schedules any today, but a cancel-all would not know. */
async function cancelOurs() {
  const all = await Notifications.getAllScheduledNotificationsAsync()
  await Promise.all(all.filter(n => n.identifier.startsWith(ID_PREFIX)).map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)))
}

/** Android 13 shows the permission prompt only once the app has a channel, so this runs before any request. */
async function ensureChannel() {
  if (Platform.OS !== 'android') return
  for (const ch of Object.values(CHANNELS)) await Notifications.setNotificationChannelAsync(ch.id, { name: t(ch.name), description: t(ch.description), importance: Notifications.AndroidImportance.DEFAULT })
}

export async function notifyPermission(): Promise<NotifyPermission> {
  try { return (await Notifications.getPermissionsAsync()).status as NotifyPermission } catch { return 'denied' }
}

/** Shows the system prompt when the answer is still open; resolves to where things stand afterwards. */
export async function askNotifyPermission(): Promise<NotifyPermission> {
  try {
    await ensureChannel()
    const now = await Notifications.getPermissionsAsync()
    if (now.status === 'granted' || !now.canAskAgain) return now.status as NotifyPermission
    return (await Notifications.requestPermissionsAsync()).status as NotifyPermission
  } catch { return 'denied' }
}
