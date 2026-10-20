import { useEffect, useState } from 'react'
import { Linking, Platform, View } from 'react-native'
import { useRouter } from 'expo-router'
import { loadFriends, saveFriendPrefs, type FriendPrefs } from '../../lib/friends'
import { errMsg } from '../../lib/community'
import { askNotifyPermission, notifyPermission, type NotifyPermission } from '../../lib/streakReminder'
import { usePref, usePrefsStore } from '../../store/prefs'
import { Button, Card, ErrorText, ListRow, Sheet, Spinner, SwitchRow, T } from '../ui'
import { SheetBody } from '../CommunityBits'
import { BRAND } from '@shared/brand'
import { t, tc } from '@shared/i18n'

/**
 * Settings → Account → Friends: who can invite you, being told of an invite, what friends see, reactions, being found
 * through contacts, and the way to the Friends screen. Every switch saves at once; everything off is the app without
 * friends. "Notify me of friend invites" is this device's (the background check lives here), the rest the account's.
 */
export default function FriendsSettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={t('Friends')}>
      {open ? <Body onClose={onClose} /> : null}
    </Sheet>
  )
}

/** The device's switch for invite notices; turning it on asks for notifications if the system has no answer yet. */
function InviteNotify() {
  const on = usePref('inviteNotify')
  const { set } = usePrefsStore()
  const native = Platform.OS !== 'web'
  const [perm, setPerm] = useState<NotifyPermission | null>(null)
  useEffect(() => { if (native) notifyPermission().then(setPerm).catch(() => {}) }, [native])
  const toggle = (v: boolean) => {
    set({ inviteNotify: v })
    if (v && native) askNotifyPermission().then(setPerm).catch(() => {})
  }
  return (
    <>
      <SwitchRow label={t('Notify me of friend invites')} hint={native ? t('A notification when someone invites you, checked about every 15 minutes') : t('A note in the app when someone invites you')} value={on} onChange={toggle} />
      {on && native && perm === 'denied' ? (
        <View style={{ gap: 8, paddingBottom: 8 }}>
          <T small muted>{t('Notifications are off for {brand} in the system settings, so invites show only in the app.', { brand: BRAND.name })}</T>
          <Button small title={t('Open system settings')} onPress={() => { Linking.openSettings().catch(() => {}) }} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
    </>
  )
}

function Body({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [prefs, setPrefs] = useState<FriendPrefs | null>(null)
  const [found, setFound] = useState<boolean | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { loadFriends().then(o => { setPrefs(o.settings); setFound(o.discoverable) }).catch(e => setErr(errMsg(e))) }, [])
  const flip = (k: keyof FriendPrefs) => (v: boolean) => {
    if (!prefs) return
    const was = prefs
    setPrefs({ ...prefs, [k]: v }); setErr(null)
    saveFriendPrefs({ [k]: v }).then(setPrefs).catch(e => { setPrefs(was); setErr(errMsg(e)) })
  }
  const go = (path: '/friends' | '/friends/contacts') => { onClose(); setTimeout(() => router.push(path), 240) }
  return (
    <SheetBody>
      {!prefs && !err ? <Spinner /> : null}
      {err ? <ErrorText>{err}</ErrorText> : null}
      {prefs ? (
        <>
          <Card style={{ gap: 0, paddingVertical: 8 }}>
            <SwitchRow label={t('Allow friend invites')} hint={prefs.invites ? t('Someone who knows your handle, or scans your code, can invite you') : t('Off: nobody can invite you, and codes you have shown stop working')} value={prefs.invites} onChange={flip('invites')} />
            {prefs.invites ? <InviteNotify /> : null}
          </Card>
          <T small muted style={{ marginTop: 6 }}>{t('What friends see')}</T>
          <Card style={{ gap: 0, paddingVertical: 8 }}>
            <SwitchRow label={t('My streak')} hint={t('Your streak and this week’s days; a friend streak needs you both')} value={prefs.share_streak} onChange={flip('share_streak')} />
            <SwitchRow label={t('My badges')} value={prefs.share_badges} onChange={flip('share_badges')} />
            <SwitchRow label={t('Chapters this week')} hint={t('How many, never which, and never where you are reading')} value={prefs.share_reading} onChange={flip('share_reading')} />
            <SwitchRow label={t('Reactions')} hint={t('A heart, a smile, applause or a seal on badges; no words')} value={prefs.reactions} onChange={flip('reactions')} />
          </Card>
          <Card style={{ gap: 0, paddingVertical: 8 }}>
            <ListRow icon="contacts" label={t('Let contacts find me')} detail={found ? tc('state', 'On') : tc('state', 'Off')} onPress={() => go('/friends/contacts')} />
            <ListRow icon="users" label={t('Your friends')} detail={t('Invites, friend streaks, remove or block')} onPress={() => go('/friends')} />
          </Card>
          <View style={{ height: 4 }} />
        </>
      ) : null}
    </SheetBody>
  )
}
