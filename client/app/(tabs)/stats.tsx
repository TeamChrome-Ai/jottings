import { useCallback, useMemo, useRef, useState } from 'react'
import { View, type ViewStyle } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { BOOKS } from '@shared/books'
import { chaptersRead, countsOf, laps, readProgress, readTotals, type ReadCounts } from '@shared/paths'
import type { Stats } from '@shared/types'
import { ApiError, cachedGet } from '../../src/lib/api'
import { fmtDuration } from '../../src/lib/format'
import { useAuth } from '../../src/store/auth'
import { useColors, useInks } from '../../src/hooks/useTheme'
import { lapInk } from '../../src/theme'
import { fetchStats } from '../../src/hooks/useStreakAlive'
import { localDay, streakToday } from '../../src/lib/localDay'
import { goalView } from '../../src/lib/dailyGoal'
import { usePref } from '../../src/store/prefs'
import { WeekStrip } from '../../src/components/StreakCard'
import { useCountUp } from '../../src/components/motion/home'
import { BadgeGrid, useFreshBadges } from '../../src/components/motion/badges'
import { Card, Enter, ErrorText, H, H2, Row, SPACE, Screen, Spinner, T, Tap } from '../../src/components/ui'
import SignInCard from '../../src/components/SignInCard'
import MarkReadSheet, { toggleMark, type MarkToggle } from '../../src/components/MarkReadSheet'
import { useMarks } from '../../src/hooks/useMarks'
import { NO_READS, shownCounts, withCounts, withTap, type StatsReads } from '../../src/lib/statsMarks'
import { useReadingWith } from '../../src/store/readingWith'
import PathStrip from '../../src/components/PathStrip'
import { biblePercentWords } from '../../src/lib/pathWords'
import { localReadSet } from '../../src/lib/paths'
import { tourRef } from '../../src/store/tour'
import { loadReactions, markReactionsSeen, type ReceivedReaction } from '../../src/lib/friends'
import { ReactionNotice, badgeReactions } from '../../src/components/friends/StatsReactions'
import { t, tc, tn } from '@shared/i18n'

const days = (n: number) => t('{n} d', { n: Math.round(n) })
const whole = (n: number) => String(Math.round(n))
/** The account's counts; a server from before `/stats/reads` answers 404, and its chapters read stand as read once. */
const loadCounts = () => cachedGet<ReadCounts>('/stats/reads').catch(e => {
  if (e instanceof ApiError && e.status === 404) return cachedGet<Record<string, number[]>>('/stats/progress').then(countsOf)
  throw e
})

export default function StatsScreen() {
  const { user } = useAuth()
  const dailyGoal = usePref('dailyGoal')
  const [stats, setStats] = useState<Stats | null>(null)
  const [reads, setReads] = useState<StatsReads>(NO_READS)
  const [err, setErr] = useState('')
  const [reactions, setReactions] = useState<ReceivedReaction[] | null>(null)
  const uid = user?.id
  const fresh = useFreshBadges(uid, stats?.badges)
  const marks = useMarks().at
  const counts = useMemo(() => shownCounts(reads, marks), [reads, marks])
  /** Marks tapped here, and the last of them the server has (they answer in the order tapped). */
  const made = useRef(0), sent = useRef(0)
  const who = useRef(uid)
  who.current = uid

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
    const upTo = sent.current
    loadCounts().then(r => { if (!cancelled) setReads(s => withCounts(s, r, upTo)) }).catch(() => { if (!cancelled) setReads(s => (s.counts ? s : { ...s, counts: {} })) })

    return () => { cancelled = true }
  }, [uid]))

  // a mark tapped on Progress by book moves its bar at once; the tiles and the counts follow once the server has it
  const toggle = useCallback<MarkToggle>((book, chapter, tick) => {
    const n = ++made.current, mine = who.current
    setReads(s => withTap(s, { n, book, chapter, by: tick === 'ticked' ? -1 : 1 }))
    return toggleMark(book, chapter, tick).then(badges => {
      sent.current = n
      if (who.current === mine) {
        fetchStats().then(s => { if (who.current === mine) setStats(s) }).catch(() => {})
        loadCounts().then(r => { if (who.current === mine) setReads(s => withCounts(s, r, n)) }).catch(() => {})
      }
      return badges
    })
  }, [])

  if (!user) return <Screen safeTop><H>{t('Stats')}</H><LocalStats /></Screen>

  const earned = stats ? stats.badges.filter(b => b.earned_at).length : 0
  return (
    <Screen safeTop>
      <H>{t('Stats')}</H>
      {err ? <ErrorText>{err}</ErrorText> : null}
      {!stats && !err && <Spinner />}
      {stats && (
        <>
          {reactions ? <ReactionNotice reactions={reactions} badges={stats.badges} /> : null}
          {/* five tiles at 31% + flexGrow: the streak row of three, then Chapters and Books sharing the second row */}
          <View ref={tourRef('stats-tiles')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Tile label={t('Streak')} value={streakToday(stats.streak, localDay()).current} fmt={days} />
            <Tile label={t('Longest')} value={stats.streak.longest} fmt={days} />
            <Tile label={tc('time spent', 'Time')} value={stats.total_active_seconds} fmt={fmtDuration} />
            <Tile label={t('Chapters')} value={stats.chapters_read} />
            <Tile label={t('Books')} value={stats.books_completed} />
          </View>
          <H2>{t('This week')}</H2>
          <Card ref={tourRef('stats-week')}><WeekStrip days={stats.streak.days} /><T small muted>{goalView(streakToday(stats.streak, localDay()).todaySeconds, stats.streak.today_goal_seconds, dailyGoal).line}</T></Card>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <H2>{t('Badges')}</H2>
            <BadgeCount earned={earned} total={stats.badges.length} />
          </Row>
          <View ref={tourRef('stats-badges')}><BadgeGrid badges={stats.badges} fresh={fresh} footer={reactions ? badgeReactions(reactions) : undefined} /></View>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <H2>{t('Progress by book')}</H2>
            <T small muted style={{ fontVariant: ['tabular-nums'] }}>{biblePercentWords(chaptersRead(counts))}</T>
          </Row>
          <BookProgress counts={counts} onToggle={toggle} />
        </>
      )}
      <View style={{ height: 24 }} />
    </Screen>
  )
}

/**
 * Signed out: what this device knows on its own, the chapters credited here (lib/paths.ts, the local read set) and the
 * chapters marked on it (a mark counts as read). Two tiles, the whole Bible as the strip, and progress by book; a
 * streak, time and badges are the account's and are not made up here. With nothing read yet the strip stands empty over
 * one line, and the books are there to mark. The blocks rise in turn, as Paths' do; Progress by book keeps its place
 * when the first mark fills the rest in, so its sheet stays open.
 */
function LocalStats() {
  const [device, setDevice] = useState<Set<string> | null>(null)
  const marks = useMarks()
  useFocusEffect(useCallback(() => {
    let cancelled = false
    localReadSet().then(s => { if (!cancelled) setDevice(prev => prev && prev.size === s.size ? prev : s) })
    return () => { cancelled = true }
  }, []))
  const readSet = useMemo(() => {
    if (!device || !marks.ready) return null
    if (!marks.at.size) return device
    const s = new Set(device)
    for (const k of marks.at.keys()) s.add(k)
    return s
  }, [device, marks])
  const totals = useMemo(() => readSet ? readTotals(readSet) : null, [readSet])
  const counts = useMemo(() => readSet ? countsOf(readProgress(readSet)) : null, [readSet])
  if (!readSet || !totals) return null
  const any = totals.chapters > 0
  const signIn = <SignInCard ref={tourRef('stats-signin')} text={t('Sign in to keep a streak, badges and time, and to read with a group.')} />
  const strip = <PathStrip route={null} readSet={readSet} labels={false} delay={any ? 200 : 120} accessibilityLabel={t('The Bible: {n} of 1,189 chapters read on this device', { n: totals.chapters })} />
  return (
    <>
      {any ? (
        <>
          <Enter style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Tile label={t('Chapters read here')} value={totals.chapters} />
            <Tile label={t('Books finished here')} value={totals.books} />
          </Enter>
          <Enter delay={80}>
            <Card style={{ gap: 10 }}>
              <T small muted style={{ fontVariant: ['tabular-nums'] }}>{biblePercentWords(totals.chapters)}</T>
              {strip}
              <T small muted>{t('{n} of 1,189 chapters', { n: totals.chapters.toLocaleString() })}</T>
            </Card>
          </Enter>
        </>
      ) : (
        <Enter>
          <Card style={{ gap: 10 }}>
            {strip}
            <T small muted>{t('Nothing read on this device yet. The chapters you read fill in here.')}</T>
          </Card>
        </Enter>
      )}
      {/* above the 66 rows: under them the one call to action sat a long scroll away */}
      <Enter delay={any ? 160 : 80}>{signIn}</Enter>
      <Enter delay={any ? 240 : 160} style={{ gap: SPACE.l }}>
        <H2>{t('Progress by book')}</H2>
        <BookProgress counts={counts} onToggle={toggleMark} />
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
  return <T small muted style={{ fontVariant: ['tabular-nums'] }}>{t('{n} of {total} earned', { n, total })}</T>
}

/** A book's row in words: the first time through as the strip says it, a later one by the times whole and the chapters since. */
function lapWords(book: string, chapters: number, lap: number, done: number): string {
  if (lap === 1) return tn(chapters, '{book}, {read} of {n} chapter read', '{book}, {read} of {n} chapters read', { book, read: done })
  if (done < chapters) return tn(lap - 1, '{book}, read through once, and {done} of {chapters} chapters again', '{book}, read through {n} times, and {done} of {chapters} chapters again', { book, done, chapters })
  return t('{book}, read through {n} times', { book, n: lap })
}

/**
 * 66 bars, drawn still. The card sits below the badge grid, well under the fold on every screen, so an entrance here
 * only ever played to nobody while costing an Animated node per row. Each time through a book lies over the one before
 * it from the left, in its own ink (`lapInk`), so a book read again fills again. A tap on a book opens its chapters to
 * mark as read (MarkReadSheet), except while reading with a group: what is read then is the group's, as at a
 * chapter's end.
 */
function BookProgress({ counts, onToggle }: { counts: ReadCounts | null; onToggle: MarkToggle }) {
  const c = useInks(), colors = useColors()
  const withGroup = !!useReadingWith()
  const [open, setOpen] = useState<number | null>(null)
  return (
    <Card style={{ gap: 6 }}>
      {withGroup ? null : <T small muted>{t('Tap a book to mark the chapters you have read.')}</T>}
      {BOOKS.map(b => {
        const { fills, lap, done } = laps(counts?.[String(b.n)] ?? [], b.chapters)
        const says = lapWords(b.name, b.chapters, lap, done)
        const row = (
          <>
            <T small style={{ width: 64 }} numberOfLines={1}>{b.abbr}</T>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: c.border, overflow: 'hidden' }}>
              {/* a time as wide as the one over it is hidden by it: Psalm 23 read daily would stack a View a day */}
              {fills.map((f, k) => f === fills[k + 1] ? null : <View key={k} style={{ position: 'absolute', left: 0, width: `${f * 100}%`, height: 6, backgroundColor: k ? lapInk(colors, k + 1) : f === 1 ? c.accent : c.muted }} />)}
            </View>
            <T small muted numberOfLines={1} style={{ width: 76, textAlign: 'right', fontVariant: ['tabular-nums'] }}>{lap > 1 ? t('×{lap} {done}/{chapters}', { lap, done, chapters: b.chapters }) : `${done}/${b.chapters}`}</T>
          </>
        )
        return withGroup
          ? <View key={b.n} accessible accessibilityLabel={says} style={ROW}>{row}</View>
          : <Tap key={b.n} onPress={() => setOpen(b.n)} scaleTo={0.985} hitSlop={ROW_SLOP} accessibilityRole="button" accessibilityLabel={says} accessibilityHint={t('Opens its chapters, to mark the ones you have read')} style={ROW}>{row}</Tap>
      })}
      <MarkReadSheet book={withGroup ? null : open} counts={counts} onToggle={onToggle} onClose={() => setOpen(null)} />
    </Card>
  )
}
const ROW: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: 8 }
/** The rows are 6 apart: each takes half the gap on either side. */
const ROW_SLOP = { top: 3, bottom: 3 }
