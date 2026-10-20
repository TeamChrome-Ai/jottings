import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { N_, t } from '@shared/i18n'
import { planNotices, type InviteLite } from './inviteNoticePlan'

/**
 * Posts friend-invite notices on a channel of their own ("Friend invites"), so Android's notification settings can
 * turn them off apart from the streak reminders and reactions. Used by the app (the invite arrived while it was in the
 * background) and by the background check (`inviteTask.ts`). Native only; `inviteNotify.web.ts` is inert.
 */
export const INVITES_ROUTE = '/friends'
const CHANNEL = { id: 'friend-invites', name: N_('Friend invites'), description: N_('When someone invites you to be friends.') }

export async function ensureInviteChannel() {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(CHANNEL.id, { name: t(CHANNEL.name), description: t(CHANNEL.description), importance: Notifications.AndroidImportance.DEFAULT })
}

export async function notifyAllowed(): Promise<boolean> {
  try { return (await Notifications.getPermissionsAsync()).status === 'granted' } catch { return false }
}

/** One notification per new invite (a summary past a few); the identifier is the invite's, so a repeat replaces it. */
export async function postInviteNotices(fresh: InviteLite[]) {
  const notes = planNotices(fresh)
  if (!notes.length) return
  await ensureInviteChannel()
  for (const n of notes) {
    await Notifications.scheduleNotificationAsync({
      identifier: n.key,
      content: { title: n.title, body: n.body, data: { url: INVITES_ROUTE } },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL.id } : null,
    })
  }
}
