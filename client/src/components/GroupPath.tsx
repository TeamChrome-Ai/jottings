import { useMemo, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { User } from '@shared/types'
import { PATH_IDS, chapterKey, isPathId, pathBlurb, pathBooks, pathChapters, pathLength, pathTitle, type GroupPath as GroupPathData, type PathId } from '@shared/paths'
import type { GroupDetail } from '../lib/community'
import { confirmAsync, displayName } from '../lib/community'
import { t, tc, tn } from '@shared/i18n'
import { dateLocale } from '../i18n'
import { useGroupPath, usePath } from '../lib/paths'
import { useEdition } from '../lib/edition'
import { pathOffered, shownPathId } from '../lib/editionCore'
import { fmtTargetDay, portionTitle } from '../lib/pathWords'
import { useInks } from '../hooks/useTheme'
import PathStrip, { type StripMember } from './PathStrip'
import { MonthPicker } from './PathSheets'
import { FadeSwap } from './motion/nav'
import { Button, Card, ErrorText, H2, ListRow, Row, SPACE, Sheet, T, TYPE } from './ui'

/**
 * A group walking a path together (docs/PATHS.md rule 5): the strip with a dot per member, the members listed by how
 * far along they are, the target if the admins set one. Admins choose the path (a built-in one: the server places
 * members by its order) and its target; everyone else reads. No feed posts, no nagging. The group's own reads are
 * counted from the group's start, so the strip's fill is the viewer's place on it.
 */
export default function GroupPathSection({ group, me }: { group: GroupDetail; me: User }) {
  const router = useRouter()
  const c = useInks()
  const gp = useGroupPath(group.slug)
  const mine = usePath()
  const path = gp.path === undefined ? group.path ?? null : gp.path
  const isAdmin = group.role === 'admin'
  const [choosing, setChoosing] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const byId = useMemo(() => new Map(group.members.map(m => [m.id, m])), [group.members])
  const chapters = useMemo(() => path ? pathChapters(path.id) : null, [path?.id])
  const route = useMemo(() => path ? pathBooks(path.id) : null, [path?.id])
  const rows = useMemo(() => path ? [...path.members].sort((a, b) => b.done - a.done || a.user_id - b.user_id) : [], [path])
  const members = useMemo<StripMember[]>(() => !path || !chapters ? [] : rows.map(m => {
    const ch = chapters[Math.min(Math.max(0, m.position - 1), chapters.length - 1)] ?? chapters[0]
    const who = byId.get(m.user_id)
    const name = who ? displayName(who) : `#${m.user_id}`
    return { key: m.user_id, book: ch?.[0] ?? 1, chapter: ch?.[1] ?? 1, initial: name.charAt(0).toUpperCase(), name, me: m.user_id === me.id }
  }), [path, chapters, rows, byId, me.id])
  const my = path?.members.find(m => m.user_id === me.id)
  const total = path ? pathLength(path.id) : 0
  const mineOnIt = !!(mine.state && path && mine.state.id === path.id)
  const takeOff = async () => {
    if (!(await confirmAsync(t('Take the path off the group?'), t('Everyone keeps what they have read.'), t('Take off')))) return
    await gp.setGroupPath(null)
  }
  const openBook = (book: number) => {
    // the viewer's first unread chapter of that book on the group's path, by their own path's reads when it is the same one
    const onBook = chapters?.filter(([b]) => b === book) ?? []
    const first = (mineOnIt ? onBook.find(([b, ch]) => !mine.readSet.has(chapterKey(b, ch))) : undefined) ?? onBook[0]
    if (first) router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(first[0]), chapter: String(first[1]) } })
  }
  if (!path && !isAdmin) return null
  return (
    <>
      <Row>
        <View style={{ flex: 1 }}><H2>{t('Path')}</H2></View>
        {isAdmin && path ? <Button title={t('Change')} small onPress={() => setChoosing(true)} /> : null}
      </Row>
      <FadeSwap k={path ? `${path.id}:${path.started_at}` : 'none'}>
        {path ? (
          <Card style={{ gap: SPACE.m }}>
            <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <T bold style={{ fontSize: TYPE.heading }}>{pathTitle(path.id)}</T>
                <T small muted>{pathBlurb(path.id)} {tn(total, '{n} chapter', '{n} chapters')}{path.target_date ? ` · ${t('finish by {day}', { day: fmtTargetDay(path.target_date) })}` : ''}</T>
              </View>
              {my ? <T bold style={{ fontSize: 20, fontVariant: ['tabular-nums'] }}>{t('{n} of {total}', { n: Math.min(my.position, total), total })}</T> : null}
            </Row>
            <PathStrip route={route} routeChapters={chapters} doneUpTo={my?.done ?? 0} members={members} onBook={openBook} delay={120}
              accessibilityLabel={tn(members.length, '{path}: {n} member on the path', '{path}: {n} members on the path', { path: pathTitle(path.id) })} />
            <View style={{ gap: 6 }}>
              {rows.map(m => {
                const who = byId.get(m.user_id)
                const ch = chapters?.[Math.min(m.position - 1, (chapters?.length ?? 1) - 1)]
                return (
                  <Row key={m.user_id} style={{ flexWrap: 'nowrap' }}>
                    <T style={{ flex: 1 }} numberOfLines={1}>{who ? displayName(who) : `#${m.user_id}`}{m.user_id === me.id ? <T muted> {t('(you)')}</T> : null}</T>
                    {ch && m.done < total ? <T small muted>{portionTitle({ book: ch[0], chapter: ch[1] })}</T> : <T small muted>{t('finished')}</T>}
                    <T small bold style={{ fontVariant: ['tabular-nums'], minWidth: 64, textAlign: 'right' }}>{t('{n} of {total}', { n: m.done, total })}</T>
                  </Row>
                )
              })}
            </View>
            {!mineOnIt ? (
              <Row>
                <Button title={mine.state ? t('Walk it too ({path} waits)', { path: pathTitle(mine.state) }) : t('Walk it too')} small onPress={() => void mine.start(path.id, { target_date: path.target_date })} />
                <T small muted style={{ flex: 1 }}>{t('Your own path follows the group’s; the group counts your reading either way.')}</T>
              </Row>
            ) : null}
            {isAdmin ? (
              <Row>
                <Button title={path.target_date ? t('Finish by {day}', { day: fmtTargetDay(path.target_date) }) : t('Finish by…')} small onPress={() => setDateOpen(true)} />
                <Button title={t('Take off')} small danger onPress={takeOff} />
              </Row>
            ) : null}
            {gp.error ? <ErrorText>{gp.error}</ErrorText> : null}
          </Card>
        ) : (
          <Card>
            <T muted>{t('Read a path together: one order for everyone, each at their own pace, every member’s place on the strip.')}</T>
            <Button title={t('Walk a path together')} onPress={() => setChoosing(true)} style={{ alignSelf: 'flex-start' }} />
            {gp.error ? <ErrorText>{gp.error}</ErrorText> : null}
          </Card>
        )}
      </FadeSwap>
      <ChoosePathSheet open={choosing} onClose={() => setChoosing(false)} current={path} onChoose={(id, target) => gp.setGroupPath(id, { target_date: target, restart: !!path && path.id !== id })} />
      <Sheet open={dateOpen} onClose={() => setDateOpen(false)} title={t('Finish by')}>
        <View style={{ paddingHorizontal: SPACE.l, paddingBottom: SPACE.s }}>
          {dateOpen && path ? <MonthPicker value={path.target_date} onPick={d => { setDateOpen(false); void gp.setGroupPath(path.id, { target_date: d }) }} /> : null}
        </View>
      </Sheet>
    </>
  )
}

/** Admins: a built-in path for the group, and optionally the day to finish by, in one sheet (the month grid in place). */
function ChoosePathSheet({ open, onClose, current, onChoose }: { open: boolean; onClose: () => void; current: GroupPathData | null; onChoose: (id: PathId, target: string | null) => Promise<void> }) {
  const c = useInks()
  const edition = useEdition()
  const [id, setId] = useState<PathId>(current?.id ?? 'gospels')
  const [target, setTarget] = useState<string | null>(current?.target_date ?? null)
  const [view, setView] = useState<'list' | 'date'>('list')
  const [busy, setBusy] = useState(false)
  const go = async () => { setBusy(true); try { await onChoose(id, target); onClose() } finally { setBusy(false) } }
  return (
    <Sheet open={open} onClose={onClose} onBack={view === 'date' ? () => setView('list') : undefined} title={view === 'date' ? t('Finish by') : t('Walk a path together')} maxHeight="88%">
      <ScrollView contentContainerStyle={{ paddingHorizontal: SPACE.l, paddingBottom: SPACE.s, gap: SPACE.m }}>
        <FadeSwap k={view}>
          {view === 'date' ? <MonthPicker value={target} onPick={d => { setTarget(d); setView('list') }} /> : (
            <View style={{ gap: SPACE.m }}>
              <View style={{ gap: 0 }}>
                {PATH_IDS.filter(p => pathOffered(p, edition)).map(p => <ListRow key={p} label={pathTitle(p)} icon={p === id ? 'check' : undefined} detail={tn(pathLength(p), '{n} chapter', '{n} chapters', { n: pathLength(p).toLocaleString(dateLocale() ?? 'en') })} onPress={() => setId(p)} />)}
              </View>
              <ListRow label={t('Finish by')} detail={target ? fmtTargetDay(target) : t('No date')} onPress={() => setView('date')} />
              {current && current.id !== id ? <T small muted style={{ color: c.muted }}>{t('A new path starts the group again from today; what members have read stays read.')}</T> : null}
              <Row style={{ justifyContent: 'flex-end' }}>
                <Button title={t('Cancel')} onPress={onClose} disabled={busy} />
                <Button title={current ? tc('verb', 'Set') : t('Start')} primary onPress={go} disabled={busy} />
              </Row>
            </View>
          )}
        </FadeSwap>
      </ScrollView>
    </Sheet>
  )
}

/** The groups list: the route of the path a group walks, small and plain (no reads are known there). */
export function GroupCardStrip({ path_id: stored }: { path_id: string | null | undefined }) {
  // the path the edition shows (editionCore.ts shownPathId), as the group's own page does
  const edition = useEdition()
  const path_id = stored ? shownPathId(stored, edition) : stored
  const route = useMemo(() => path_id && isPathId(path_id) ? pathBooks(path_id) : null, [path_id])
  if (!route || !path_id || !isPathId(path_id)) return null
  return <PathStrip compact route={route} readSet={null} accessibilityLabel={t('Walking {path}', { path: pathTitle(path_id) })} style={{ marginTop: 4 }} />
}
