import { useEffect, useState } from 'react'
import { View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { presentFriendStreak } from '@shared/friends'
import { firstName, type Friend } from '../../lib/friends'
import { useColors } from '../../hooks/useTheme'
import Avatar from '../Avatar'
import { PulseOnce } from '../motion/community'
import { T, Tap } from '../ui'
import { StreakSeal, useCountFrom, type Moment } from './Seal'

/**
 * Friends this device has not shown before (someone accepted an invite since): their ids, once. The first ever view
 * seeds the record and reports nothing, so an existing list never celebrates.
 */
export function useNewFriends(uid: number | undefined, ids: number[] | null): ReadonlySet<number> {
  const [fresh, setFresh] = useState<ReadonlySet<number>>(NONE)
  const sig = ids ? [...ids].sort((a, b) => a - b).join(',') : null
  useEffect(() => {
    if (uid == null || sig == null) return
    const key = `berean_friends_known_${uid}`
    const now = sig ? sig.split(',').map(Number) : []
    let live = true
    AsyncStorage.getItem(key).then(raw => {
      if (!live) return
      let known: number[] | null = null
      try { known = raw ? JSON.parse(raw) as number[] : null } catch { /* reseed */ }
      if (known) { const had = new Set(known); const f = now.filter(id => !had.has(id)); if (f.length) setFresh(new Set(f)) }
      AsyncStorage.setItem(key, JSON.stringify(now)).catch(() => {})
    }).catch(() => {})
    return () => { live = false }
  }, [uid, sig])
  return fresh
}
const NONE: ReadonlySet<number> = new Set()

/**
 * One friend on the list: their mark, name and handle, the friend streak's line, and its seal with the count. A new
 * friend's card is washed once in the accent as it opens into the list.
 */
export function FriendCard({ f, moment, fresh, delay = 0, onPress }: { f: Friend; moment: Moment | null; fresh?: boolean; delay?: number; onPress: () => void }) {
  const c = useColors()
  const p = presentFriendStreak(f.friend_streak, firstName(f))
  const count = useCountFrom(moment?.play ? moment.from : p.count, p.count, delay + 160)
  return (
    <Tap onPress={onPress} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={`${f.display_name}, @${f.handle}${p.show ? `. ${p.label}` : ''}`}
      style={{ backgroundColor: c.card, borderRadius: 20, padding: 14, paddingLeft: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {fresh ? <PulseOnce delay={320} radius={20} strength={0.18} /> : null}
      <Avatar name={f.display_name} avatar={f.avatar} size={44} />
      <View style={{ flex: 1, gap: 1 }}>
        <T bold numberOfLines={1}>{f.display_name}</T>
        <T small muted numberOfLines={1}>{p.show ? p.line : `@${f.handle}`}</T>
      </View>
      {p.show && p.tone !== 'none' ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T bold style={{ fontSize: 20, fontVariant: ['tabular-nums'], color: p.tone === 'lapsed' ? c.muted : c.text }}>{count}</T>
          <StreakSeal fs={f.friend_streak} size={36} moment={moment} delay={delay} />
        </View>
      ) : null}
    </Tap>
  )
}
