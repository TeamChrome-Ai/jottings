import { useCallback, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import type { Bookmark } from '@shared/types'
import { listBookmarks, removeBookmark } from '../src/lib/library'
import { bookmarkKind, bookmarkPlace, bookmarkTitle, groupBookmarks } from '../src/lib/bookmarks'
import { localPosition } from '../src/hooks/usePosition'
import { fmtDate } from '../src/lib/format'
import { useAuth } from '../src/store/auth'
import { useMergeTick } from '../src/hooks/useLocalLibraryMerge'
import { useInks } from '../src/hooks/useTheme'
import { Card, Enter, ErrorText, H2, Screen, SPACE, Spinner, T, Tap } from '../src/components/ui'
import Icon from '../src/components/Icon'
import SignInCard from '../src/components/SignInCard'
import { Collapse, Stagger, useReduceMotion } from '../src/components/motion/nav'
import { t } from '@shared/i18n'

const NOTHING = () => {}

export default function Bookmarks() {
  const router = useRouter()
  const { user, ready } = useAuth()
  const c = useInks()
  const [list, setList] = useState<Bookmark[] | null>(null)
  const [err, setErr] = useState('')
  const merged = useMergeTick()
  useFocusEffect(useCallback(() => {
    if (!ready) return
    let cancelled = false
    setErr('')
    listBookmarks().then(l => { if (!cancelled) setList(l) }).catch(e => { if (!cancelled) setErr((e as Error).message) })
    return () => { cancelled = true }
  }, [ready, user, merged]))
  const reduce = useReduceMotion()
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set())
  const drop = (id: number) => { setList(l => (l ?? []).filter(x => x.id !== id)); setLeaving(s => { const n = new Set(s); n.delete(id); return n }) }
  /**
   * The row collapses out first, absorbing the screen's gap so nothing jumps when it leaves the list (instantly under
   * Reduce animation); the delete request goes out at once either way.
   */
  const remove = async (b: Bookmark) => {
    if (reduce) drop(b.id); else setLeaving(s => new Set(s).add(b.id))
    await removeBookmark(b.id).catch(() => {})
  }
  /** A verse at the verse, a chapter at its top, a book where you last were in it (else its first chapter). */
  const open = async (b: Bookmark) => {
    const p = bookmarkPlace(b, bookmarkKind(b) === 'book' ? await localPosition() : null)
    router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(p.book), chapter: String(p.chapter), v: p.verse ? String(p.verse) : '' } })
  }

  // one entrance down the whole screen: each heading and row takes the next step
  let step = 0
  const enter = (key: string | number, gone: boolean, node: ReactNode, onDone: () => void) =>
    gone ? <Collapse key={key} gap={SPACE.l} onDone={onDone}>{node}</Collapse> : <Stagger key={key} index={step++}>{node}</Stagger>
  return (
    <Screen>
      {ready && !user ? (
        <SignInCard text={t('Kept on this device. Sign in to keep them with your account.')} />
      ) : null}
      {err ? <ErrorText>{err}</ErrorText> : null}
      {list === null && !err && <Spinner />}
      {list?.length === 0 && <Enter><T muted>{t('No bookmarks yet. Select a verse in the reader and tap Bookmark, or hold a book or chapter in the picker.')}</T></Enter>}
      {list && groupBookmarks(list).flatMap(g => [
        // the heading folds away with the group's last row
        enter(g.kind, g.items.every(b => leaving.has(b.id)), <H2>{g.title}</H2>, NOTHING),
        ...g.items.map(b => {
          const title = bookmarkTitle(b)
          return enter(b.id, leaving.has(b.id), (
            <Tap onPress={() => { void open(b) }} scaleTo={0.98}>
              <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <T bold>{title}</T>
                  <T small muted>{b.label ? `${b.label} · ` : ''}{fmtDate(b.created_at)}</T>
                </View>
                <Tap onPress={() => { void remove(b) }} disabled={leaving.has(b.id)} scaleTo={0.86} hitSlop={6} accessibilityRole="button" accessibilityLabel={t('Remove the bookmark at {title}', { title })}
                  style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
                  <Icon name="x" size={16} color={c.muted} />
                </Tap>
              </Card>
            </Tap>
          ), () => drop(b.id))
        }),
      ])}
    </Screen>
  )
}
