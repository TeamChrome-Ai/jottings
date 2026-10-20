import { useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import type { Badge } from '@shared/types'
import { targetName, type ReactionKind } from '@shared/friends'
import { t, tn } from '@shared/i18n'
import type { ReceivedReaction } from '../../lib/friends'
import { useInks } from '../../hooks/useTheme'
import { Stagger } from '../motion/nav'
import { Card, T } from '../ui'
import { MotionItem } from '../motion/community'
import { ReactionGlyph, ReactionStack } from './Reactions'
import Avatar from '../Avatar'

const LINES = 3

/**
 * Stats: what friends have left since this screen last showed, as a quiet card at the top ("Anna sent a heart for
 * One week"). The server marks them seen once loaded, so the card is there until the next visit; it opens into place
 * (the tiles below slide down rather than jump) and folds away when a later visit has nothing new.
 */
export function ReactionNotice({ reactions, badges }: { reactions: ReceivedReaction[]; badges: Badge[] }) {
  const fresh = reactions.filter(r => !r.seen)
  const [shown, setShown] = useState<ReceivedReaction[]>(fresh)
  const [leaving, setLeaving] = useState(false)
  const sig = fresh.map(r => r.id).join(',')
  useEffect(() => {
    if (fresh.length) { setShown(fresh); setLeaving(false) } else if (shown.length) setLeaving(true)
    // the ids stand for the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  if (!shown.length) return null
  return (
    <MotionItem key={shown[0].id} enter="expand" leaving={leaving} gap={16} onGone={() => { setShown([]); setLeaving(false) }}>
      <Notice fresh={shown} badges={badges} />
    </MotionItem>
  )
}
function Notice({ fresh, badges }: { fresh: ReceivedReaction[]; badges: Badge[] }) {
  const c = useInks()
  const name = (code: string) => badges.find(b => b.code === code)?.name
  return (
    <Card tone="soft" style={{ gap: 8 }} accessibilityLabel={t('New from friends')}>
      <T small bold>{t('New from friends')}</T>
      {fresh.slice(0, LINES).map((r, i) => (
        <Stagger key={r.id} index={i} base={180}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {/* the sender's picture, their reaction pinned to its corner */}
            <View style={{ width: 34, height: 34 }}>
              {/* a page-coloured rim: the picture's own disc is the soft card's colour */}
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center' }}>
                <Avatar name={r.from.display_name} avatar={r.from.avatar} size={28} />
              </View>
              <View style={{ position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: c.accent, borderWidth: 2, borderColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <ReactionGlyph kind={r.kind} size={10} color={c.accentText} />
              </View>
            </View>
            <T small style={{ flex: 1 }}>{sentLine(r.kind, r.from.display_name, r.target, name)}</T>
          </View>
        </Stagger>
      ))}
      {fresh.length > LINES ? <T small muted>{tn(fresh.length - LINES, 'and {n} more, on your badges below', 'and {n} more, on your badges below')}</T> : null}
    </Card>
  )
}
/** "Anna sent a heart for One week", "… for your 7-day friend streak": one whole phrase for each reaction, a badge or a streak. */
function sentLine(kind: ReactionKind, name: string, target: string, badgeName: (code: string) => string | undefined): string {
  const streak = /^streak:(\d+):/.exec(target)
  if (streak) {
    const v = { name, days: streak[1] }
    switch (kind) {
      case 'heart': return t('{name} sent a heart for your {days}-day friend streak', v)
      case 'smile': return t('{name} sent a smile for your {days}-day friend streak', v)
      case 'clap': return t('{name} sent a round of applause for your {days}-day friend streak', v)
      case 'seal': return t('{name} sent a well-done seal for your {days}-day friend streak', v)
    }
  }
  const v = { name, what: targetName(target, badgeName) }
  switch (kind) {
    case 'heart': return t('{name} sent a heart for {what}', v)
    case 'smile': return t('{name} sent a smile for {what}', v)
    case 'clap': return t('{name} sent a round of applause for {what}', v)
    case 'seal': return t('{name} sent a well-done seal for {what}', v)
  }
}

/**
 * The footer BadgeGrid draws under each badge: the reactions friends left on it. Those new on this visit drop in as
 * the card lands.
 */
export function badgeReactions(reactions: ReceivedReaction[]) {
  const byBadge = new Map<string, ReceivedReaction[]>()
  for (const r of reactions) if (r.target.startsWith('badge:')) { const k = r.target.slice(6); byBadge.set(k, [...(byBadge.get(k) ?? []), r]) }
  const arriving = new Set(reactions.filter(r => !r.seen).map(r => String(r.id)))
  return (b: Badge) => {
    const rs = byBadge.get(b.code)
    if (!rs?.length) return null
    return <Footer items={rs} arriving={arriving} />
  }
}
function Footer({ items, arriving }: { items: ReceivedReaction[]; arriving: Set<string> }) {
  const stack = useMemo(() => items.map(r => ({ key: String(r.id), kind: r.kind, from: r.from })), [items])
  return <View style={{ marginTop: 6 }}><ReactionStack items={stack} arriving={arriving} delay={260} /></View>
}
