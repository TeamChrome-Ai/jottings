import { useCallback, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { BOOKS } from '@shared/books'
import { readProgress, readTotals } from '@shared/paths'
import type { Stats } from '@shared/types'
import { cachedGet } from '../../src/lib/api'
import { fmtDuration } from '../../src/lib/format'
import { useAuth } from '../../src/store/auth'
import { useInks } from '../../src/hooks/useTheme'
import { fetchStats } from '../../src/hooks/useStreakAlive'
import { localDay, streakToday } from '../../src/lib/localDay'
import { goalView } from '../../src/lib/dailyGoal'
import { usePref } from '../../src/store/prefs'
import { WeekStrip } from '../../src/components/StreakCard'
import { useCountUp } from '../../src/components/motion/home'
import { BadgeGrid, useFreshBadges } from '../../src/components/motion/badges'
import { Card, Enter, ErrorText, H, H2, Row, SPACE, Screen, Spinner, T } from '../../src/components/ui'
import SignInCard from '../../src/components/SignInCard'
import PathStrip from '../../src/components/PathStrip'
import { localReadSet } from '../../src/lib/paths'
import { tourRef } from '../../src/store/tour'
import { loadReactions, markReactionsSeen, type ReceivedReaction } from '../../src/lib/friends'
import { ReactionNotice, badgeReactions } from '../../src/components/friends/StatsReactions'

const days = (n: number) => `${Math.round(n)} d`
const whole = (n: number) => String(Math.round(n))

export default function StatsScreen() {
  const { user } = useAuth()
  const dailyGoal = usePref('dailyGoal')
  const [stats, setStats] = useState<Stats | null>(null)
  const [progress, setProgress] = useState<Record<string, number[]> | null>(null)
  const [err, setErr] = useState('')
  const [reactions, setReactions] = useState<ReceivedReaction[] | null>(null)
  const uid = user?.id
  const fresh = useFreshBadges(uid, stats?.badges)

  useFocusEffect(useCallback(() => {
    if (!uid) return
    let cancelled = false
    setErr('')
    // stats and friends' reactions land in one commit, so the notice is in place as the screen fills
    Promise.all([fetchStats(), loadReactions().catch(() => null)]).then(([s, r]) => {
      if (cancelled) return
      setStats(s)
      if (r) { setReactions(r.reactions); if (r.reactions.some(x => !x.seen)) markReactionsSeen().catch(() => {}) }
    }).catch(e => { if (!cancelled) setErr((e as Error).message) })
    cachedGet<Record<string, number[]>>('/stats/progress').then(p => { if (!cancelled) setProgress(p) }).catch(() => { if (!cancelled) setProgress(p => p ?? {}) })

    return () => { cancelled = true }
  }, [uid]))

  if (!user) return <Screen safeTop><H>Stats</H><LocalStats /></Screen>

  const earned = stats ? stats.badges.filter(b => b.earned_at).length : 0
  return (
    <Screen safeTop>
      <H>Stats</H>
      {err ? <ErrorText>{err}</ErrorText> : null}
      {!stats && !err && <Spinner />}
      {stats && (
        <>
          {reactions ? <ReactionNotice reactions={reactions} badges={stats.badges} /> : null}
          {/* five tiles at 31% + flexGrow: the streak row of three, then Chapters and Books sharing the second row */}
          <View ref={tourRef('stats-tiles')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Tile label="Streak" value={streakToday(stats.streak, localDay()).current} fmt={days} />
            <Tile label="Longest" value={stats.streak.longest} fmt={days} />
            <Tile label="Time" value={stats.total_active_seconds} fmt={fmtDuration} />
            <Tile label="Chapters" value={stats.chapters_read} />
            <Tile label="Books" value={stats.books_completed} />
          </View>
          <H2>This week</H2>
          <Card ref={tourRef('stats-week')}><WeekStrip days={stats.streak.days} /><T small muted>{goalView(streakToday(stats.streak, localDay()).todaySeconds, stats.streak.today_goal_seconds, dailyGoal).line}</T></Card>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <H2>Badges</H2>
            <BadgeCount earned={earned} total={stats.badges.length} />
          </Row>
          <View ref={tourRef('stats-badges')}><BadgeGrid badges={stats.badges} fresh={fresh} footer={reactions ? badgeReactions(reactions) : undefined} /></View>
          <H2>Progress by book</H2>
          <BookProgress progress={progress} />
        </>
      )}
      <View style={{ height: 24 }} />
    </Screen>
  )
}

/**
 * Signed out: what this device knows on its own, the chapters credited here (lib/paths.ts, the local read set). Two
 * tiles, the whole Bible as the strip, and progress by book; a streak, time and badges are the account's and are not
 * made up here. With nothing read yet the strip stands empty over one line. The blocks rise in turn, as Paths' do.
 */
function LocalStats() {
  const [readSet, setReadSet] = useState<Set<string> | null>(null)
  useFocusEffect(useCallback(() => {
    let cancelled = false
    localReadSet().then(s => { if (!cancelled) setReadSet(prev => prev && prev.size === s.size ? prev : s) })
    return () => { cancelled = true }
  }, []))
  const totals = useMemo(() => readSet ? readTotals(readSet) : null, [readSet])
  const progress = useMemo(() => readSet ? readProgress(readSet) : null, [readSet])
  if (!readSet || !totals) return null
  const any = totals.chapters > 0
  const signIn = <SignInCard ref={tourRef('stats-signin')} text="Sign in to keep a streak, badges and time, and to read with a group." />
  const strip = <PathStrip route={null} readSet={readSet} labels={false} delay={any ? 200 : 120} accessibilityLabel={`The Bible: ${totals.chapters} of 1,189 chapters read on this device`} />
  if (!any) return (
    <>
      <Enter>
        <Card style={{ gap: 10 }}>
          {strip}
          <T small muted>Nothing read on this device yet. The chapters you read fill in here.</T>
        </Card>
      </Enter>
      <Enter delay={80}>{signIn}</Enter>
    </>
  )
  return (
    <>
      <Enter style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Tile label="Chapters read here" value={totals.chapters} />
        <Tile label="Books finished here" value={totals.books} />
      </Enter>
      <Enter delay={80}>
        <Card style={{ gap: 10 }}>
          {strip}
          <T small muted>{totals.chapters.toLocaleString()} of 1,189 chapters</T>
        </Card>
      </Enter>
      {/* above the 66 rows: under them the one call to action sat a long scroll away */}
      <Enter delay={160}>{signIn}</Enter>
      <Enter delay={240} style={{ gap: SPACE.l }}>
        <H2>Progress by book</H2>
        <BookProgress progress={progress} />
      </Enter>
      <View style={{ height: 24 }} />
    </>
  )
}

/** Summary number; every tile counts up over the same COUNT_MS (360 ms), so the row lands together. */
function Tile({ label, value, fmt = whole }: { label: string; value: number; fmt?: (n: number) => string }) {
  const text = useCountUp(value, fmt)
  return (
    <Card style={{ width: '31%', flexGrow: 1, gap: 2 }}>
      <T small muted>{label}</T>
      <T bold style={{ fontSize: 22, fontVariant: ['tabular-nums'] }}>{text}</T>
    </Card>
  )
}

function BadgeCount({ earned, total }: { earned: number; total: number }) {
  const n = useCountUp(earned)
  return <T small muted style={{ fontVariant: ['tabular-nums'] }}>{n} of {total} earned</T>
}

/**
 * 66 bars, drawn still. The card sits below the badge grid, well under the fold on every screen, so an entrance here
 * only ever played to nobody while costing an Animated node per row.
 */
function BookProgress({ progress }: { progress: Record<string, number[]> | null }) {
  const c = useInks()
  return (
    <Card style={{ gap: 6 }}>
      {BOOKS.map(b => {
        const read = progress?.[String(b.n)]?.length ?? 0
        return (
          <View key={b.n} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T small style={{ width: 64 }} numberOfLines={1}>{b.abbr}</T>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.border, overflow: 'hidden' }}>
              <View style={{ width: `${(read / b.chapters) * 100}%`, height: 6, backgroundColor: read === b.chapters ? c.accent : c.muted }} />
            </View>
            <T small muted style={{ width: 52, textAlign: 'right' }}>{read}/{b.chapters}</T>
          </View>
        )
      })}
    </Card>
  )
}
