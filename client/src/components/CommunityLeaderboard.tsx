import { useState } from 'react'
import { Animated, View } from 'react-native'
import type { EventMetric, LeaderboardRow } from '@shared/types'
import { get } from '../lib/api'
import { fmtDuration } from '../lib/format'
import { useColors } from '../hooks/useTheme'
import { useAuth } from '../store/auth'
import { GLOBAL_PERIODS, displayName, fmtValue, useLoad, type GlobalPeriod } from '../lib/community'
import { AdminBadge, UserLink } from './CommunityBits'
import { FillBar, PulseOnce, staggerDelay, useReorderMotion } from './motion/community'
import { ErrorText, Segmented, Spinner, T } from './ui'
import { FILL_MS, STAGGER_CAP, STAGGER_STEP } from '../lib/motionTiming'

/** Bars start filling once the board's own entrance is under way. */
const BAR_BASE = 120

/**
 * Ranked rows (the server's `rank` when it sends one: a private board shows my row at its true place): value in the
 * metric's unit, active time and credited chapters; my row is highlighted.
 * Bars show progress to the goal, or share of the leader's value when there is no goal. They fill in rank order on mount
 * and glide on refresh; my row gets one accent pulse once they have landed; a re-sort moves (native) or crossfades (web).
 */
export function LeaderboardTable({ rows, metric, goal, myId }: { rows: LeaderboardRow[]; metric: EventMetric; goal?: number | null; myId: number | null }) {
  const c = useColors()
  const fade = useReorderMotion(rows.map(r => r.user_id).join(','))
  if (rows.length === 0) return <T small muted>No activity in this window yet.</T>
  const hasGoal = goal != null && goal > 0
  const top = Math.max(0, ...rows.map(r => r.value))
  // my row's wash goes up as the last animated bar lands
  const landed = BAR_BASE + (Math.min(rows.length, STAGGER_CAP) - 1) * STAGGER_STEP + FILL_MS
  return (
    <Animated.View style={{ gap: 6, opacity: fade }}>
      {rows.map((r, i) => {
        const me = r.user_id === myId
        const pct = hasGoal ? r.value / goal : top > 0 ? r.value / top : 0
        return (
          <View key={r.user_id} accessibilityLabel={me ? 'your row' : undefined}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, backgroundColor: me ? c.selected : 'transparent' }}>
            {me ? <PulseOnce delay={landed} /> : null}
            <T bold muted style={{ width: 26, textAlign: 'right' }}>{r.rank ?? i + 1}</T>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><UserLink handle={r.handle} name={displayName(r)} bold={me} />{r.staff ? <AdminBadge /> : null}</View>
              <T small muted>{fmtDuration(r.active_seconds)} active · {r.pages} ch.</T>
              <FillBar pct={pct} delay={staggerDelay(i, STAGGER_CAP, STAGGER_STEP, BAR_BASE) ?? BAR_BASE + STAGGER_CAP * STAGGER_STEP} height={hasGoal ? 6 : 4} />
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <T bold>{fmtValue(r.value, metric)}</T>
              {goal != null && goal > 0 ? <T small muted>{Math.round(100 * r.value / goal)}% of goal</T> : null}
            </View>
          </View>
        )
      })}
    </Animated.View>
  )
}

