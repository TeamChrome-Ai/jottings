import { useState } from 'react'
import { Linking, View } from 'react-native'
import { Redirect, Stack } from 'expo-router'
import { Tag, UserLink } from '../../src/components/CommunityBits'
import { Button, Card, ErrorText, Input, Row, Screen, Sheet, Spinner, T } from '../../src/components/ui'
import { SheetBody } from '../../src/components/CommunityBits'
import { BusyDots, MotionItem, useArrivals } from '../../src/components/motion/community'
import { confirmAsync, errMsg, fmtWhen, useLoad } from '../../src/lib/community'
import { REPLY_MAX, THANKS, adminFeedback, deleteFeedback, replyFeedback, type FeedbackRow } from '../../src/lib/feedback'
import { useAuth } from '../../src/store/auth'
import { useToast } from '../../src/store/toast'
import { BRAND } from '@shared/brand'

/** Admin inbox for POST /feedback, newest first. Non-admins are sent home; the server enforces the same rule. */
export default function AdminFeedbackScreen() {
  const { user, ready } = useAuth()
  const isAdmin = !!user?.is_admin
  if (ready && !isAdmin) return <Redirect href="/" />
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: 'Feedback' }} />
      {isAdmin ? <Inbox /> : <Spinner />}
    </Screen>
  )
}

function Inbox() {
  const toast = useToast()
  const { state, reload, mutate } = useLoad(() => adminFeedback(), [])
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set())
  const arrivals = useArrivals(state.kind === 'ready' ? state.data.map(r => r.id) : null)
  const gone = (id: number) => {
    mutate(rs => rs.filter(x => x.id !== id))
    setLeaving(s => { const n = new Set(s); n.delete(id); return n })
  }
  const [writing, setWriting] = useState<FeedbackRow | null>(null)
  const [text, setText] = useState('')
  // the answer waits in the sender's app (an account), told to them on their next visit; without one there is only email
  const answer = async (r: FeedbackRow, body: { thanks: true } | { text: string }) => {
    setBusy(r.id); setErr(null)
    try {
      await replyFeedback(r.id, body)
      const reply = 'thanks' in body ? THANKS : body.text.trim()
      mutate(rs => rs.map(x => x.id === r.id ? { ...x, reply, replied_at: new Date().toISOString(), reply_seen: false } : x))
      toast.show(`Sent to @${r.user?.handle ?? ''}`); setWriting(null); setText('')
    } catch (e) { setErr(errMsg(e)); toast.show(`Not sent: ${errMsg(e)}`) } finally { setBusy(null) }
  }
  const remove = async (r: FeedbackRow) => {
    if (!(await confirmAsync('Delete this message?', 'It is removed for good.', 'Delete'))) return
    setBusy(r.id); setErr(null)
    try {
      await deleteFeedback(r.id)
      toast.show('Deleted')
      setLeaving(s => new Set(s).add(r.id))
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(null) }
  }
  return (
    <>
      {err && <ErrorText>{err}</ErrorText>}
      {state.kind === 'loading' && <Spinner />}
      {state.kind === 'error' && <Card><ErrorText>{state.message}</ErrorText><Button small title="Retry" onPress={reload} style={{ alignSelf: 'flex-start' }} /></Card>}
      {state.kind === 'ready' && state.data.length === 0 && <T muted>No feedback yet.</T>}
      {state.kind === 'ready' && state.data.map((r, i) => (
        <MotionItem key={r.id} {...arrivals.modeFor(r.id, i)} gap={12} leaving={leaving.has(r.id)} onGone={() => gone(r.id)}>
          <Card>
            <Row>
              {r.user ? <UserLink handle={r.user.handle} name={`@${r.user.handle}`} small /> : <Tag label="Signed out" />}
              {r.platform ? <Tag label={r.platform} /> : null}
              {r.app_version ? <Tag label={r.app_version} /> : null}
              <View style={{ flex: 1 }} />
              <T small muted>{fmtWhen(r.created_at)}</T>
            </Row>
            <T selectable>{r.message}</T>
            {r.reply ? <T small muted>You answered: “{r.reply}” {r.reply_seen ? '(seen)' : '(not seen yet)'}</T> : null}
            {r.user ? (
              <Row>
                <Button small primary={!r.reply} title="Thank: fix in next update" disabled={busy !== null} onPress={() => { void answer(r, { thanks: true }) }} />
                <Button small title={r.reply ? 'Change answer' : 'Write an answer'} disabled={busy !== null} onPress={() => { setText(r.reply ?? ''); setWriting(r) }} />
              </Row>
            ) : null}
            <Row>
              {r.email ? <Button small title={`Email ${r.email}`} onPress={() => { Linking.openURL(`mailto:${r.email}?subject=${encodeURIComponent(`Your ${BRAND.name} feedback`)}&body=${encodeURIComponent(THANKS)}`).catch(() => {}) }} /> : <T small muted>{r.user ? 'Answers reach them in the app.' : 'Signed out and no email: no way to answer.'}</T>}
              <View style={{ flex: 1 }} />
              <Button small danger title="Delete" disabled={busy !== null || leaving.size > 0} onPress={() => { void remove(r) }} />
              {busy === r.id && <BusyDots />}
            </Row>
          </Card>
        </MotionItem>
      ))}
      <Sheet open={writing !== null} onClose={() => setWriting(null)} title={writing?.user ? `Answer @${writing.user.handle}` : undefined}>
        <SheetBody>
          <Input placeholder={`Your answer; they see it the next time they open ${BRAND.name}`} value={text} onChangeText={setText} maxLength={REPLY_MAX} multiline style={{ minHeight: 90, textAlignVertical: 'top' }} />
          <Row style={{ justifyContent: 'flex-end' }}>
            <Button title="Cancel" onPress={() => setWriting(null)} />
            <Button title="Send" primary disabled={busy !== null || !text.trim()} onPress={() => { if (writing) void answer(writing, { text }) }} />
          </Row>
        </SheetBody>
      </Sheet>
    </>
  )
}
