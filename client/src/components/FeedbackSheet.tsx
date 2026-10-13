import { useEffect, useState } from 'react'
import { Platform, View } from 'react-native'
import Constants from 'expo-constants'
import { errMsg } from '../lib/community'
import { MESSAGE_MAX, appVersionLabel, feedbackBody, sendFeedback } from '../lib/feedback'
import { useAuth } from '../store/auth'
import { useToast } from '../store/toast'
import { SheetBody } from './CommunityBits'
import { Button, ErrorText, Input, Row, Sheet, T } from './ui'

/** A message to the developer, signed in or not. State resets on every open. */
export default function FeedbackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const { user } = useAuth()
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (open) { setMessage(''); setEmail(''); setErr(null); setBusy(false) } }, [open])

  const version = appVersionLabel(Constants.expoConfig?.version, Constants.expoConfig?.android?.versionCode)
  const body = feedbackBody(message, email, version, Platform.OS)
  const send = async () => {
    if (!body) return
    setBusy(true); setErr(null)
    try {
      await sendFeedback(body)
      toast.show('Sent. Thank you')
      onClose()
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Send feedback">
      <SheetBody>
        <T small muted>A fault, a wish or a kind word: it goes to the developer and nowhere else.</T>
        <View style={{ gap: 4 }}>
          <Input placeholder="Your message" accessibilityLabel="Your message" value={message} onChangeText={setMessage} maxLength={MESSAGE_MAX} multiline style={{ minHeight: 120, textAlignVertical: 'top' }} />
          <T small muted style={{ textAlign: 'right' }}>{message.length} / {MESSAGE_MAX}</T>
        </View>
        <View style={{ gap: 4 }}>
          <T small muted>Email, if you would like a reply (optional)</T>
          <Input placeholder="you@example.com" accessibilityLabel="Email (optional)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" maxLength={254} />
        </View>
        {err && <ErrorText>{err}</ErrorText>}
        <Row style={{ justifyContent: 'flex-end' }}>
          <Button title="Cancel" small onPress={onClose} disabled={busy} />
          <Button title={busy ? 'Sending…' : 'Send'} primary small onPress={() => { void send() }} disabled={busy || !body} />
        </Row>
        <T small muted>Sent with {user ? `your handle (@${user.handle}), ` : ''}the app version and the platform, so a fault can be traced.</T>
      </SheetBody>
    </Sheet>
  )
}
