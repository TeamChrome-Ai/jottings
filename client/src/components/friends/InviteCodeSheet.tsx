import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, View } from 'react-native'
import { acceptInvite, inviteUrl, newToken, tokenStatus, type InviteToken, type Person } from '../../lib/friends'
import { errMsg } from '../../lib/community'
import { shareText } from '../../lib/share'
import { useColors } from '../../hooks/useTheme'
import { useReduceMotion } from '../../store/prefs'
import { useToast } from '../../store/toast'
import { fixedSpeed } from '../motion/speed'
import { Swap } from '../motion/community'
import { Button, Card, Enter, ErrorText, Grow, Row, Sheet, Spinner, T, useSheetArrivalDelay } from '../ui'
import Avatar from '../Avatar'
import { QrCode } from './QrCode'
import { BRAND } from '@shared/brand'

const CODE = 232
const POLL_MS = 2500

/**
 * Your invite code: a QR code of a one-time link (10 minutes, one use, no handle in it) and the same link to share.
 * While it is open it watches the code: when someone scans it their invite appears here to accept on the spot.
 */
export default function InviteCodeSheet({ open, onClose, onFriend }: { open: boolean; onClose: () => void; onFriend?: (p: Person) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Your invite code">
      {open ? <Body onClose={onClose} onFriend={onFriend} /> : null}
    </Sheet>
  )
}

function Body({ onClose, onFriend }: { onClose: () => void; onFriend?: (p: Person) => void }) {
  const toast = useToast()
  const [tok, setTok] = useState<InviteToken | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [left, setLeft] = useState(0)
  const [scanned, setScanned] = useState<{ id: number; from: Person } | null>(null)
  const [done, setDone] = useState<Person | null>(null)
  const [busy, setBusy] = useState(false)
  const arrive = useSheetArrivalDelay()
  const make = useCallback(() => {
    setErr(null); setScanned(null); setDone(null)
    newToken().then(t => setTok(t)).catch(e => setErr(errMsg(e)))
  }, [])
  useEffect(() => { make() }, [make])
  // seconds left, from the server's own expiry
  useEffect(() => {
    if (!tok) return
    const end = Date.parse(tok.expires_at)
    const step = () => setLeft(Math.max(0, Math.round((end - Date.now()) / 1000)))
    step()
    const id = setInterval(step, 1000)
    return () => clearInterval(id)
  }, [tok])
  const expired = !!tok && left === 0
  // watch for a scan while the code is live and unanswered
  useEffect(() => {
    if (!tok || expired || scanned || done) return
    let live = true
    const id = setInterval(() => {
      tokenStatus(tok.token).then(s => {
        if (!live) return
        if (s.invite) setScanned(s.invite)
        else if (s.used && s.friends) setDone({ id: 0, handle: '', display_name: '' })
      }).catch(() => {})
    }, POLL_MS)
    return () => { live = false; clearInterval(id) }
  }, [tok, expired, scanned, done])
  const url = tok ? inviteUrl(tok.path) : ''
  const share = async () => {
    const r = await shareText({ title: `Be friends on ${BRAND.name}`, message: `Be my friend on ${BRAND.name}. This link works once, for 10 minutes:`, url })
    if (r === 'copied') toast.show('Link copied')
  }
  const accept = async () => {
    if (!scanned) return
    setBusy(true)
    try {
      const r = await acceptInvite(scanned.id)
      setDone(r.friend); onFriend?.(r.friend)
      toast.show(`You and ${r.friend.display_name} are friends`)
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  const mins = Math.floor(left / 60), secs = String(left % 60).padStart(2, '0')
  return (
    <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 14, alignItems: 'center' }}>
      <T small muted style={{ alignSelf: 'stretch' }}>Let a friend scan this with {BRAND.name}, or share the link. It works once, for 10 minutes.</T>
      {err ? <View style={{ alignSelf: 'stretch' }}><ErrorText>{err}</ErrorText></View> : null}
      {/* the code's place is held from the first frame, so the sheet rises once to its full height */}
      <View style={{ width: CODE, height: CODE }}>
        {tok ? (
          <Grow from={0.94} delay={arrive}>
            <View>
              <QrCode text={url} size={CODE} reveal={tok.token} dim={expired || !!scanned || !!done} />
              {expired && !scanned && !done ? (
                <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <Button primary small title="New code" onPress={make} />
                </View>
              ) : null}
            </View>
          </Grow>
        ) : !err ? <View style={{ flex: 1, justifyContent: 'center' }}><Spinner /></View> : null}
      </View>
      {!scanned && !done ? <Countdown key={tok?.token ?? 'none'} total={tok?.ttl_secs ?? 600} end={tok ? Date.parse(tok.expires_at) : null} delay={arrive + 200} label={!tok ? ' ' : expired ? 'This code has expired' : `${mins}:${secs} left`} /> : null}
      {scanned && !done ? (
        <Grow from={0.9} style={{ alignSelf: 'stretch' }}>
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar name={scanned.from.display_name} avatar={scanned.from.avatar} size={40} />
            <View style={{ flex: 1 }}>
              <T bold>{scanned.from.display_name}</T>
              <T small muted>@{scanned.from.handle} scanned your code</T>
            </View>
            <Button primary small title={busy ? 'Accepting…' : 'Accept'} disabled={busy} onPress={() => { void accept() }} />
          </Card>
        </Grow>
      ) : null}
      {done ? (
        <Swap k="done" style={{ alignSelf: 'stretch' }}>
          <Card tone="soft" style={{ alignItems: 'center' }}>
            <T bold>{done.display_name ? `You and ${done.display_name} are friends` : 'You are friends now'}</T>
            <Button small title="Done" onPress={onClose} />
          </Card>
        </Swap>
      ) : null}
      {!done ? (
        <Row style={{ alignSelf: 'stretch', justifyContent: 'center' }}>
          <Button title="Share link" small onPress={() => { void share() }} disabled={!tok || expired} accessibilityLabel="Share the invite link" />
          {scanned ? <Button title="Not now" small onPress={onClose} /> : null}
        </Row>
      ) : null}
    </View>
  )
}

/** Time left on the code: a thin bar draining in real time (the animation speed does not touch a clock) and a label. */
function Countdown({ total, end, label, delay }: { total: number; end: number | null; label: string; delay: number }) {
  const c = useColors()
  const reduce = useReduceMotion()
  const share = () => end == null ? 0 : Math.max(0, Math.min(1, (end - Date.now()) / 1000 / total))
  const v = useRef(new Animated.Value(share())).current
  useEffect(() => {
    if (end == null) return
    // under Reduce animation the bar steps with the label, once a second
    if (reduce) { const id = setInterval(() => v.setValue(share()), 1000); return () => clearInterval(id) }
    v.setValue(share())
    const a = Animated.timing(v, fixedSpeed({ toValue: 0, duration: Math.max(0, end - Date.now()), easing: Easing.linear, useNativeDriver: true }))
    a.start()
    return () => a.stop()
    // one drain per code
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [end, reduce, v])
  const scaleX = useMemo(() => v.interpolate({ inputRange: [0, 1], outputRange: [0.0001, 1], extrapolate: 'clamp' }), [v])
  return (
    <Enter delay={delay} rise={4} style={{ alignSelf: 'stretch', gap: 6, alignItems: 'center' }}>
      <View style={{ width: CODE, height: 4, borderRadius: 2, backgroundColor: c.border, overflow: 'hidden' }}>
        <Animated.View style={{ width: CODE, height: 4, backgroundColor: c.accent, transformOrigin: 'left', transform: [{ scaleX }] }} />
      </View>
      <T small muted style={{ fontVariant: ['tabular-nums'] }}>{label}</T>
    </Enter>
  )
}
