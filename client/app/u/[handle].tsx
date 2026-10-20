import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import type { Badge } from '@shared/types'
import { get } from '../../src/lib/api'
import { fmtDuration } from '../../src/lib/format'
import { useAuth } from '../../src/store/auth'
import { confirmAsync, displayName, errMsg, fmtDay, useLoad, type ProfileResponse, type ProfileStats, type PublicUser } from '../../src/lib/community'
import { blockUser, listBlocks, unblockUser, type ReportTarget } from '../../src/lib/moderation'
import { forceRename, setSupporter } from '../../src/lib/feedback'
import { useToast } from '../../src/store/toast'
import ReportSheet from '../../src/components/ReportSheet'
import { AdminBadge } from '../../src/components/CommunityBits'
import { BadgeGrid } from '../../src/components/motion/badges'
import { Button, Card, Enter, ErrorText, H, H2, Input, Row, Screen, Spinner, SwitchRow, T } from '../../src/components/ui'
import AvatarArt from '../../src/components/AvatarArt'
import AvatarSheet from '../../src/components/AvatarSheet'
import { Swap } from '../../src/components/motion/community'
import { BRAND, NOUN } from '@shared/brand'
import { t, tc } from '@shared/i18n'

export default function ProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>()
  const { user: me, ready } = useAuth()
  const h = typeof handle === 'string' ? handle : ''
  const { state, reload } = useLoad(() => get<ProfileResponse>(`/users/${encodeURIComponent(h)}`), [h], ready && h !== '')
  const title = state.kind === 'ready' ? displayName(state.data.user) : t('Profile')
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title }} />
      {state.kind === 'loading' && <Spinner />}
      {state.kind === 'error' && <ErrorText>{state.message}</ErrorText>}
      {state.kind === 'ready' && (
        // one calm entrance once the profile has loaded, rather than at mount behind the spinner
        <Enter style={{ gap: 12 }}>
          <Header user={state.data.user} isMe={me?.id === state.data.user.id} signedIn={me !== null} />
          {me?.is_admin && state.data.user.supporter !== undefined ? <SupporterControl user={state.data.user} onChange={reload} /> : null}
          {me?.is_admin && me.id !== state.data.user.id ? <RenameControl user={state.data.user} /> : null}
          {'private' in state.data
            ? <Card><T muted>{t('This profile is private.')}</T></Card>
            : <>
                {state.data.public === false ? <T small muted>{t('Only you see this. Others see it once Public profile is on in Settings.')}</T> : null}
                <PublicBody stats={state.data.stats} badges={state.data.badges} />
              </>}
        </Enter>
      )}
    </Screen>
  )
}

function Header({ user, isMe, signedIn }: { user: PublicUser; isMe: boolean; signedIn: boolean }) {
  const [picking, setPicking] = useState(false)
  const { user: me } = useAuth()
  // my own picture follows the sheet at once, before the profile reloads
  const avatar = isMe && me?.avatar ? me.avatar : user.avatar
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Swap k={avatar ?? ''}><AvatarArt id={avatar} userId={user.id} size={64} /></Swap>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><H style={{ marginBottom: 0 }}>{displayName(user)}</H>{user.staff ? <AdminBadge /> : null}</View>
          <T small muted>@{user.handle} · {t('member since {date}', { date: fmtDay(user.created_at) })}</T>
        </View>
      </View>
      {isMe && (
        <Row>
          <Button title={t('Choose a picture')} small onPress={() => setPicking(true)} />
        </Row>
      )}
      {isMe ? <AvatarSheet open={picking} onClose={() => setPicking(false)} /> : null}
      {!isMe && signedIn && <ModerationActions user={user} />}
    </Card>
  )
}

/** Report / Block / Unblock for someone else's profile. Block state comes from GET /blocks, not the profile payload. */
function ModerationActions({ user }: { user: PublicUser }) {
  const toast = useToast()
  const { state, mutate } = useLoad(() => listBlocks(), [user.id])
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Last action wins over the fetched list, so Block still works when GET /blocks failed (treated as "not blocked").
  const [override, setOverride] = useState<boolean | null>(null)
  const blocked = override ?? (state.kind === 'ready' && state.data.some(b => b.user_id === user.id))
  const toggle = async () => {
    if (state.kind === 'loading') return
    if (!blocked && !(await confirmAsync(t('Block @{handle}?', { handle: user.handle }), t('Their posts and shared {many} disappear from your feeds. You can unblock them here or in Settings.', { many: NOUN.many }), tc('verb', 'Block')))) return
    setBusy(true); setErr(null)
    try {
      if (blocked) { await unblockUser(user.id); setOverride(false); mutate(bs => bs.filter(b => b.user_id !== user.id)); toast.show(t('Unblocked @{handle}', { handle: user.handle })) }
      else { await blockUser(user.id); setOverride(true); mutate(bs => [...bs, { user_id: user.id, handle: user.handle, display_name: user.display_name }]); toast.show(t('Blocked @{handle}', { handle: user.handle })) }
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <>
      <Row>
        <Button title={t('Report user')} small onPress={() => setReport({ kind: 'user', id: user.id, label: `@${user.handle}` })} />
        <Button title={busy ? '…' : blocked ? t('Unblock') : tc('verb', 'Block')} small danger={!blocked} disabled={busy || state.kind === 'loading'} onPress={() => { void toggle() }} />
        {blocked && <Enter><T small muted>{t('You have blocked this user.')}</T></Enter>}
      </Row>
      {state.kind === 'error' && <T small muted>{t('Block status unavailable: {error}', { error: state.message })}</T>}
      {err && <ErrorText>{err}</ErrorText>}
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </>
  )
}

/** Site admin only: take the name away. The handle becomes reader<id> at once; the reader must choose a new name and
 *  handle the next time they open the app (components/ForcedRename.tsx). Optionally a display name to show meanwhile. */
function RenameControl({ user }: { user: PublicUser }) {
  const toast = useToast()
  const router = useRouter()
  const [shown, setShown] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async () => {
    if (!(await confirmAsync(t("Take @{handle}'s name away?", { handle: user.handle }), t('Their handle and name are replaced now, and they must choose new ones the next time they open {brand}.', { brand: BRAND.name }), t('Take it away')))) return
    setBusy(true); setErr(null)
    try {
      const r = await forceRename(user.id, shown.trim() || undefined)
      toast.show(t('Now @{handle} ({name})', { handle: r.handle, name: r.display_name }))
      router.replace(`/u/${encodeURIComponent(r.handle)}`)
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Card>
      <T bold>{t('Force a name change')}</T>
      <T small muted>{t('Admin only. Replaces the handle with a placeholder and makes them choose a new name and handle. The name shown until then is “Reader”, or what you put here.')}</T>
      <Input placeholder={t('Name shown meanwhile (optional)')} value={shown} onChangeText={setShown} maxLength={60} />
      <Button small danger title={busy ? t('Working…') : t('Take the name away')} disabled={busy} onPress={() => { void go() }} style={{ alignSelf: 'flex-start' }} />
      {err && <ErrorText>{err}</ErrorText>}
    </Card>
  )
}

/** Site admin only: the supporter flag, which grants or takes back the secret Supporter badge at once. */
function SupporterControl({ user, onChange }: { user: PublicUser; onChange: () => void }) {
  const toast = useToast()
  const [on, setOn] = useState(!!user.supporter)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const flip = async (v: boolean) => {
    if (busy) return
    setBusy(true); setErr(null); setOn(v)
    try {
      const r = await setSupporter(user.id, v)
      setOn(r.supporter)
      toast.show(r.supporter ? t('Supporter badge given') : t('Supporter badge taken back'))
      onChange()
    } catch (e) { setOn(!v); setErr(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Card>
      <SwitchRow label={t('Supporter')} hint={t('Admin only. Shows the secret Supporter badge on this account.')} value={on} onChange={v => { void flip(v) }} />
      {err && <ErrorText>{err}</ErrorText>}
    </Card>
  )
}

function PublicBody({ stats, badges }: { stats: ProfileStats; badges: Badge[] }) {
  const tiles: [string, string][] = [
    [t('Active time'), fmtDuration(stats.total_active_seconds)],
    [t('Chapters'), String(stats.chapters_read)],
    [t('Books completed'), String(stats.books_completed)],
    [t('Longest streak'), tc('days', '{n} d', { n: stats.streak.longest })],
  ]
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {tiles.map(([label, value]) => (
          <Card key={label} style={{ width: '47%', flexGrow: 1, gap: 2 }}>
            <T small muted>{label}</T>
            <T bold style={{ fontSize: 22 }}>{value}</T>
          </Card>
        ))}
      </View>
      <H2>{t('Badges')}</H2>
      {badges.length === 0 && <T muted>{t('No badges earned yet.')}</T>}
      <BadgeGrid badges={badges} footer={b => b.earned_at ? <T small muted>{fmtDay(b.earned_at)}</T> : null} />
    </>
  )
}
