import { useState } from 'react'
import { View } from 'react-native'
import { get, patch } from '../lib/api'
import { errMsg } from '../lib/community'
import { useAuth } from '../store/auth'
import type { User } from '@shared/types'
import { Button, ErrorText, Input, Sheet, T } from './ui'
import { BRAND } from '@shared/brand'
import { t } from '@shared/i18n'

/**
 * The admin took this reader's name away (rs/src/feedback.rs force_rename): before anything else they choose a new
 * display name and handle, in a sheet that cannot be closed. The server checks both (allowed words, handle free and
 * not the placeholder) and clears the flag. Mounted by the root layout.
 */
export default function ForcedRename() {
  const { user, update, logout } = useAuth()
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!user?.must_rename) return null
  const save = async () => {
    setBusy(true); setErr(null)
    try {
      await patch('/me', { display_name: name.trim(), handle: handle.trim() })
      const r = await get<{ user: User }>('/me')
      update(r.user); setName(''); setHandle('')
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet open onClose={() => {}} title={t('Choose a new name')}>
      <View style={{ padding: 16, gap: 10 }}>
        <T muted>{t('Your name and handle were changed by the {brand} developer. Please choose new ones to carry on; everything you have made is still here.', { brand: BRAND.name })}</T>
        <Input placeholder={t('Your name')} value={name} onChangeText={setName} maxLength={60} autoComplete="name" />
        <Input placeholder={t('Handle (3 to 24 letters, numbers or _)')} value={handle} onChangeText={t => setHandle(t.replace(/[^A-Za-z0-9_]/g, '').toLowerCase())} maxLength={24} autoCapitalize="none" autoCorrect={false} />
        {err && <ErrorText>{err}</ErrorText>}
        <Button primary title={busy ? t('Saving…') : t('Save')} disabled={busy || !name.trim() || handle.length < 3} onPress={() => { void save() }} />
        <Button small title={t('Sign out instead')} onPress={() => { void logout() }} />
      </View>
    </Sheet>
  )
}
