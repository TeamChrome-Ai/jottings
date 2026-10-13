import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { Redirect, Stack, useRouter } from 'expo-router'
import { get } from '../../src/lib/api'
import { adminMode, fmtWhen, plural, useLoad } from '../../src/lib/community'
import { Card, ErrorText, Input, ListRow, Screen, Spinner, T } from '../../src/components/ui'
import { useAuth } from '../../src/store/auth'

/** GET /admin/groups: one row per group. */
interface AdminGroup { id: number; name: string; slug: string; created_at: string; owner: string; member_count: number; post_count: number; last_post_at: string | null; my_role: 'admin' | 'member' | null }

/** Every group, most recently active first, for a site admin in Admin mode; each opens as its own admins see it.
 * Admin mode off (or not an admin) goes back to Settings; the server keeps the groups closed either way. */
export default function AdminGroupsScreen() {
  const { user, ready } = useAuth()
  const on = adminMode(user)
  if (ready && !on) return <Redirect href="/settings" />
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: 'All groups' }} />
      {on ? <GroupList /> : <Spinner />}
    </Screen>
  )
}

function GroupList() {
  const router = useRouter()
  const { state } = useLoad(() => get<AdminGroup[]>('/admin/groups'), [])
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    if (state.kind !== 'ready') return []
    const k = q.trim().toLowerCase()
    return k ? state.data.filter(g => g.name.toLowerCase().includes(k) || g.owner.toLowerCase().includes(k)) : state.data
  }, [state, q])
  return (
    <>
      <T muted>Open any group to read its feed, post a notice under your Developer badge, or remove posts and members. Members do not see you there unless you post.</T>
      <Input placeholder="Find a group or its owner" value={q} onChangeText={setQ} autoCapitalize="none" />
      {state.kind === 'loading' && <Spinner />}
      {state.kind === 'error' && <ErrorText>{state.message}</ErrorText>}
      {state.kind === 'ready' && shown.length === 0 && <T muted>{state.data.length ? 'No group matches.' : 'No groups yet.'}</T>}
      {shown.length ? (
        <Card style={{ gap: 0, paddingVertical: 8 }}>
          {shown.map(g => (
            <View key={g.id}>
              <ListRow label={g.name}
                detail={`@${g.owner} · ${plural(g.member_count, 'member')} · ${plural(g.post_count, 'post')}${g.last_post_at ? ` · last ${fmtWhen(g.last_post_at)}` : ''}${g.my_role === 'admin' ? ' · you run it' : g.my_role ? ' · you are a member' : ''}`}
                onPress={() => router.push(`/groups/${encodeURIComponent(g.slug)}`)} />
            </View>
          ))}
        </Card>
      ) : null}
    </>
  )
}
