import { useRef, useState } from 'react'
import { Linking, Platform, StyleSheet, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'
import { inviteToken } from '@shared/friends'
import { t } from '@shared/i18n'
import { errMsg } from '../../src/lib/community'
import { peekToken, redeemToken } from '../../src/lib/friends'
import { useColors } from '../../src/hooks/useTheme'
import { useToast } from '../../src/store/toast'
import Avatar from '../../src/components/Avatar'
import { Button, Card, ErrorText, Grow, Row, Screen, Spinner, T } from '../../src/components/ui'
import { BRAND } from '@shared/brand'

const FRAME = 240

/**
 * Scan a friend's invite code (native only; on the web the code is shown, not scanned). The camera is asked for here
 * and only here, and it reads QR codes only; a code that is not one of the app's invites is ignored with one word.
 */
export default function ScanScreen() {
  if (Platform.OS === 'web') {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('Scan a code') }} />
        <Card><T muted>{t('Scanning a code needs the {brand} app. On the web, ask your friend for their invite link instead.', { brand: BRAND.name })}</T></Card>
      </Screen>
    )
  }
  return <Scanner />
}

function Scanner() {
  const router = useRouter()
  const toast = useToast()
  const c = useColors()
  const [perm, request] = useCameraPermissions()
  const [found, setFound] = useState<{ token: string; handle: string; display_name: string; avatar?: string; friends: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lastMiss = useRef(0)
  const looking = useRef(false)
  const onScan = (r: BarcodeScanningResult) => {
    if (found || looking.current) return
    const token = inviteToken(r.data)
    if (!token) {
      if (Date.now() - lastMiss.current > 3000) { lastMiss.current = Date.now(); toast.show(t('Not an invite code')) }
      return
    }
    looking.current = true
    peekToken(token).then(w => setFound({ token, ...w })).catch(e => setErr(errMsg(e))).finally(() => { looking.current = false })
  }
  const send = async () => {
    if (!found) return
    setBusy(true)
    try {
      const r = await redeemToken(found.token)
      toast.show(r.status === 'friends' ? t('You and {name} are friends', { name: r.friend.display_name }) : t('Invite sent to {name}', { name: r.friend.display_name }))
      router.back()
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  if (!perm) return <Screen><Stack.Screen options={{ title: t('Scan a code') }} /><Spinner /></Screen>
  if (!perm.granted) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t('Scan a code') }} />
        <Card>
          <T>{t('{brand} uses the camera only to read a friend’s invite code. Nothing is recorded or kept.', { brand: BRAND.name })}</T>
          {perm.canAskAgain
            ? <Button primary title={t('Allow the camera')} onPress={() => { void request() }} style={{ alignSelf: 'flex-start' }} />
            : <><T small muted>{t('The camera is off for {brand} in the system settings.', { brand: BRAND.name })}</T><Button title={t('Open system settings')} onPress={() => { Linking.openSettings().catch(() => {}) }} style={{ alignSelf: 'flex-start' }} /></>}
        </Card>
      </Screen>
    )
  }
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ title: t('Scan a code') }} />
      <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={found ? undefined : onScan} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <View style={{ width: FRAME, height: FRAME, borderRadius: 28, borderWidth: 3, borderColor: c.accent }} />
        <View style={{ marginTop: 16, backgroundColor: c.bg, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 }}><T small>{t('Point at a friend’s code')}</T></View>
      </View>
      {found || err ? (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: 32 }}>
          <Grow from={0.9}>
            <Card style={{ gap: 12 }}>
              {err ? <><ErrorText>{err}</ErrorText><Button small title={t('Try again')} onPress={() => { setErr(null); setFound(null) }} style={{ alignSelf: 'flex-start' }} /></> : null}
              {found && !err ? (
                <>
                  <Row style={{ flexWrap: 'nowrap', gap: 12 }}>
                    <Avatar name={found.display_name} avatar={found.avatar} size={44} />
                    <View style={{ flex: 1 }}><T bold>{found.display_name}</T><T small muted>@{found.handle}</T></View>
                  </Row>
                  {found.friends ? <T small muted>{t('You are already friends.')}</T> : (
                    <Row>
                      <Button primary title={busy ? t('Sending…') : t('Send an invite')} disabled={busy} onPress={() => { void send() }} />
                      <Button title={t('Not now')} onPress={() => setFound(null)} />
                    </Row>
                  )}
                </>
              ) : null}
            </Card>
          </Grow>
        </View>
      ) : null}
    </View>
  )
}
