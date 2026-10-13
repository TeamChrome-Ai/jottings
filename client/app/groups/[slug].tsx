import { shareText } from '../../src/lib/share'
import { useState } from 'react'
import { Platform, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import type { User } from '@shared/types'
import { del, get, patch, post } from '../../src/lib/api'
import { useAuth } from '../../src/store/auth'
import { useToast } from '../../src/store/toast'
import { useColors } from '../../src/hooks/useTheme'
import {
  confirmAsync, displayName, errMsg, eventStatus, fmtDay, inviteLink, plural, roleLabel, useLoad,
  type EventLeaderboard, type GroupDetail, type GroupEventFull, type GroupMember,
} from '../../src/lib/community'
import { eventLine } from '../../src/lib/events'
import { localDay } from '../../src/lib/localDay'
import { AdminBadge, SelectableRow, SheetBody, StatusTag, Tag, UserLink } from '../../src/components/CommunityBits'
import { EventForm } from '../../src/components/CommunityEventForm'
import { Feed } from '../../src/components/CommunityFeed'
import { LeaderboardTable } from '../../src/components/CommunityLeaderboard'
import { Button, Card, Enter, ErrorText, H2, Input, Row, Screen, Sheet, Spinner, SwitchRow, T } from '../../src/components/ui'
import { Swap } from '../../src/components/motion/community'
import { tourRef } from '../../src/store/tour'
import GroupStreakCard from '../../src/components/GroupStreakCard'
import GroupPathSection from '../../src/components/GroupPath'
import Avatar from '../../src/components/Avatar'
import SignInCard from '../../src/components/SignInCard'
import { BRAND } from '@shared/brand'

export default function GroupScreen() {
  const router = useRouter()
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const s = typeof slug === 'string' ? slug : ''
  const { user, ready } = useAuth()
  const { state, reload } = useLoad(() => get<GroupDetail>(`/groups/${encodeURIComponent(s)}`), [s, user?.id], ready && !!user && s !== '')
  const title = state.kind === 'ready' ? state.data.name : 'Group'
  // one entrance for the group itself; the feed below staggers its first posts
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title }} />
      {!ready && <Spinner />}
      {ready && !user && (
        <SignInCard text="Groups are for signed-in readers." />
      )}
      {ready && user && state.kind === 'loading' && <Spinner />}
      {ready && user && state.kind === 'error' && (
        <Card>
          <ErrorText>{state.message}</ErrorText>
          <Button title="All groups" small onPress={() => router.push('/groups')} style={{ alignSelf: 'flex-start' }} />
        </Card>
      )}
      {ready && user && state.kind === 'ready' && (
        <>
          <Enter style={{ gap: 12 }}>
            <Header group={state.data} me={user} reload={reload} />
            {state.data.streak ? <View ref={tourRef('group-streak')}><GroupStreakCard group={state.data} me={user} delay={120} /></View> : null}
            <GroupPathSection group={state.data} me={user} />
            {state.data.role === 'admin' && <InviteTools group={state.data} reload={reload} />}
            <View ref={tourRef('group-members')} style={{ gap: 12 }}><Members group={state.data} me={user} reload={reload} /></View>
            <View ref={tourRef('group-events')} style={{ gap: 12 }}><Events group={state.data} me={user} reload={reload} /></View>
          </Enter>
          <View ref={tourRef('group-feed')} style={{ gap: 16 }}><Feed group={state.data} me={user} /></View>
        </>
      )}
    </Screen>
  )
}

interface SectionProps { group: GroupDetail; me: User; reload: () => void }

// ---------------- header: name, description, edit, leave ----------------
function Header({ group, me, reload }: SectionProps) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const leave = async () => {
    if (!(await confirmAsync(`Leave ${group.name}?`, undefined, 'Leave'))) return
    try { await post(`/groups/${group.slug}/leave`); router.dismissTo('/groups') } catch (e) { setErr(errMsg(e)) }   // back to the list if it is in the stack, else replace
  }
  return (
    // the name is the screen's title already
    <Card>
      {group.description ? <T muted>{group.description}</T> : null}
      <Row>
        <Tag label={plural(group.member_count, 'member')} />
        {group.site_admin ? <Tag label="Here as the developer" accent /> : group.role !== 'member' && <Tag label={roleLabel(group.role)} accent={group.role === 'admin'} />}
        <View style={{ flex: 1 }} />
        {group.role === 'admin' && <Button title="Edit" small onPress={() => setEditing(true)} />}
        {group.owner_id !== me.id && !group.site_admin && <Button title="Leave" small danger onPress={leave} />}
      </Row>
      {group.site_admin ? <T small muted>You are not a member: Admin mode opens the group to you with its admins’ rights, and your name carries the Developer badge. Members do not see you here unless you post.</T> : null}
      {err && <ErrorText>{err}</ErrorText>}
      <Sheet open={editing} onClose={() => setEditing(false)} title="Edit group">
        {editing && <EditGroupForm group={group} owner={group.owner_id === me.id} onDone={() => { setEditing(false); reload() }} onCancel={() => setEditing(false)} onStreak={reload} />}
      </Sheet>
    </Card>
  )
}

function EditGroupForm({ group, owner, onDone, onCancel, onStreak }: { group: GroupDetail; owner: boolean; onDone: () => void; onCancel: () => void; onStreak: () => void }) {
  const [streak, setStreak] = useState(group.streak_enabled !== false)
  const flipStreak = async (on: boolean) => {
    setStreak(on); setErr(null)
    try { await patch(`/groups/${group.slug}`, { streak_enabled: on }); onStreak() } catch (ex) { setStreak(!on); setErr(errMsg(ex)) }
  }
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setErr(null)
    try { await patch(`/groups/${group.slug}`, { name: name.trim(), description: description.trim() || null }); onDone() }
    catch (ex) { setErr(errMsg(ex)) } finally { setBusy(false) }
  }
  return (
    <SheetBody>
      <Input placeholder="Group name" value={name} onChangeText={setName} maxLength={60} />
      <Input placeholder="Description" value={description} onChangeText={setDescription} maxLength={2000} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
      {owner ? <SwitchRow label="Group streak" hint={streak ? 'Days on which every member reads, counted together' : 'Off: no group streak for anyone in the group'} value={streak} onChange={v => { void flipStreak(v) }} /> : null}
      {err && <ErrorText>{err}</ErrorText>}
      <Row style={{ justifyContent: 'flex-end' }}>
        <Button title="Cancel" onPress={onCancel} disabled={busy} />
        <Button title="Save" primary onPress={submit} disabled={busy || name.trim().length < 2} />
      </Row>
    </SheetBody>
  )
}

// ---------------- admin: invite code ----------------
function InviteTools({ group, reload }: Omit<SectionProps, 'me'>) {
  const toast = useToast()
  const c = useColors()
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const code = group.invite_code ?? ''
  const link = inviteLink(code)
  const copy = async () => {
    try { await Clipboard.setStringAsync(link); toast.show('Invite link copied'); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { setErr(`Clipboard blocked; copy the link by hand: ${link}`) }
  }
  const share = async () => {
    const r = await shareText({ title: 'Share invite link', message: `Join ${group.name} on ${BRAND.name}`, url: link })
    if (r === 'copied') toast.show('Invite link copied'); else if (r === 'failed') await copy()
  }
  const rotate = async () => {
    if (!(await confirmAsync('Rotate the invite code?', 'Links already shared will stop working.', 'Rotate'))) return
    try { await patch(`/groups/${group.slug}`, { rotate_invite: true }); toast.show('Invite code rotated'); reload() } catch (e) { setErr(errMsg(e)) }
  }
  return (
    <>
      <H2>Invite people</H2>
      <Card>
        <Row>
          <Swap k={code}>
            <T bold selectable style={{ fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 18, letterSpacing: 1, color: c.accent }}>{code || '—'}</T>
          </Swap>
          <View style={{ flex: 1 }} />
          <Swap k={copied ? 'copied' : 'copy'}><Button title={copied ? 'Copied' : 'Copy'} small onPress={copy} disabled={!code} /></Swap>
          <Button title="Share" small onPress={share} disabled={!code} />
          <Button title="Rotate" small danger onPress={rotate} />
        </Row>
        <T small muted selectable>Anyone with the code can join at {link}</T>
        {err && <ErrorText>{err}</ErrorText>}
      </Card>
    </>
  )
}

// ---------------- members ----------------
function Members({ group, me, reload }: SectionProps) {
  const [err, setErr] = useState<string | null>(null)
  const isAdmin = group.role === 'admin'
  const setRole = async (m: GroupMember, role: GroupMember['role']) => {
    try { await post(`/groups/${group.slug}/members/${m.id}/role`, { role }); reload() } catch (e) { setErr(errMsg(e)) }
  }
  const remove = async (m: GroupMember) => {
    if (!(await confirmAsync(`Remove ${displayName(m)} from the group?`, undefined, 'Remove'))) return
    try { await del(`/groups/${group.slug}/members/${m.id}`); reload() } catch (e) { setErr(errMsg(e)) }
  }
  return (
    <>
      <H2>Members</H2>
      <Card>
        {group.members.map(m => {
          const isOwner = m.id === group.owner_id
          return (
            <View key={m.id} style={{ gap: 6, paddingVertical: 4 }}>
              <Row style={{ flexWrap: 'nowrap', gap: 10 }}>
                <Avatar name={displayName(m)} avatar={m.avatar} size={32} />
                <View style={{ flex: 1 }}>
                  <Row style={{ gap: 6 }}><UserLink handle={m.handle} name={displayName(m)} bold />{m.staff ? <AdminBadge /> : null}</Row>
                  <T small muted>@{m.handle} · joined {fmtDay(m.joined_at)}</T>
                </View>
                {isOwner ? <Tag label="Owner" accent /> : m.role === 'admin' && !m.staff ? <Tag label="Admin" /> : null}
              </Row>
              {isAdmin && !isOwner && m.id !== me.id && (
                <Row>
                  {m.role === 'admin'
                    ? <Button title="Demote" small onPress={() => setRole(m, 'member')} />
                    : <Button title="Make admin" small onPress={() => setRole(m, 'admin')} />}
                  <Button title="Remove" small danger onPress={() => remove(m)} />
                </Row>
              )}
            </View>
          )
        })}
        {err && <ErrorText>{err}</ErrorText>}
      </Card>
    </>
  )
}

// ---------------- events + leaderboard ----------------
/** My join day as the device's calendar day (the server judges it by my saved offset; the same day but for an edge of midnight). */
const myJoinDay = (group: GroupDetail, me: User) => { const j = group.members.find(m => m.id === me.id)?.joined_at; return j ? localDay(new Date(j)) : undefined }

function Events({ group, me, reload }: SectionProps) {
  const isAdmin = group.role === 'admin'
  const [selected, setSelected] = useState<number | null>(group.events[0]?.id ?? null)
  const [form, setForm] = useState<'closed' | 'new' | GroupEventFull>('closed')
  const [err, setErr] = useState<string | null>(null)
  const current = group.events.find(e => e.id === selected) ?? group.events[0] ?? null
  const remove = async (ev: GroupEventFull) => {
    if (!(await confirmAsync(`Delete event "${ev.name}"?`, undefined, 'Delete'))) return
    try { await del(`/groups/${group.slug}/events/${ev.id}`); if (selected === ev.id) setSelected(null); reload() } catch (e) { setErr(errMsg(e)) }
  }
  return (
    <>
      <Row>
        <View style={{ flex: 1 }}><H2>Events</H2></View>
        {isAdmin && <Button title="New event" small onPress={() => setForm('new')} />}
      </Row>
      {group.events.length === 0 && <T muted>No events yet.{isAdmin ? ' Create one to start a challenge.' : ''}</T>}
      {group.events.map(ev => {
        const status = eventStatus(ev)
        return (
          <SelectableRow key={ev.id} selected={ev.id === current?.id} onPress={() => setSelected(ev.id)}>
            <Row>
              <T bold style={{ flex: 1 }}>{ev.name}</T>
              <StatusTag status={status} />
            </Row>
            {ev.description ? <T small numberOfLines={2}>{ev.description}</T> : null}
            <T small muted>{eventLine(ev)}</T>
            {isAdmin && (
              <Row>
                <Button title="Edit" small onPress={() => setForm(ev)} />
                <Button title="Delete" small danger onPress={() => remove(ev)} />
              </Row>
            )}
          </SelectableRow>
        )
      })}
      {err && <ErrorText>{err}</ErrorText>}
      {current && <EventBoard slug={group.slug} event={current} me={me} joined={myJoinDay(group, me)} />}
      <Sheet open={form !== 'closed'} onClose={() => setForm('closed')} title={form === 'new' ? 'New event' : 'Edit event'} maxHeight="92%">
        {form !== 'closed' && <EventForm slug={group.slug} event={form === 'new' ? undefined : form} onDone={() => { setForm('closed'); reload() }} onCancel={() => setForm('closed')} />}
      </Sheet>
    </>
  )
}

/** `joined`: my join day, so a board that leaves late joiners off can say why my row is missing. */
function EventBoard({ slug, event, me, joined }: { slug: string; event: GroupEventFull; me: User; joined?: string }) {
  const { state } = useLoad(() => get<EventLeaderboard>(`/groups/${slug}/events/${event.id}/leaderboard`), [slug, JSON.stringify(event)])
  const late = event.late_join === false && joined != null && joined > event.starts_at
  return (
    <Card>
      <T bold>{event.name} <T muted>leaderboard</T></T>
      {state.kind === 'loading' && <Spinner />}
      {state.kind === 'error' && <ErrorText>{state.message}</ErrorText>}
      {state.kind === 'ready' && state.data.private ? <T small muted>Admins see the whole board; this is your own row and place.</T> : null}
      {state.kind === 'ready' && late ? <T small muted>You joined the group after this event started, so it does not score you.</T> : null}
      {state.kind === 'ready' && <LeaderboardTable rows={state.data.rows} metric={state.data.event.metric} goal={state.data.event.goal} myId={me.id} />}
    </Card>
  )
}
