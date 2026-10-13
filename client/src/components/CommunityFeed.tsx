import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Outline, User } from '@shared/types'
import { del, get, post } from '../lib/api'
import { adminMode, confirmAsync, displayName, errMsg, fmtWhen, useLoad, type FeedPost, type GroupDetail } from '../lib/community'
import { blockUser, resolveUserId, type ReportTarget } from '../lib/moderation'
import { useToast } from '../store/toast'
import { AdminBadge, SheetBody, UserLink } from './CommunityBits'
import { visibilityLabel } from '../lib/outlines'
import ReportSheet from './ReportSheet'
import Avatar from './Avatar'
import { Button, Card, Chip, ErrorText, H2, Input, ListRow, Row, Sheet, Spinner, T } from './ui'
import { BusyDots, MotionItem, useArrivals } from './motion/community'
import { NOUN } from '@shared/brand'

/** Screen's column gap; a leaving post absorbs it so the list closes without a jump. */
const GAP = 12

/** Group feed: newest 100 posts, a composer, delete for the author (admins: any post), report/block on others' posts. */
export function Feed({ group, me }: { group: GroupDetail; me: User }) {
  const router = useRouter()
  const toast = useToast()
  const { state, reload, mutate } = useLoad(() => get<FeedPost[]>(`/groups/${group.slug}/feed`), [group.slug])
  const [err, setErr] = useState<string | null>(null)
  const [menuFor, setMenuFor] = useState<FeedPost | null>(null)
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [blocking, setBlocking] = useState(false)
  // posts collapsing out; they leave the data once the animation is done
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set())
  // reported in this visit: hidden for the reporter even if the server keeps them up pending review
  const [reported, setReported] = useState<ReadonlySet<number>>(new Set())
  const posts = state.kind === 'ready' ? state.data.filter(p => !reported.has(p.id) || leaving.has(p.id)) : null
  const arrivals = useArrivals(posts ? posts.map(p => p.id) : null)
  const isAdmin = group.role === 'admin'
  const leave = (ids: number[]) => setLeaving(s => new Set([...s, ...ids]))
  const gone = (id: number) => {
    mutate(ps => ps.filter(x => x.id !== id))
    setLeaving(s => { const n = new Set(s); n.delete(id); return n })
  }
  const remove = async (p: FeedPost) => {
    if (!(await confirmAsync('Delete this post?', undefined, 'Delete'))) return
    try { await del(`/groups/${group.slug}/posts/${p.id}`); leave([p.id]) } catch (e) { setErr(errMsg(e)) }
  }
  const block = async (p: FeedPost) => {
    if (!(await confirmAsync(`Block @${p.handle}?`, `Their posts and shared ${NOUN.many} disappear from your feeds. You can unblock them in Settings.`, 'Block'))) return
    setBlocking(true)
    try {
      await blockUser(await resolveUserId(p))
      if (state.kind === 'ready') leave(state.data.filter(x => x.handle === p.handle).map(x => x.id))
      setMenuFor(null)
      toast.show(`Blocked @${p.handle}`)
    } catch (e) { setErr(errMsg(e)); setMenuFor(null) } finally { setBlocking(false) }
  }
  return (
    <>
      <H2>Feed</H2>
      <Card>
        {adminMode(me) ? <NoticeForm slug={group.slug} onPosted={id => { arrivals.expect(id); reload() }} /> : null}
        <PostForm slug={group.slug} onPosted={id => { arrivals.expect(id); reload() }} />
      </Card>
      {err && <ErrorText>{err}</ErrorText>}
      {state.kind === 'loading' && <Spinner />}
      {state.kind === 'error' && <ErrorText>{state.message}</ErrorText>}
      {posts && posts.length === 0 && <T small muted>Nothing shared yet. Share {NOUN.a} with the group.</T>}
      {posts && posts.map((p, i) => {
        const mine = p.handle === me.handle
        return (
          <MotionItem key={p.id} {...arrivals.modeFor(p.id, i)} gap={GAP} leaving={leaving.has(p.id)} onGone={() => gone(p.id)}>
            <Pressable onLongPress={mine ? undefined : () => setMenuFor(p)} delayLongPress={400}>
              <Card>
                <Row>
                  <Avatar name={displayName(p)} avatar={p.avatar} size={28} />
                  <UserLink handle={p.handle} name={displayName(p)} bold />
                  {p.staff ? <AdminBadge /> : null}
                  <T small muted>{fmtWhen(p.created_at)}</T>
                  <View style={{ flex: 1 }} />
                  {(isAdmin || mine) && <Button title="Delete" small danger onPress={() => remove(p)} />}
                  {!mine && <Button title="Post options" small iconName="more" onPress={() => setMenuFor(p)} />}
                </Row>
                {p.notice ? <T selectable>{p.body}</T> : null}
                {p.hidden ? <T small muted>Hidden by moderation: only its author and an admin see it.</T> : null}
                {p.outline_id != null && (p.share_code
                  ? <View style={{ alignSelf: 'flex-start' }}><Chip label={p.outline_title ?? 'Outline'} detail="Outline" accessibilityLabel={`Open the outline ${p.outline_title ?? ''}`} onPress={() => router.push(`/o/${p.share_code}`)} /></View>
                  : <T small muted>{p.outline_title ?? NOUN.A}, no longer shared</T>)}
              </Card>
            </Pressable>
          </MotionItem>
        )
      })}
      <Sheet open={menuFor !== null} onClose={() => setMenuFor(null)} title={menuFor ? `Post by @${menuFor.handle}` : undefined}>
        <SheetBody>
          {menuFor && (
            <>
              <Button title="Report post" onPress={() => { setReport({ kind: 'post', id: menuFor.id, label: 'post' }); setMenuFor(null) }} />
              <Button title={blocking ? 'Blocking…' : `Block @${menuFor.handle}`} danger disabled={blocking} onPress={() => { void block(menuFor) }} />
              <Button title="Cancel" onPress={() => setMenuFor(null)} />
            </>
          )}
        </SheetBody>
      </Sheet>
      <ReportSheet target={report} onClose={() => setReport(null)}
        onReported={t => { if (t.kind === 'post') { setReported(s => new Set([...s, t.id])); leave([t.id]) } }} />
    </>
  )
}

/** A site admin in Admin mode writes to the group in words: the one post that is not a jotting (rs/src/groups.rs post_create). */
function NoticeForm({ slug, onPosted }: { slug: string; onPosted: (id: number) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setErr(null)
    try { const r = await post<{ id: number }>(`/groups/${slug}/posts`, { body: text.trim() }); setText(''); onPosted(r.id) }
    catch (ex) { setErr(errMsg(ex)) } finally { setBusy(false) }
  }
  return (
    <View style={{ gap: 8 }}>
      <Input placeholder="A notice to the group, under your Developer badge" value={text} onChangeText={setText} maxLength={2000} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
      <Row>
        <View style={{ flex: 1 }} />
        <Button title={busy ? 'Posting…' : 'Post notice'} primary small onPress={submit} disabled={busy || !text.trim()} />
      </Row>
      {err && <ErrorText>{err}</ErrorText>}
    </View>
  )
}

function PostForm({ slug, onPosted }: { slug: string; onPosted: (id: number) => void }) {
  const [outline, setOutline] = useState<Outline | null>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await post<{ id: number }>(`/groups/${slug}/posts`, { outline_id: outline?.id ?? null })
      setOutline(null); onPosted(r.id)
    } catch (ex) { setErr(errMsg(ex)) } finally { setBusy(false) }
  }
  const canPost = outline !== null
  return (
    <View style={{ gap: 8 }}>
      <Row>
        {outline
          ? <Button small lead="x" title={outline.title} accessibilityLabel={`Remove the ${NOUN.one} ${outline.title}`} onPress={() => setOutline(null)} style={{ flexShrink: 1 }} />
          : <Button title={`Choose ${NOUN.a}`} small onPress={() => setPicking(true)} />}
        <View style={{ flex: 1 }} />
        {busy && <BusyDots />}
        <Button title={busy ? 'Sharing…' : 'Share'} primary small onPress={submit} disabled={busy || !canPost} accessibilityState={{ busy, disabled: busy || !canPost }} />
      </Row>
      {err && <ErrorText>{err}</ErrorText>}
      <OutlinePicker open={picking} onClose={() => setPicking(false)} onPick={o => { setOutline(o); setPicking(false) }} />
    </View>
  )
}

/** My outlines (GET /outlines). Posting a private one flips it to link-shared server-side, so say so. */
function OutlinePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (o: Outline) => void }) {
  const { state } = useLoad(() => get<Outline[]>('/outlines'), [], open)
  return (
    <Sheet open={open} onClose={onClose} title={`Share ${NOUN.a}`}>
      <SheetBody>
        {state.kind === 'loading' && <Spinner />}
        {state.kind === 'error' && <ErrorText>Could not load your {NOUN.many}: {state.message}</ErrorText>}
        {state.kind === 'ready' && state.data.length === 0 && <T muted>You have no {NOUN.many} yet.</T>}
        {state.kind === 'ready' && state.data.length ? (
          <Card style={{ gap: 0, paddingVertical: 8 }}>
            {state.data.map(o => <ListRow key={o.id} label={o.title} detail={o.visibility === 'private' ? 'Private: sharing it here shares it by link' : visibilityLabel(o.visibility)} onPress={() => onPick(o)} />)}
          </Card>
        ) : null}
      </SheetBody>
    </Sheet>
  )
}
