import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { presentFriendStreak } from '@shared/friends'
import { t, tn } from '@shared/i18n'
import { firstName, type Friend, type FriendsOverview } from '../../lib/friends'
import { useInks } from '../../hooks/useTheme'
import Avatar from '../Avatar'
import Icon from '../Icon'
import { Stagger } from '../motion/nav'
import { Card, T } from '../ui'
import { StreakSeal, friendItems, useCountFrom, useKeptMoments, type Moment } from './Seal'

const SHOWN = 4

/**
 * Home → Together, when there are friends or invites: the friend streaks at a glance (the longest first) and invites
 * waiting. The kept moment plays here if this is where a kept day is first seen. `delay` is the block's own entrance.
 */
export default function HomeFriends({ data, uid, delay = 0 }: { data: FriendsOverview; uid: number; delay?: number }) {
  const router = useRouter()
  const c = useInks()
  const moments = useKeptMoments(uid, friendItems(data.friends))
  const n = data.incoming.length
  const shown = data.friends.slice(0, SHOWN)
  return (
    <Card onPress={() => router.push('/friends')} accessibilityLabel={n ? tn(n, 'Friends, {n} invite waiting', 'Friends, {n} invites waiting') : t('Friends')} style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <T bold style={{ flex: 1 }}>{t('Friends')}</T>
        {n ? <T small accent bold>{tn(n, '{n} invite waiting', '{n} invites waiting')}</T> : null}
        <Icon name="chevron" size={18} color={c.muted} />
      </View>
      {moments ? shown.map((f, i) => (
        <Stagger key={f.id} index={i} base={delay + 80}>
          <Line f={f} moment={moments[f.id] ?? null} delay={delay + 160 + i * 34} />
        </Stagger>
      )) : null}
      {data.friends.length > SHOWN ? <T small muted>{tn(data.friends.length - SHOWN, 'and {n} more', 'and {n} more')}</T> : null}
      {data.friends.length === 0 ? <T small muted>{t('No friends yet: answer the invite, or add someone by their handle.')}</T> : null}
    </Card>
  )
}

function Line({ f, moment, delay }: { f: Friend; moment: Moment | null; delay: number }) {
  const c = useInks()
  const p = presentFriendStreak(f.friend_streak, firstName(f))
  const count = useCountFrom(moment?.play ? moment.from : p.count, p.count, delay)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} accessible accessibilityLabel={`${f.display_name}${p.show ? `. ${p.label}` : ''}`}>
      <Avatar name={f.display_name} avatar={f.avatar} size={32} />
      <View style={{ flex: 1 }}>
        <T numberOfLines={1}>{f.display_name}</T>
        {p.show ? <T small muted numberOfLines={1}>{p.line}</T> : null}
      </View>
      {p.show && p.tone !== 'none' ? (
        <>
          <T bold style={{ fontVariant: ['tabular-nums'], color: p.tone === 'lapsed' ? c.muted : c.text }}>{count}</T>
          <StreakSeal fs={f.friend_streak} size={28} moment={moment} delay={delay} />
        </>
      ) : null}
    </View>
  )
}
