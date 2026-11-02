import { useCallback, useEffect, useState } from 'react'
import { Alert, Platform, ScrollView, View } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { api, get, patch } from '../../src/lib/api'
import FriendsSettingsSheet from '../../src/components/friends/FriendsSettingsSheet'
import AvatarSheet from '../../src/components/AvatarSheet'
import AvatarArt from '../../src/components/AvatarArt'
import { useAuth } from '../../src/store/auth'
import { adminMode, errMsg, useLoad } from '../../src/lib/community'
import { AdminBadge } from '../../src/components/CommunityBits'
import { adminSummary, listBlocks, unblockUser } from '../../src/lib/moderation'
import { useToast } from '../../src/store/toast'
import { useInvitesWaiting } from '../../src/hooks/useInviteNotice'
import { Button, Card, ErrorText, ListRow, Row, Screen, Sheet, Spinner, SwitchRow, T, Tap } from '../../src/components/ui'
import { NOUN } from '@shared/brand'
import { t, tn } from '@shared/i18n'

/** Settings → Account (signed in): the picture and name, friends, the public profile, blocked users, your data, admin and deleting the account. */
export default function AccountSettings() {
  const router = useRouter()
  const { user, ready, logout } = useAuth()
  const toast = useToast()
  const [sheet, setSheet] = useState<'blocked' | 'admin' | 'friends' | 'avatar' | null>(null)
  const close = useCallback(() => setSheet(null), [])
  if (!ready) return null
  if (!user) return <Redirect href="/settings" />

  const deleteAccount = async () => {
    const go = async () => {
      try { await api('/me', { method: 'DELETE', json: { confirm: 'delete' } }); await logout(); toast.show(t('Account deleted')) }
      catch (e) { toast.show(e instanceof Error ? e.message : t('Could not delete the account')) }
    }
    const msg = t('This removes your account, reading activity, {many}, group memberships and any groups you own. There is no undo.', { many: NOUN.many })
    if (Platform.OS === 'web') { const ask = (globalThis as { confirm?: (m: string) => boolean }).confirm; if (ask && ask(msg)) await go(); return }
    Alert.alert(t('Delete account?'), msg, [{ text: t('Cancel'), style: 'cancel' }, { text: t('Delete'), style: 'destructive', onPress: () => { go() } }])
  }
  return (
    <Screen>
      <Card style={{ gap: 0, paddingVertical: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingVertical: 6 }}>
          <Tap onPress={() => setSheet('avatar')} scaleTo={0.9} accessibilityRole="button" accessibilityLabel={t('Choose your picture')}>
            <AvatarArt id={user.avatar} userId={user.id} size={48} />
          </Tap>
          {/* the badge sits on the handle's line: beside a long name it ran under Sign out */}
          <View style={{ flex: 1, minWidth: 0 }}><T bold numberOfLines={1}>{user.display_name}</T><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><T small muted numberOfLines={1} style={{ flexShrink: 1 }}>@{user.handle}</T>{adminMode(user) ? <AdminBadge /> : null}</View></View>
          <Button small title={t('Sign out')} onPress={() => logout()} />
        </View>
        <FriendsRow onPress={() => setSheet('friends')} />
        <PublicProfileRow />
        <ListRow icon="block" label={t('Blocked users')} detail={t('Hidden from you, and no longer friends')} onPress={() => setSheet('blocked')} />
        <ListRow icon="share" label={t('Your data')} detail={t('Back up, restore or import; see or delete what is stored')} onPress={() => router.push('/your-data')} />
        {user.is_admin ? <ListRow icon="award" label={t('Admin')} detail={adminMode(user) ? t('Admin mode on: your badge, every group, moderation') : t('Admin mode, moderation queue and feedback')} onPress={() => setSheet('admin')} /> : null}
        <ListRow icon="x" label={t('Delete account')} danger onPress={deleteAccount} />
      </Card>
      <FriendsSettingsSheet open={sheet === 'friends'} onClose={close} />
      <AvatarSheet open={sheet === 'avatar'} onClose={close} />
      <Sheet open={sheet === 'blocked'} onClose={close} title={t('Blocked users')}><ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}><BlockedUsers /></ScrollView></Sheet>
      {user.is_admin ? <Sheet open={sheet === 'admin'} onClose={close} title={t('Admin')}><View style={{ padding: 16, gap: 10 }}><AdminLinks onGo={close} /></View></Sheet> : null}
    </Screen>
  )
}

/** Account → Public profile: off unless turned on (an absent `public_profile` is private); saves at once. */
function PublicProfileRow() {
  const toast = useToast()
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    get<{ settings: { public_profile?: unknown } | null }>('/me').then(r => { if (!cancelled) setOn(r.settings?.public_profile === true) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  if (on === null) return null
  const flip = (v: boolean) => {
    setOn(v)
    patch('/me', { settings: { public_profile: v } }).catch(e => { setOn(!v); toast.show(errMsg(e)) })
  }
  return <SwitchRow label={t('Public profile')} hint={on ? t('On: anyone can see your name, picture, badges, reading totals and streak') : t('Off: only your friends and group members see your name and picture')} value={on} onChange={flip} />
}

/** Account → Friends, with the invites waiting (live: a heartbeat or a check may bring one while the page is open). */
function FriendsRow({ onPress }: { onPress: () => void }) {
  const n = useInvitesWaiting()
  return <ListRow icon="invite" label={t('Friends')} detail={n ? tn(n, '{n} invite waiting', '{n} invites waiting') : t('Invites, what friends see, reactions')} onPress={onPress} />
}

/** GET /blocks with Unblock per row; the list is small (people you chose to block), so no paging. */
function BlockedUsers() {
  const toast = useToast()
  const { state, mutate } = useLoad(() => listBlocks(), [])
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const unblock = async (id: number, handle: string) => {
    setBusy(id); setErr(null)
    try { await unblockUser(id); mutate(bs => bs.filter(b => b.user_id !== id)); toast.show(t('Unblocked @{handle}', { handle })) } catch (e) { setErr(errMsg(e)) } finally { setBusy(null) }
  }
  return (
    <>
      <View style={{ gap: 10 }}>
        {state.kind === 'loading' && <Spinner />}
        {state.kind === 'error' && <ErrorText>{state.message}</ErrorText>}
        {state.kind === 'ready' && state.data.length === 0 && <T small muted>{t('You have not blocked anyone. Blocking someone hides their posts and shared {many}, ends a friendship and stops their invites.', { many: NOUN.many })}</T>}
        {state.kind === 'ready' && state.data.map(b => (
          <Row key={b.user_id} style={{ justifyContent: 'space-between' }}>
            <View><T bold>{b.display_name || b.handle}</T><T small muted>@{b.handle}</T></View>
            <Button title={busy === b.user_id ? '…' : t('Unblock')} small disabled={busy !== null} onPress={() => { void unblock(b.user_id, b.handle) }} />
          </Row>
        ))}
        {err && <ErrorText>{err}</ErrorText>}
      </View>
    </>
  )
}

/** Admin only: Admin mode, then the panel. The pending count is from GET /admin/summary; the row still opens the queue when the count cannot load. */
function AdminLinks({ onGo }: { onGo: () => void }) {
  const router = useRouter()
  const { user, update } = useAuth()
  const { state } = useLoad(() => adminSummary(), [])
  const queue = state.kind === 'ready' ? t('Moderation queue ({n} pending)', { n: state.data.pending }) : t('Moderation queue')
  const on = adminMode(user)
  const [modeErr, setModeErr] = useState<string | null>(null)
  // settings.admin_mode on the account (rs/src/auth.rs admin_mode); the badge and the open groups follow it on the server
  const flip = async (v: boolean) => {
    if (!user) return
    setModeErr(null)
    try { await patch('/me', { settings: { admin_mode: v } }); update({ ...user, settings: { ...(user.settings ?? {}), admin_mode: v } }) }
    catch (e) { setModeErr(errMsg(e)) }
  }
  return (
    <>
      <SwitchRow label={t('Admin mode')} hint={on ? t('The Developer badge is by your name, and every group opens to you: post a notice, remove posts or members') : t('Off: you read, post and appear as an ordinary reader')} value={on} onChange={v => { void flip(v) }} />
      {modeErr && <ErrorText>{modeErr}</ErrorText>}
      {on ? <Button title={t('All groups')} primary onPress={() => { onGo(); router.push('/admin/groups') }} /> : null}
      <Button title={t('Live numbers')} onPress={() => { onGo(); router.push('/admin/live') }} />
      <Button title={queue} primary={state.kind === 'ready' && state.data.pending > 0} onPress={() => { onGo(); router.push('/admin/reports') }} />
      <Button title={t('Feedback')} onPress={() => { onGo(); router.push('/admin/feedback') }} />
      {state.kind === 'error' && <T small muted>{t('Pending count unavailable: {message}', { message: state.message })}</T>}
    </>
  )
}
