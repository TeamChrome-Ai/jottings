import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { REACTION_WORDS } from '@shared/friends'
import { loadReactions } from './friends'
import { reminderAllowed } from './streakReminder'

/**
 * A friend's reaction, noticed while the app is open (a reader heartbeat reports it): one local notification, only
 * when the streak reminder is on and notifications are allowed, on a low-importance channel of its own (no sound, no
 * heads-up). Never a push: nothing reaches the phone while the app is closed. Native only; the web module is inert.
 */
export const REACTIONS_ROUTE = '/stats'
const CHANNEL = { id: 'friends-reactions', name: 'Reactions from friends', description: 'A quiet note when a friend leaves a heart on a badge or your friend streak.' }
const DONE_KEY = 'berean_reactions_notified'

let known = 0
let busy = false
export async function noteUnseenReactions(unseen: number) {
  if (unseen <= known || busy) { known = Math.min(known, unseen); return }
  busy = true
  try {
    if (!reminderAllowed() || (await Notifications.getPermissionsAsync()).status !== 'granted') return
    const { reactions } = await loadReactions()
    let done: number[] = []
    try { done = JSON.parse((await AsyncStorage.getItem(DONE_KEY)) ?? '[]') as number[] } catch { /* none */ }
    const fresh = reactions.filter(r => !r.seen && !done.includes(r.id))
    if (!fresh.length) return
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync(CHANNEL.id, { name: CHANNEL.name, description: CHANNEL.description, importance: Notifications.AndroidImportance.LOW })
    const first = fresh[0]
    await Notifications.scheduleNotificationAsync({
      content: {
        title: fresh.length === 1 ? `${first.from.display_name} sent a ${REACTION_WORDS[first.kind].one}` : `${fresh.length} reactions from friends`,
        body: 'See them on your badges in Stats',
        data: { url: REACTIONS_ROUTE },
      },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL.id } : null,
    })
    AsyncStorage.setItem(DONE_KEY, JSON.stringify([...done, ...fresh.map(r => r.id)].slice(-300))).catch(() => {})
  } catch { /* a notice is never worth an error */ } finally { known = unseen; busy = false }
}
