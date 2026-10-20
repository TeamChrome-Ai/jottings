import { useEffect, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { t } from '@shared/i18n'
import { useColors } from '../hooks/useTheme'
import { FontAddError, addFontFromFile, addGoogleFont, removeCustomFont } from '../lib/addFont'
import { customKey, type CustomFont } from '../lib/customFonts'
import { loadLazyFaces, useLazyFontState } from '../lib/fonts'
import { usePrefsStore, usePref } from '../store/prefs'
import { useToast } from '../store/toast'
import { face } from '../theme'
import FontLoading from './FontLoading'
import { Button, Card, ErrorText, Input, SPACE, Sheet, T, TYPE } from './ui'

/** The name is set in the font itself once its faces are registered (an unregistered family name is an error on iOS). */
function FontRow({ font, inUse, disabled, onRemove }: { font: CustomFont; inUse: boolean; disabled: boolean; onRemove: () => void }) {
  const c = useColors()
  const key = customKey(font.id)
  const state = useLazyFontState(key)
  useEffect(() => { void loadLazyFaces(key) }, [key])
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.m, minHeight: 52 }}>
      <View style={{ flex: 1, gap: 1 }}>
        <Text numberOfLines={1} style={{ color: c.text, fontSize: TYPE.body + 2, ...face(state === 'ready' ? key : 'serif') }}>{font.name}</Text>
        <Text style={{ color: c.muted, fontSize: TYPE.caption }}>{font.source === 'google' ? 'Google Fonts' : t('From a file')}{inUse ? ` · ${t('in use')}` : ''}{state === 'failed' ? ` · ${t('could not be loaded')}` : ''}</Text>
      </View>
      <Button small iconName="x" title={t('Remove {font}', { font: font.name })} disabled={disabled} onPress={onRemove} />
    </View>
  )
}

const errText =(e: unknown) => (e instanceof FontAddError ? e.message : t('The font could not be added. Try again.'))

/** Settings → Text → add: a Google Fonts family by name, or a font file from the device; lists and removes added fonts. */
export default function AddFontSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const store = usePrefsStore()
  const fonts = usePref('customFonts')
  const current = usePref('font')
  const toast = useToast()
  const [family, setFamily] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { if (open) setErr('') }, [open])

  const added = (f: CustomFont) => {
    store.set({ customFonts: [...store.get().customFonts, f], font: customKey(f.id) })
    toast.show(t('{font} added', { font: f.name }))
    setFamily('')
    onClose()
  }
  const run = async (work: () => Promise<CustomFont | null>) => {
    if (busy) return
    setErr('')
    try {
      const f = await work()
      if (f) added(f)
    } catch (e) { setErr(errText(e)) } finally { setBusy(false) }
  }
  const fromGoogle = () => {
    const name = family.trim()
    if (!name) return
    const have = store.get().customFonts.find(f => f.source === 'google' && f.name.toLowerCase() === name.toLowerCase())
    if (have) { store.set({ font: customKey(have.id) }); onClose(); return }
    setBusy(true)
    void run(() => addGoogleFont(name))
  }
  // the busy veil goes up once a file is chosen, not while the system picker is open
  const fromFile = () => { void run(() => addFontFromFile(() => setBusy(true))) }
  const remove = (f: CustomFont) => { removeCustomFont(store, f); toast.show(t('{font} removed', { font: f.name })) }

  return (
    <Sheet open={open} onClose={() => { if (!busy) onClose() }} title={fonts.length ? t('Your fonts') : t('Add a font')}>
      <View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: SPACE.m, paddingBottom: SPACE.l, gap: SPACE.xl }} keyboardShouldPersistTaps="handled">
          <View style={{ gap: SPACE.s }} accessibilityState={{ busy }}>
            <T bold>Google Fonts</T>
            <T small muted>{t('The family name as fonts.google.com shows it; Regular, Bold and Italic are kept on this device.')}</T>
            <View style={{ flexDirection: 'row', gap: SPACE.s }}>
              <Input placeholder="Lora, EB Garamond" value={family} onChangeText={t => { setFamily(t); setErr('') }} onSubmitEditing={fromGoogle}
                autoCapitalize="words" autoCorrect={false} returnKeyType="done" editable={!busy} accessibilityLabel={t('Google Fonts family name')} style={{ flex: 1, minWidth: 0 }} />
              <Button primary title={t('Add')} disabled={busy || !family.trim()} onPress={fromGoogle} />
            </View>
          </View>
          <View style={{ gap: SPACE.s }}>
            <T bold>{t('A font file')}</T>
            <T small muted>{t('A .ttf or .otf file from this device, copied into the app.')}</T>
            <Button title={t('Choose a file')} disabled={busy} onPress={fromFile} style={{ alignSelf: 'flex-start' }} />
          </View>
          {err ? <ErrorText>{err}</ErrorText> : null}
          {fonts.length > 0 && (
            <View style={{ gap: SPACE.s }}>
              <T bold>{t('Your fonts')}</T>
              <Card style={{ gap: 0, paddingVertical: SPACE.xs }}>
                {fonts.map(f => <FontRow key={f.id} font={f} inUse={current === customKey(f.id)} disabled={busy} onRemove={() => remove(f)} />)}
              </Card>
            </View>
          )}
        </ScrollView>
        <FontLoading state={busy ? 'loading' : 'none'} />
      </View>
    </Sheet>
  )
}
