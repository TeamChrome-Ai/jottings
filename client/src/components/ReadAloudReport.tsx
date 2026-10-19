import { useEffect, useState } from 'react'
import { AppState, Platform, View } from 'react-native'
import Constants from 'expo-constants'
import { errMsg, fmtWhen } from '../lib/community'
import { MESSAGE_MAX, appVersionLabel, sendFeedback } from '../lib/feedback'
import { markAsked, readAloudReport, troublesToAsk } from '../lib/readAloudLog'
import type { Trouble } from '../lib/readAloudLogCore'
import { useToast } from '../store/toast'
import { SheetBody } from './CommunityBits'
import { Button, ErrorText, Input, Row, Sheet, T } from './ui'

/** "In Psalm 118:12, 2 h ago, the voice stopped for a call and did not go on by itself." */
const said = (x: Trouble) => { const when = fmtWhen(new Date(x.t).toISOString()); return `${x.w ? `In ${x.w}, ${when}` : when[0].toUpperCase() + when.slice(1)}, ${x.what}.` }

/**
 * "Read aloud stopped": offered when the app comes to the front after a reading stopped by itself (the `troubles` of
 * lib/readAloudLogCore.ts), at most every three days. Send puts the read-aloud log into a feedback message; nothing is
 * sent without it. Mounted by the root layout; Android only, like the log.
 */
export default function ReadAloudReport() {
  const toast = useToast()
  const [found, setFound] = useState<Trouble[] | null>(null)
  const [words, setWords] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (Platform.OS !== 'android') return
    let live = true
    const check = () => { troublesToAsk().then(t => { if (live && t.length) { setFound(f => f ?? t); setErr(null) } }).catch(() => {}) }
    // after the first screen has settled, so the sheet never opens over the splash or the welcome
    const first = setTimeout(check, 4000)
    const sub = AppState.addEventListener('change', s => { if (s === 'active') check() })
    return () => { live = false; clearTimeout(first); sub.remove() }
  }, [])
  const close = () => { markAsked(); setFound(null); setWords('') }
  const send = async () => {
    if (!found) return
    setBusy(true); setErr(null)
    try {
      const diagnostics = await readAloudReport().catch(() => null)
      const message = ['Read aloud stopped by itself (sent from the app’s offer)', ...found.map(said), words.trim() ? `\n${words.trim()}` : ''].join('\n').trim().slice(0, MESSAGE_MAX)
      await sendFeedback({ message, app_version: appVersionLabel(Constants.expoConfig?.version, Constants.expoConfig?.android?.versionCode), platform: Platform.OS, ...(diagnostics ? { diagnostics } : {}) })
      close()
      toast.show('Sent. Thank you')
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  const latest = found?.[found.length - 1]
  return (
    <Sheet open={!!latest} onClose={close} title="Read aloud stopped">
      <SheetBody>
        {latest ? <T>{said(latest)}{found && found.length > 1 ? ` It stopped ${found.length === 2 ? 'once' : `${found.length - 1} times`} before that too.` : ''}</T> : null}
        <T small muted>It should have read on. Sending the details helps find out why: what read aloud did over the last two days, the phone’s model and Android version, and its battery settings for the app. Nothing you wrote goes with them.</T>
        <View style={{ gap: 4 }}>
          <T small muted>What was happening? (optional)</T>
          <Input placeholder="Driving, a call came in…" accessibilityLabel="What was happening (optional)" value={words} onChangeText={setWords} maxLength={500} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
        </View>
        {err && <ErrorText>{err}</ErrorText>}
        <Row style={{ justifyContent: 'flex-end' }}>
          <Button title="Not now" small onPress={close} disabled={busy} />
          <Button title={busy ? 'Sending…' : 'Send'} primary small onPress={() => { void send() }} disabled={busy} />
        </Row>
      </SheetBody>
    </Sheet>
  )
}
