import { View } from 'react-native'
import type { User } from '@shared/types'
import { groupAsStreak, presentGroupStreak } from '@shared/friends'
import { t, tn } from '@shared/i18n'
import type { GroupDetail } from '../lib/community'
import { useColors } from '../hooks/useTheme'
import Avatar from './Avatar'
import { Grow, Card, T } from './ui'
import { StreakSeal, useCountFrom, useKeptMoments } from './friends/Seal'

/**
 * A reading group's shared streak: the seal in the friend-streak style (its kept moment plays here the first time a
 * kept day is seen), the count, and one mark per member for today, filled for those who have read. No names beside
 * the marks and no word for who has not read yet: "3 of 5 have read today" is the whole story.
 */
export default function GroupStreakCard({ group, me, delay = 0 }: { group: GroupDetail; me: User; delay?: number }) {
  const c = useColors()
  const g = group.streak ?? null
  const fs = g ? groupAsStreak(g, me.id) : null
  const moments = useKeptMoments(me.id, fs ? [{ key: `g${group.id}`, streak: fs }] : null)
  const moment = moments?.[`g${group.id}`] ?? null
  const p = presentGroupStreak(g)
  const count = useCountFrom(moment?.play ? moment.from : p.count, p.count, delay + 200)
  if (!g || !moments) return null
  const byId = new Map(group.members.map(m => [m.id, m]))
  return (
    <Card accessibilityLabel={t('Group streak. {label}', { label: p.label })} style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <StreakSeal fs={fs} size={56} moment={moment} delay={delay + 60} />
        <View style={{ flex: 1, gap: 2 }}>
          {p.tone === 'none' ? <T bold>{p.headline}</T> : (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T bold style={{ fontSize: 32, fontVariant: ['tabular-nums'], color: p.tone === 'lapsed' ? c.muted : c.text }}>{count}</T>
              <T muted>{p.tone === 'lapsed' ? tn(p.count, 'days, the group’s best', 'days, the group’s best') : tn(p.count, 'day together', 'days together')}</T>
            </View>
          )}
          <T small muted>{p.line}</T>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {g.today.map((t, i) => {
          const m = byId.get(t.id)
          return (
            <Grow key={t.id} from={0.6} delay={delay + 120 + Math.min(i, 12) * 24}>
              <View style={{ opacity: t.met ? 1 : 0.35, borderRadius: 16, borderWidth: 2, borderColor: t.met ? c.accent : 'transparent', padding: 1 }}>
                <Avatar name={m?.display_name ?? '?'} avatar={m?.avatar} size={26} />
              </View>
            </Grow>
          )
        })}
      </View>
    </Card>
  )
}
