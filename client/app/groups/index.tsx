import { useEffect, useState } from 'react'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import type { Group } from '@shared/types'
import { get, post } from '../../src/lib/api'
import { useAuth } from '../../src/store/auth'
import { useToast } from '../../src/store/toast'
import { errMsg, plural, roleLabel, useLoad } from '../../src/lib/community'
import { Tag } from '../../src/components/CommunityBits'
import { Button, Card, Enter, ErrorText, H2, Input, Row, Screen, Spinner, T, Tap } from '../../src/components/ui'
import { MotionItem, useArrivals } from '../../src/components/motion/community'
import { tourRef } from '../../src/store/tour'
import SignInCard from '../../src/components/SignInCard'
import { GroupCardStrip } from '../../src/components/GroupPath'
import { NOUN } from '@shared/brand'

export default function GroupsScreen() {
  const { user, ready } = useAuth()
  const { join } = useLocalSearchParams<{ join?: string | string[] }>()
  const joinCode = (Array.isArray(join) ? join[0] : join) ?? ''
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: 'Groups' }} />
      {!ready && <Spinner />}
      {ready && !user && (
        <SignInCard ref={tourRef('groups-signin')} title="Read together" text={`A few people reading alongside each other: a feed for notes and ${NOUN.many}, and events with a leaderboard.`}>
          {joinCode ? <T small muted>Your invite code <T small bold>{joinCode}</T> will be waiting after you sign in.</T> : null}
        </SignInCard>
      )}
      {ready && user && (
        <>
          <MyGroups />
          <CreateGroup />
          <JoinGroup initialCode={joinCode} />
        </>
      )}
    </Screen>
  )
}

function MyGroups() {
  const router = useRouter()
  const { state } = useLoad(() => get<Group[]>('/groups'), [])
  // first load: the cards rise in turn; a group joined or created since (the list reloads on focus) opens into place
  const arrivals = useArrivals(state.kind === 'ready' ? state.data.map(g => g.id) : null)
  return (
    <>
      <H2>My groups</H2>
      {state.kind === 'loading' && <Spinner />}
      {state.kind === 'error' && <ErrorText>{state.message}</ErrorText>}
      {state.kind === 'ready' && state.data.length === 0 && <T muted>You are not in any group yet. Create one below or paste an invite code.</T>}
      {state.kind === 'ready' && state.data.map((g, i) => (
        <MotionItem key={g.id} {...arrivals.modeFor(g.id, i, true)} gap={12}>
          <Tap onPress={() => router.push(`/groups/${g.slug}`)} accessibilityRole="link" scaleTo={0.985}>
            <Card>
              <Row>
                <T bold style={{ flex: 1 }}>{g.name}</T>
                {g.role && g.role !== 'member' ? <Tag label={roleLabel(g.role)} accent={g.role === 'admin'} /> : null}
                <Tag label={plural(g.member_count, 'member')} />
              </Row>
              {g.description ? <T small muted numberOfLines={2}>{g.description}</T> : null}
              <GroupCardStrip path_id={g.path_id} />
            </Card>
          </Tap>
        </MotionItem>
      ))}
    </>
  )
}

function CreateGroup() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const g = await post<Group>('/groups', { name: name.trim(), description: description.trim() || undefined })
      setName(''); setDescription(''); setOpen(false)
      router.push(`/groups/${g.slug}`)
    } catch (ex) { setErr(errMsg(ex)) } finally { setBusy(false) }
  }
  return (
    <>
      <H2>Create a group</H2>
      <Card ref={tourRef('groups-create')}>
        {!open && <Button title="New group" onPress={() => setOpen(true)} />}
        {open && (
          <Enter style={{ gap: 8 }}>
            <Input placeholder="Group name" value={name} onChangeText={setName} maxLength={60} autoFocus />
            <Input placeholder="What is this group reading? (optional)" value={description} onChangeText={setDescription} maxLength={2000} multiline style={{ minHeight: 60, textAlignVertical: 'top' }} />
            {err && <ErrorText>{err}</ErrorText>}
            <Row style={{ justifyContent: 'flex-end' }}>
              <Button title="Cancel" onPress={() => { setOpen(false); setErr(null) }} disabled={busy} />
              <Button title={busy ? 'Creating…' : 'Create'} primary onPress={submit} disabled={busy || name.trim().length < 2} />
            </Row>
          </Enter>
        )}
      </Card>
    </>
  )
}

function JoinGroup({ initialCode }: { initialCode: string }) {
  const router = useRouter()
  const toast = useToast()
  const [code, setCode] = useState(initialCode)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (initialCode) setCode(initialCode) }, [initialCode])
  const submit = async () => {
    setBusy(true); setErr(null)
    try {
      const g = await post<Group>('/groups/join', { invite_code: code.trim() })
      toast.show(`Joined ${g.name}`)
      setCode('')
      router.push(`/groups/${g.slug}`)
    } catch (ex) { setErr(errMsg(ex)) } finally { setBusy(false) }
  }
  return (
    <>
      <H2>Join with an invite code</H2>
      <Card ref={tourRef('groups-join')}>
        <Row style={{ flexWrap: 'nowrap' }}>
          <Input placeholder="Invite code" value={code} onChangeText={setCode} autoCapitalize="none" autoCorrect={false} style={{ flex: 1, minWidth: 0 }} onSubmitEditing={submit} />
          <Button title={busy ? 'Joining…' : 'Join'} primary onPress={submit} disabled={busy || code.trim().length === 0} />
        </Row>
        {err && <ErrorText>{err}</ErrorText>}
      </Card>
    </>
  )
}

