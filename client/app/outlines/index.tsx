import { useCallback, useState } from 'react'
import { Animated, Pressable, View } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import type { Outline } from '@shared/types'
import { createOutline, listOutlines } from '../../src/lib/library'
import { fmtDate } from '../../src/lib/format'
import { isLocalOutline, visibilityLabel } from '../../src/lib/outlines'
import { useAuth } from '../../src/store/auth'
import { useMergeTick } from '../../src/hooks/useLocalLibraryMerge'
import { useColors } from '../../src/hooks/useTheme'
import { Button, Card, Enter, ErrorText, Input, Row, Screen, Spinner, T, tick } from '../../src/components/ui'
import { Stagger, usePressScale } from '../../src/components/motion/nav'
import { tourRef, useTourSample } from '../../src/store/tour'
import SignInCard from '../../src/components/SignInCard'
import { NOUN } from '@shared/brand'

export default function Outlines() {
  const { user, ready } = useAuth()
  return (
    <Screen>
      <Stack.Screen options={{ title: NOUN.Many }} />
      {ready && !user ? (
        <SignInCard text="Kept on this device. Sign in to keep them with your account and share them by link." />
      ) : null}
      {ready ? <Mine signedIn={!!user} /> : <Spinner />}
      <T small muted>Your {NOUN.many} are private until you share one by link or post it to a group.</T>
      <View style={{ height: 24 }} />
    </Screen>
  )
}

function Mine({ signedIn }: { signedIn: boolean }) {
  const router = useRouter()
  const [list, setList] = useState<Outline[] | null>(null)
  const [err, setErr] = useState('')
  const [title, setTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const merged = useMergeTick()
  // the full tour's sample outline, which it points at
  const sample = useTourSample()
  useFocusEffect(useCallback(() => {
    let cancelled = false
    setErr('')
    listOutlines().then(l => { if (!cancelled) setList(l) }).catch(e => { if (!cancelled) setErr((e as Error).message) })
    return () => { cancelled = true }
  }, [signedIn, merged, sample]))
  const create = async () => {
    const t = title.trim()
    if (!t || creating) return
    setCreating(true); setErr('')
    try {
      const o = await createOutline({ title: t })
      setTitle('')
      router.push({ pathname: '/outlines/[id]/edit', params: { id: String(o.id) } })
    } catch (e) { setErr((e as Error).message) } finally { setCreating(false) }
  }
  const openView = (o: Outline) => router.push({ pathname: '/outlines/[id]', params: { id: String(o.id) } })
  const openEdit = (o: Outline) => router.push({ pathname: '/outlines/[id]/edit', params: { id: String(o.id) } })
  return (
    <>
      <Row ref={tourRef('outlines-new')}>
        <Input placeholder={`New ${NOUN.one} title`} value={title} onChangeText={setTitle} onSubmitEditing={() => { void create() }} returnKeyType="done" style={{ flex: 1, minWidth: 160 }} maxLength={160} />
        <Button primary title={creating ? 'Creating…' : `New ${NOUN.one}`} disabled={creating || !title.trim()} onPress={() => { void create() }} />
      </Row>
      {err ? <ErrorText>{err}</ErrorText> : null}
      {list === null && !err ? <Spinner /> : null}
      {list?.length === 0 ? <Enter><T muted>No {NOUN.many} yet. Type a title above, or select verses in the reader and tap {NOUN.verb}.</T></Enter> : null}
      {list?.map((o, i) => (
        <Stagger key={o.id} index={i}>
          <OutlineCard outline={o} sample={o.id === sample} onView={() => openView(o)} onEdit={() => openEdit(o)} />
        </Stagger>
      ))}
    </>
  )
}

/** The card body and the Edit button are siblings (a button inside a button is invalid HTML on web); pressing the body dips the whole card. */
function OutlineCard({ outline: o, sample, onView, onEdit }: { outline: Outline; sample: boolean; onView: () => void; onEdit: () => void }) {
  const c = useColors()
  const press = usePressScale(0.98)
  return (
    <Animated.View style={press.style}>
      <Card ref={sample ? tourRef('outlines-sample') : undefined} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <Pressable {...press.handlers} onPress={() => { tick(); onView() }} accessibilityRole="button" style={{ flex: 1, gap: 6 }}>
          <T bold numberOfLines={2}>{o.title}</T>
          {o.description ? <T small muted numberOfLines={2}>{o.description}</T> : null}
          <Row>
            <T small muted>{verseCount(o)}</T>
            <T small style={{ color: o.visibility === 'private' ? c.muted : c.accent }}>· {isLocalOutline(o) ? 'On this device' : visibilityLabel(o.visibility)}</T>
            <T small muted>· {fmtDate(o.updated_at)}</T>
          </Row>
        </Pressable>
        <Button small title="Edit" onPress={onEdit} />
      </Card>
    </Animated.View>
  )
}

/** `verse_count` rides on the "mine" list only; the API leaves it out elsewhere. */
function verseCount(o: Outline): string {
  const n = (o as Outline & { verse_count?: number }).verse_count
  if (typeof n !== 'number') return ''
  return n === 1 ? '1 verse' : `${n} verses`
}

