import AsyncStorage from '@react-native-async-storage/async-storage'
import * as SecureStore from 'expo-secure-store'
import * as BackgroundTask from 'expo-background-task'
import * as TaskManager from 'expo-task-manager'
import { fetchWithTimeout, getApiBase, loadApiBase } from './api'
import { checkInvitesOnce } from './inviteMark'
import { notifyAllowed, postInviteNotices } from './inviteNotify'
import type { IncomingReply } from './inviteNoticePlan'
import { topUpVerseNotify } from './verseNotify'
import { readVerseNotify } from './verseNotifyPlan'

/**
 * The background check for friend invites, with no push service: Android's WorkManager wakes the app about every 15
 * minutes (the shortest it allows, and only with a network; Doze stretches it) and this asks the server for invites
 * newer than the device's mark, posting one notification each. The same wake-up tops up the verse-of-the-day queue
 * (`verseNotify.ts`), so the task stays registered while any verse item is set too. Defined from the entry file
 * (`index.ts`) so the task exists when Android starts the app headless; registered by `useInviteNotice` while someone
 * is signed in with "Notify me of friend invites" on or a verse notification is set, unregistered otherwise. Native only: `inviteTask.web.ts` is inert.
 *
 * It reads only what the app left on the device: the prefs record, the session token and the user. Nothing goes over
 * the network when signed out, with the switch off, or with notifications not allowed. An expired session (401) ends
 * the run quietly; the app signs out when it next opens.
 */
export const INVITE_TASK = 'jottings-friend-invites'
/** Minutes; WorkManager's floor. */
const INTERVAL = 15
// the app's own keys: store/prefs.tsx, store/auth.tsx
const PREFS_KEY = 'berean_prefs'
const TOKEN_KEY = 'berean_token'
const USER_KEY = 'berean_user'

const parse = (raw: string | null): unknown => { try { return raw ? JSON.parse(raw) : null } catch { return null } }

export function defineInviteTask() {
  if (TaskManager.isTaskDefined(INVITE_TASK)) return
  TaskManager.defineTask(INVITE_TASK, async () => {
    try { await backgroundCheck() } catch { /* a missed check is caught up by the next one */ }
    return BackgroundTask.BackgroundTaskResult.Success
  })
}

/** Keeps the registration in step with sign-in and the switch. */
export async function syncInviteTask(on: boolean) {
  const registered = await TaskManager.isTaskRegisteredAsync(INVITE_TASK)
  if (on && !registered) await BackgroundTask.registerTaskAsync(INVITE_TASK, { minimumInterval: INTERVAL })
  else if (!on && registered) await BackgroundTask.unregisterTaskAsync(INVITE_TASK)
}

export async function backgroundCheck() {
  const [[, prefsRaw], [, userRaw]] = await AsyncStorage.multiGet([PREFS_KEY, USER_KEY])
  const prefs = parse(prefsRaw) as { inviteNotify?: unknown; verseNotify?: unknown } | null
  const verseOn = readVerseNotify(prefs?.verseNotify).items.length > 0
  if (verseOn) await topUpVerseNotify().catch(() => {})
  if (prefs?.inviteNotify === false) { if (!verseOn) await syncInviteTask(false).catch(() => {}); return }
  const uid = (parse(userRaw) as { id?: unknown } | null)?.id
  const token = await SecureStore.getItemAsync(TOKEN_KEY).catch(() => null)
  if (!token || typeof uid !== 'number') return
  if (!(await notifyAllowed())) return
  await loadApiBase()
  const { fresh } = await checkInvitesOnce(uid, async path => {
    const res = await fetchWithTimeout(`${getApiBase()}/api${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } })
    if (!res.ok) throw new Error(String(res.status))
    return await res.json() as IncomingReply
  })
  await postInviteNotices(fresh)
}
