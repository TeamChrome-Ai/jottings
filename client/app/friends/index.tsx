import { useEffect, useState } from 'react'
import { Platform, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { inviteToken } from '@shared/friends'
import { useAuth } from '../../src/store/auth'
import { useToast } from '../../src/store/toast'
import { errMsg, fmtWhen, useLoad } from '../../src/lib/community'
import { acceptInvite, cancelInvite, declineInvite, loadFriends, peekToken, redeemToken, sendInvite, type FriendsOverview, type IncomingInvite } from '../../src/lib/friends'
import { useColors } from '../../src/hooks/useTheme'
import Avatar from '../../src/components/Avatar'
import Icon from '../../src/components/Icon'
import { MotionItem, Swap, useArrivals } from '../../src/components/motion/community'
import { FriendCard, useNewFriends } from '../../src/components/friends/FriendCard'
import { friendItems, useKeptMoments } from '../../src/components/friends/Seal'
import InviteCodeSheet from '../../src/components/friends/InviteCodeSheet'
import FriendsSettingsSheet from '../../src/components/friends/FriendsSettingsSheet'
import SignInCard from '../../src/components/SignInCard'
import { Button, Card, Enter, ErrorText, H2, Input, ListRow, Row, Screen, Spinner, T, Tap } from '../../src/components/ui'
import { tourRef } from '../../src/store/tour'
import { noteInvitesShown, onInviteNews } from '../../src/lib/inviteNotice'

const GAP = 16

/**
 * Friends: invites waiting for you, your friends with their friend streaks, adding someone (their exact handle, your
 * code, a code of theirs, your contacts) and the invites you have sent. Nothing here can be searched or browsed: a
 * friend is always someone you already know.
 */
export default function FriendsScreen() {
  const router = useRouter()
  const { user, ready } = useAuth()
  const params = useLocalSearchParams<{ t?: string | string[] }>()
  const raw = Array.isArray(params.t) ? params.t[0] : params.t
  const token = raw ? inviteToken(raw) : null
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: 'Friends' }} />
      {!ready ? <Spinner /> : null}
      {ready && !user ? (
        <Enter>
          <SignInCard ref={tourRef('friends-signin')} title="Read alongside friends" text="Friends see each other’s streak, week and badges. No messages, and nobody finds you without your handle.">
            {token ? <T small muted>The invite code you opened will be waiting after you sign in.</T> : null}
          </SignInCard>
        </Enter>
      ) : null}
      {ready && user ? <Signed token={token} clearToken={() => router.setParams({ t: '' })} uid={user.id} /> : null}
    </Screen>
  )
}

function Signed({ token, clearToken, uid }: { token: string | null; clearToken: () => void; uid: number }) {
  const router = useRouter()
  const toast = useToast()
  const { state, reload, mutate } = useLoad(loadFriends, [uid])
  const [code, setCode] = useState(false)
  const [settings, setSettings] = useState(false)
  const data = state.kind === 'ready' ? state.data : null
  const moments = useKeptMoments(uid, friendItems(data?.friends ?? null))
  const fresh = useNewFriends(uid, data ? data.friends.map(f => f.id) : null)
  const friends = useArrivals(data && moments ? data.friends.map(f => f.id) : null)
  // a friend made here (an accept, a code scanned) opens into the list with a wash, like one found on arrival
  const [made, setMade] = useState<ReadonlySet<number>>(new Set())
  // the invites on screen are seen: never announced later; one arriving while the screen is open joins the list
  useEffect(() => { if (data) noteInvitesShown(data.incoming) }, [data])
  useEffect(() => onInviteNews(() => reload()), [reload])
  const befriended = (id: number, name: string) => { friends.expect(id); setMade(s => new Set([...s, id])); toast.show(`You and ${name} are friends`); reload() }
  useEffect(() => {
    // someone accepted an invite of yours since this device last looked: a quiet word, once
    if (!data || fresh.size === 0) return
    // not the ones made here: this device already said "You and … are friends"
    const names = data.friends.filter(f => fresh.has(f.id) && !made.has(f.id)).map(f => f.display_name)
    if (names.length) toast.show(names.length === 1 ? `${names[0]} accepted your invite` : `${names.length} new friends`)
    // once per arrival set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh])
  return (
    <>
      {token ? <TokenInvite token={token} onDone={(friend, name) => { clearToken(); if (friend) befriended(friend, name); else reload() }} /> : null}
      {state.kind === 'loading' ? <Spinner /> : null}
      {state.kind === 'error' ? <ErrorText>{state.message}</ErrorText> : null}
      {data && moments ? (
        <>
          <Incoming data={data} onAccepted={befriended} mutate={mutate} />
          {data.friends.length ? <Enter rise={6}><H2>Your friends</H2></Enter> : null}
          {data.friends.map((f, i) => (
            <MotionItem key={f.id} {...friends.modeFor(f.id, i, true)} gap={GAP}>
              {/* the full tour points at the first friend's card: the friend streak */}
              <View ref={i === 0 ? tourRef('friends-first') : undefined}>
                <FriendCard f={f} moment={moments[f.id] ?? null} fresh={fresh.has(f.id) || made.has(f.id)} delay={Math.min(i, 8) * 34 + 120} onPress={() => router.push(`/friends/${f.id}`)} />
              </View>
            </MotionItem>
          ))}
          {data.friends.length === 0 && data.incoming.length === 0 ? (
            <Enter><T muted>No friends yet. Invite someone by their handle, or show them your code to scan.</T></Enter>
          ) : null}
          <AddFriend data={data} onSent={reload} onCode={() => setCode(true)} onFriend={(id, name) => befriended(id, name)} />
          <Outgoing data={data} mutate={mutate} />
          <Enter delay={200}>
            <Card style={{ gap: 0, paddingVertical: 8 }}>
              <ListRow icon="sliders" label="Friends settings" detail="Invites, what friends see, reactions" onPress={() => setSettings(true)} />
            </Card>
          </Enter>
        </>
      ) : null}
      <InviteCodeSheet open={code} onClose={() => { setCode(false); reload() }} onFriend={p => { friends.expect(p.id); setMade(s => new Set([...s, p.id])) }} />
      <FriendsSettingsSheet open={settings} onClose={() => { setSettings(false); reload() }} />
    </>
  )
}

/** An invite code opened as a link (or scanned in): who shared it, and a choice to send them an invite. */
function TokenInvite({ token, onDone }: { token: string; onDone: (friendId: number | null, name: string) => void }) {
  const toast = useToast()
  const [who, setWho] = useState<{ handle: string; display_name: string; avatar?: string; friends: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { peekToken(token).then(setWho).catch(e => setErr(errMsg(e))) }, [token])
  const send = async () => {
    setBusy(true); setErr(null)
    try {
      const r = await redeemToken(token)
      if (r.status === 'friends') onDone(r.friend.id, r.friend.display_name)
      else { toast.show(`Invite sent to ${r.friend.display_name}`); onDone(null, r.friend.display_name) }
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Enter>
      <Card>
        {!who && !err ? <Spinner /> : null}
        {err ? <><ErrorText>{err}</ErrorText><Button small title="Close" onPress={() => onDone(null, '')} style={{ alignSelf: 'flex-start' }} /></> : null}
        {who ? (
          <>
            <Row style={{ flexWrap: 'nowrap', gap: 12 }}>
              <Avatar name={who.display_name} avatar={who.avatar} size={44} />
              <View style={{ flex: 1 }}>
                <T bold>{who.display_name}</T>
                <T small muted>@{who.handle} shared an invite code with you</T>
              </View>
            </Row>
            {who.friends ? <T small muted>You are already friends.</T> : (
              <Row>
                <Button primary title={busy ? 'Sending…' : 'Send an invite'} disabled={busy} onPress={() => { void send() }} />
                <Button title="Not now" onPress={() => onDone(null, '')} />
              </Row>
            )}
          </>
        ) : null}
      </Card>
    </Enter>
  )
}

/** Invites for you: accept (the row folds away and the friend opens into the list) or decline (it folds away). */
function Incoming({ data, onAccepted, mutate }: { data: FriendsOverview; onAccepted: (id: number, name: string) => void; mutate: (fn: (d: FriendsOverview) => FriendsOverview) => void }) {
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set())
  const [accepted, setAccepted] = useState<ReadonlySet<number>>(new Set())
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const arrivals = useArrivals(data.incoming.map(i => i.id))
  const act = async (inv: IncomingInvite, accept: boolean) => {
    setBusy(inv.id); setErr(null)
    try {
      if (accept) { await acceptInvite(inv.id); setAccepted(s => new Set([...s, inv.id])) } else await declineInvite(inv.id)
      setLeaving(s => new Set([...s, inv.id]))
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(null) }
  }
  // the invite folds away first; the new friend then opens into the list below
  const gone = (inv: IncomingInvite) => {
    mutate(d => ({ ...d, incoming: d.incoming.filter(x => x.id !== inv.id) }))
    if (accepted.has(inv.id)) onAccepted(inv.from.id, inv.from.display_name)
  }
  if (!data.incoming.length) return null
  // the last invite answered folds the whole section, heading and all, rather than leaving the heading to vanish
  const last = data.incoming.every(i => leaving.has(i.id))
  return (
    <MotionItem leaving={last} gap={GAP} onGone={() => data.incoming.forEach(gone)}>
      <View style={{ gap: GAP }}>
      <H2>Invites for you</H2>
      {data.incoming.map((inv, i) => (
        <MotionItem key={inv.id} {...arrivals.modeFor(inv.id, i, true)} gap={GAP} leaving={!last && leaving.has(inv.id)}
          onGone={() => gone(inv)}>
          <Card>
            <Row style={{ flexWrap: 'nowrap', gap: 12 }}>
              <Avatar name={inv.from.display_name} avatar={inv.from.avatar} size={44} />
              <View style={{ flex: 1 }}>
                <T bold numberOfLines={1}>{inv.from.display_name}</T>
                <T small muted>@{inv.from.handle} · {inv.via === 'qr' ? 'scanned your code' : inv.via === 'contacts' ? 'from contacts' : 'invited you'} {fmtWhen(inv.created_at)}</T>
              </View>
            </Row>
            <Row>
              <Button primary small title={busy === inv.id ? 'Accepting…' : 'Accept'} disabled={busy !== null} onPress={() => { void act(inv, true) }} />
              <Button small title="Decline" disabled={busy !== null} onPress={() => { void act(inv, false) }} />
            </Row>
          </Card>
        </MotionItem>
      ))}
      {err ? <ErrorText>{err}</ErrorText> : null}
      </View>
    </MotionItem>
  )
}

/**
 * Adding a friend. The reply to a handle is always the same few words, whoever it belongs to or whether it belongs to
 * anyone: an invite that reaches nobody reads exactly like one that is waiting.
 */
function AddFriend({ data, onSent, onCode, onFriend }: { data: FriendsOverview; onSent: () => void; onCode: () => void; onFriend: (id: number, name: string) => void }) {
  const router = useRouter()
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [sent, setSent] = useState<{ n: number; handle: string } | null>(null)
  const native = Platform.OS !== 'web'
  const send = async () => {
    const h = handle.trim().replace(/^@/, '')
    if (!h) return
    setBusy(true); setErr(null)
    try {
      const r = await sendInvite(h)
      setHandle('')
      if (r.status === 'friends' && r.friend) onFriend(r.friend.id, r.friend.display_name)
      else { setSent(s => ({ n: (s?.n ?? 0) + 1, handle: h.toLowerCase() })); onSent() }
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Enter delay={120} style={{ gap: 12 }}>
      <H2 hint="Only someone who knows your handle, or scans your code, can invite you">Add a friend</H2>
      <Card ref={tourRef('friends-add')}>
        <Row style={{ flexWrap: 'nowrap' }}>
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <Input value={handle} onChangeText={t => { setHandle(t); setErr(null) }} placeholder="@handle" autoCapitalize="none" autoCorrect={false}
              autoComplete="off" onSubmitEditing={() => { void send() }} accessibilityLabel="Their handle, exactly" maxLength={25} style={{ paddingLeft: 14, minWidth: 0 }} />
          </View>
          <Button primary title={busy ? 'Sending…' : 'Invite'} disabled={busy || !handle.trim()} onPress={() => { void send() }} />
        </Row>
        {err ? <ErrorText>{err}</ErrorText> : null}
        {sent ? <Swap k={String(sent.n)}><T small muted>Invite sent to @{sent.handle}. It shows below until they answer or it lapses in {data.invite_days} days.</T></Swap> : <T small muted>Their handle exactly; there is no search.</T>}
        <Row>
          <Button small lead="qr" title="Show my code" accessibilityLabel="Show my invite code" onPress={onCode} />
          {native ? <Button small lead="scan" title="Scan a code" accessibilityLabel="Scan a friend’s code" onPress={() => router.push('/friends/scan')} /> : null}
        </Row>
        {!data.settings.invites ? <T small muted>Invites to you are off in Friends settings. You can still invite others.</T> : null}
      </Card>
      <Card style={{ gap: 0, paddingVertical: 8 }}>
        <ListRow icon="contacts" label={native ? 'Find friends from my contacts' : 'Contacts'} detail={native ? 'Only people who chose to be found. Your contacts stay on this phone' : `Let contacts find me: ${data.discoverable ? 'on' : 'off'}`} onPress={() => router.push('/friends/contacts')} />
      </Card>
    </Enter>
  )
}

/** Invites you have sent, as you typed them: only you see this list, and it never says more than "sent". */
function Outgoing({ data, mutate }: { data: FriendsOverview; mutate: (fn: (d: FriendsOverview) => FriendsOverview) => void }) {
  const c = useColors()
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set())
  const arrivals = useArrivals(data.outgoing.map(o => o.id))
  if (!data.outgoing.length) return null
  return (
    <>
      <H2 hint={`Until they answer, or for ${data.invite_days} days`}>Invites sent</H2>
      <Card style={{ gap: 0, paddingVertical: 6 }}>
        {data.outgoing.map((o, i) => (
          <MotionItem key={o.id} {...arrivals.modeFor(o.id, i, true)} leaving={leaving.has(o.id)} onGone={() => mutate(d => ({ ...d, outgoing: d.outgoing.filter(x => x.id !== o.id) }))}>
            <Row style={{ flexWrap: 'nowrap', minHeight: 48, gap: 12 }}>
              <View style={{ flex: 1 }}>
                <T numberOfLines={1}>@{o.handle}</T>
                <T small muted>Sent {fmtWhen(o.created_at)}</T>
              </View>
              <Tap onPress={() => { cancelInvite(o.id).then(() => setLeaving(s => new Set([...s, o.id]))).catch(() => {}) }} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Cancel the invite to @${o.handle}`}
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
                <Icon name="x" size={16} color={c.muted} />
              </Tap>
            </Row>
          </MotionItem>
        ))}
      </Card>
    </>
  )
}
