import { useRef, useState } from 'react'
import { View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import type { Badge } from '@shared/types'
import { presentFriendStreak, streakMilestone, type ReactionKind } from '@shared/friends'
import { t, tc, tn } from '@shared/i18n'
import { useAuth } from '../../src/store/auth'
import { useToast } from '../../src/store/toast'
import { useColors } from '../../src/hooks/useTheme'
import { usePrefsStore } from '../../src/store/prefs'
import { confirmAsync, errMsg, fmtDay, useLoad } from '../../src/lib/community'
import { firstName, loadFriend, react, removeFriend, type Friend } from '../../src/lib/friends'
import { blockUser } from '../../src/lib/moderation'
import Avatar from '../../src/components/Avatar'
import { WeekStrip } from '../../src/components/StreakCard'
import { BadgeGrid } from '../../src/components/motion/badges'
import { useCountUp } from '../../src/components/motion/home'
import { StreakSeal, friendItems, useCountFrom, useKeptMoments } from '../../src/components/friends/Seal'
import { ReactionPicker, ReactionStack, centreOf, flyReaction } from '../../src/components/friends/Reactions'
import { Button, Card, Enter, ErrorText, H, H2, Row, Screen, Spinner, T } from '../../src/components/ui'

/**
 * One friend: your friend streak, their streak and week, chapters this week and badges, each only as they share it.
 * A badge (and a friend-streak milestone) takes one reaction from you, flown from your finger to it.
 */
export default function FriendScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const fid = Number(id)
  const { user, ready } = useAuth()
  const { state, mutate } = useLoad(() => loadFriend(fid), [fid], ready && !!user && Number.isFinite(fid))
  const f = state.kind === 'ready' ? state.data : null
  const moments = useKeptMoments(user?.id, friendItems(f ? [f] : null))
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: f ? f.display_name : t('Friend') }} />
      {state.kind === 'loading' ? <Spinner /> : null}
      {state.kind === 'error' ? <ErrorText>{state.message}</ErrorText> : null}
      {f && moments ? <Body f={f} moment={moments[f.id] ?? null} onSent={(target, kind, at) => mutate(d => ({ ...d, reactions: { ...d.reactions, sent: [...d.reactions.sent, { target, kind, created_at: at }] } }))} /> : null}
    </Screen>
  )
}

type Sent = (target: string, kind: ReactionKind, at: string) => void

function Body({ f, moment, onSent }: { f: Friend; moment: { play: boolean; from: number; key: string } | null; onSent: Sent }) {
  const router = useRouter()
  const toast = useToast()
  const name = firstName(f)
  const [busy, setBusy] = useState(false)
  const leave = async (block: boolean) => {
    const ok = block
      ? await confirmAsync(t('Block @{handle}?', { handle: f.handle }), t('You stop being friends and they can no longer invite you. Their posts disappear from your feeds. They are not told.'), tc('verb', 'Block'))
      : await confirmAsync(t('Remove {name} from your friends?', { name: f.display_name }), t('Your friend streak and the reactions between you go too. They are not told, but will no longer see you in their friends.'), t('Remove'))
    if (!ok) return
    setBusy(true)
    try {
      if (block) await blockUser(f.id); else await removeFriend(f.id)
      toast.show(block ? t('Blocked @{handle}', { handle: f.handle }) : t('Removed {name}', { name: f.display_name }))
      router.back()
    } catch (e) { toast.show(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <>
      <Enter>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Avatar name={f.display_name} avatar={f.avatar} size={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <H style={{ fontSize: 24, marginBottom: 0 }}>{f.display_name}</H>
            <T small muted>@{f.handle} · {t('friends since {date}', { date: fmtDay(f.since) })}</T>
          </View>
        </Card>
      </Enter>
      <FriendStreakCard f={f} moment={moment} onSent={onSent} />
      <Their f={f} name={name} />
      <Badges f={f} name={name} onSent={onSent} />
      <Enter delay={260}>
        <Row style={{ marginTop: 8 }}>
          <Button small title={t('Remove friend')} disabled={busy} onPress={() => { void leave(false) }} />
          <Button small danger title={tc('verb', 'Block')} disabled={busy} onPress={() => { void leave(true) }} />
        </Row>
      </Enter>
    </>
  )
}

/** The friend streak: the seal (its kept moment plays here too), the words, and a milestone's reactions both ways. */
function FriendStreakCard({ f, moment, onSent }: { f: Friend; moment: { play: boolean; from: number; key: string } | null; onSent: Sent }) {
  const c = useColors()
  const p = presentFriendStreak(f.friend_streak, firstName(f))
  const count = useCountFrom(moment?.play ? moment.from : p.count, p.count, 200)
  const milestone = streakMilestone(f.friend_streak)
  const sealRef = useRef<View>(null)
  if (!p.show) {
    return <Enter delay={80}><Card><T small muted>{f.friend_streak === null ? t('Friend streaks need you both to share your streak.') : ''}</T></Card></Enter>
  }
  const received = milestone ? f.reactions.received.filter(r => r.target === milestone.target) : []
  const sent = milestone ? f.reactions.sent.find(r => r.target === milestone.target) : undefined
  return (
    <Enter delay={80}>
      <Card accessibilityLabel={p.label} style={{ gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View ref={sealRef} collapsable={false}><StreakSeal fs={f.friend_streak} size={60} moment={moment} delay={220} /></View>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T bold style={{ fontSize: 34, fontVariant: ['tabular-nums'], color: p.tone === 'lapsed' ? c.muted : c.text }}>{count}</T>
              <T muted>{p.tone === 'lapsed' ? tn(p.count, 'days, your best together', 'days, your best together') : tn(p.count, 'day together', 'days together')}</T>
            </View>
            <T small muted>{p.line}</T>
          </View>
        </View>
        {milestone ? (
          <View style={{ gap: 8 }}>
            <T small bold>{milestone.days === 7 ? t('A week together') : t('{days}-day milestone', { days: milestone.days })}</T>
            {received.length ? <ReactionStack items={received.map(r => ({ key: `${r.target}`, kind: r.kind, from: f }))} /> : null}
            {f.reactions.open ? <SendReaction to={f.id} target={milestone.target} label={t('your {days}-day friend streak with {name}', { days: milestone.days, name: f.display_name })} sent={sent?.kind ?? null} landOn={() => sealRef.current} onSent={onSent} /> : null}
          </View>
        ) : null}
      </Card>
    </Enter>
  )
}

/** Their streak, their week (on their own day) and chapters this week, each as they share it. */
function Their({ f, name }: { f: Friend; name: string }) {
  const n = useCountUp(f.streak?.current ?? 0, undefined, undefined, 160)
  const ch = useCountUp(f.chapters_week ?? 0, undefined, undefined, 160)
  if (!f.streak && f.chapters_week === null) return <Enter delay={140}><T small muted>{t('{name} keeps their reading to themselves.', { name })}</T></Enter>
  return (
    <Enter delay={140} style={{ gap: 12 }}>
      <H2>{t('{name}’s reading', { name })}</H2>
      <Card>
        {f.streak ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <T style={{ fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{n}</T>
              <T muted style={{ flex: 1 }}>{tn(f.streak.current, 'day streak · longest {longest}', 'day streak · longest {longest}', { longest: f.streak.longest })}</T>
            </View>
            <WeekStrip days={f.streak.week.map(date => ({ date, met: 1 as const }))} today={f.streak.today} delay={200} />
          </>
        ) : <T small muted>{t('{name} keeps their streak to themselves.', { name })}</T>}
        {f.chapters_week !== null ? <T small muted>{tn(f.chapters_week, '{n} chapter read this week', '{n} chapters read this week', { n: ch })}</T> : null}
      </Card>
    </Enter>
  )
}

/** Their earned badges; each takes one reaction from you, flown to its mark. */
function Badges({ f, name, onSent }: { f: Friend; name: string; onSent: Sent }) {
  const marks = useRef(new Map<string, View | null>()).current
  const [landed, setLanded] = useState<ReadonlySet<string>>(new Set())
  if (f.badges === null) return <Enter delay={200}><T small muted>{t('{name} keeps their badges to themselves.', { name })}</T></Enter>
  const earned = f.badges.filter(b => b.earned_at)
  const footer = (b: Badge) => {
    const target = `badge:${b.code}`
    const sent = f.reactions.sent.find(r => r.target === target)
    return (
      <View style={{ gap: 6, marginTop: 4 }}>
        <T small muted>{b.earned_at ? fmtDay(b.earned_at) : ''}</T>
        {f.reactions.open ? <SendReaction to={f.id} target={target} label={t('{name}’s badge {badge}', { name: f.display_name, badge: b.name })} sent={sent?.kind ?? null} landOn={() => marks.get(b.code) ?? null} onSent={onSent} onLand={() => setLanded(s => new Set([...s, b.code]))} /> : null}
      </View>
    )
  }
  return (
    <Enter delay={200} style={{ gap: 12 }}>
      <H2>{t('Badges')}</H2>
      {earned.length === 0 ? <T small muted>{t('No badges yet.')}</T> : null}
      <BadgeGrid badges={earned} fresh={landed} footer={footer} markRef={(code, v) => { marks.set(code, v) }} />
    </Enter>
  )
}

/** The four reactions for one thing, sending one and flying it from the finger to `landOn`. */
function SendReaction({ to, target, label, sent, landOn, onSent, onLand }: { to: number; target: string; label: string; sent: ReactionKind | null; landOn: () => View | null; onSent: Sent; onLand?: () => void }) {
  const c = useColors()
  const prefs = usePrefsStore()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [mine, setMine] = useState<ReactionKind | null>(sent)
  const pick = async (kind: ReactionKind, at: { x: number; y: number }) => {
    if (mine || busy) return
    setBusy(true)
    const dest = await centreOf(landOn())
    try {
      const r = await react(to, target, kind)
      setMine(r.reaction.kind)
      flyReaction(r.reaction.kind, at, dest, c, prefs.get().reduceMotion, () => { onLand?.(); onSent(target, r.reaction.kind, r.reaction.created_at) })
    } catch (e) { toast.show(errMsg(e)) } finally { setBusy(false) }
  }
  return <ReactionPicker sent={mine} busy={busy} label={label} onPick={(k, at) => { void pick(k, at) }} />
}
