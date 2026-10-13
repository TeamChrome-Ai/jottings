import { useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { markRepliesSeen, myReplies, type MyReply } from '../lib/feedback'
import { useAuth } from '../store/auth'
import { SheetBody } from './CommunityBits'
import { Button, Card, Sheet, T } from './ui'

/**
 * The developer's answers to feedback the reader sent (rs/src/feedback.rs): asked for when a signed-in reader opens
 * the app or comes back to it, at most every ten minutes, and shown once in a sheet. Closing it marks them seen.
 * Mounted by the root layout; a reader without an account has no answers to fetch.
 */
const EVERY_MS = 10 * 60_000

export default function FeedbackReplies() {
  const { user, ready } = useAuth()
  const [shown, setShown] = useState<MyReply[] | null>(null)
  const last = useRef(0)
  useEffect(() => {
    if (!ready || !user) return
    let live = true
    const check = () => {
      if (Date.now() - last.current < EVERY_MS) return
      last.current = Date.now()
      myReplies().then(r => { if (live && r.unseen > 0) setShown(r.replies.filter(x => !x.seen)) }).catch(() => { /* offline, or an older server: nothing to show */ })
    }
    check()
    const sub = AppState.addEventListener('change', s => { if (s === 'active') check() })
    return () => { live = false; sub.remove() }
  }, [ready, user?.id])  // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => { setShown(null); markRepliesSeen().catch(() => {}) }
  return (
    <Sheet open={!!shown?.length} onClose={close} title={shown && shown.length > 1 ? 'Answers to your feedback' : 'An answer to your feedback'}>
      <SheetBody>
        {(shown ?? []).map(r => (
          <Card key={r.id}>
            <T small muted numberOfLines={3}>You wrote: “{r.message}”</T>
            <T selectable>{r.reply}</T>
          </Card>
        ))}
        <Button title="OK" primary onPress={close} />
      </SheetBody>
    </Sheet>
  )
}
