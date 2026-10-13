import GoogleLogo from '../src/components/GoogleLogo'
import { useCallback, useEffect, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { useRouter } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import * as Google from 'expo-auth-session/providers/google'
import { hasAnyClientId, useGoogleClientIds, type GoogleClientIds } from '../src/lib/google'
import { useAuth } from '../src/store/auth'
import { useToast } from '../src/store/toast'
import { usePrefsStore } from '../src/store/prefs'
import { useColors } from '../src/hooks/useTheme'
import { Button, Enter, ErrorText, H, Row, Screen, T } from '../src/components/ui'
import { BusyDots, FadeSwap, FocusInput, ShakeIn, easeNextLayout } from '../src/components/motion/nav'

WebBrowser.maybeCompleteAuthSession()

export default function Login() {
  const router = useRouter()
  const auth = useAuth()
  const toast = useToast()
  const googleIds = useGoogleClientIds()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [handle, setHandle] = useState('')
  // the name given in the welcome, if any, is offered as the display name
  const prefs = usePrefsStore()
  const [displayName, setDisplayName] = useState(() => prefs.get().readerName)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErrText] = useState('')
  // bumps on every failure so a repeated message still shakes
  const [errN, setErrN] = useState(0)
  const setErr = useCallback((m: string) => { setErrText(m); if (m) setErrN(n => n + 1) }, [])
  const c = useColors()

  const done = useCallback(() => { toast.show('Signed in'); if (router.canGoBack()) router.back(); else router.replace('/') }, [toast, router])
  const submit = async () => {
    if (busy || !handle.trim() || !password) return
    setBusy(true); setErr('')
    try {
      if (mode === 'login') await auth.login(handle.trim(), password)
      else await auth.register(handle.trim(), displayName.trim() || handle.trim(), password)
      done()
    } catch (e) { setErr((e as Error).message || 'Sign in failed') } finally { setBusy(false) }
  }
  const onGoogleToken = useCallback(async (idToken: string) => {
    setBusy(true); setErr('')
    try { await auth.google(idToken); done() } catch (e) { setErr((e as Error).message || 'Google sign-in failed') } finally { setBusy(false) }
  }, [auth, done, setErr])
  const googleReady = !!googleIds && hasAnyClientId(googleIds)
  // switching mode swaps the title and opens or closes the one field that differs; the rest of the form stays put
  const flip = () => { easeNextLayout(prefs.get().reduceMotion); setMode(m => m === 'login' ? 'register' : 'login'); setErr('') }

  return (
    <Screen>
      <View style={{ gap: 12 }}>
        <FadeSwap k={mode}><H>{mode === 'login' ? 'Sign in' : 'Create account'}</H></FadeSwap>
        <FocusInput placeholder="Handle" value={handle} onChangeText={setHandle} autoCapitalize="none" autoCorrect={false} textContentType="username" />
        {mode === 'register' && <Enter><FocusInput placeholder="Display name" value={displayName} onChangeText={setDisplayName} /></Enter>}
        <FocusInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="password" onSubmitEditing={() => { void submit() }} />
        {err ? <ShakeIn k={errN}><ErrorText>{err}</ErrorText></ShakeIn> : null}
        <View>
          <Button
            primary
            title={mode === 'login' ? 'Sign in' : 'Create account'}
            onPress={() => { void submit() }}
            disabled={!busy && (!handle.trim() || !password)}
            accessibilityState={{ busy }}
            textStyle={busy ? { opacity: 0 } : undefined} />
          {/* busy keeps the button's full colour and swaps the label for breathing dots */}
          {busy ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}><BusyDots color={c.accentText} /></View> : null}
        </View>
        {googleReady && googleIds && (
          <>
            <T small muted style={{ textAlign: 'center' }}>or</T>
            {Platform.select({ android: googleIds.android, ios: googleIds.ios, default: googleIds.web })
              ? <GoogleButton ids={googleIds} disabled={busy} onToken={onGoogleToken} onError={setErr} />   // the provider hook throws without this platform's own id
              : null}
          </>
        )}
      </View>
      <T small muted>No email and no password reset here{googleReady ? '; use Google if you would rather not keep a password' : ''}.</T>
      <Row style={{ justifyContent: 'center', marginTop: 8 }}>
        <T muted>{mode === 'login' ? 'No account?' : 'Already registered?'}</T>
        <Button small title={mode === 'login' ? 'Create account' : 'Sign in'} onPress={flip} />
      </Row>
      <View style={{ height: 24 }} />
    </Screen>
  )
}

/** Rendered only once at least one client id is known, so the provider hook is never mounted without config. */
function GoogleButton({ ids, disabled, onToken, onError }: { ids: GoogleClientIds; disabled: boolean; onToken: (idToken: string) => void; onError: (m: string) => void }) {
  const [request, response, promptAsync] = Google.useIdTokenAuthRequest({ iosClientId: ids.ios, androidClientId: ids.android, webClientId: ids.web })
  useEffect(() => {
    if (!response) return
    if (response.type === 'success') {
      const t = response.params.id_token
      if (t) onToken(t); else onError('Google returned no id token')
    } else if (response.type === 'error') onError(response.error?.message ?? 'Google sign-in failed')
  }, [response, onToken, onError])
  return <Button title="Continue with Google" leadNode={<GoogleLogo />} disabled={!request || disabled} onPress={() => { promptAsync().catch(e => onError((e as Error).message)) }} />
}
