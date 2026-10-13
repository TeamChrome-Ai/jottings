import Constants from 'expo-constants'
import { Platform } from 'react-native'

interface Extra { apiBase?: string; apiBaseDev?: Partial<Record<'android' | 'ios' | 'web', string>>; googleClientIds?: { ios?: string; android?: string; web?: string } }
const extra = (Constants.expoConfig?.extra ?? {}) as Extra

/** app.json `extra.apiBase`, or the emulator-friendly dev default when running under `expo start`. */
export function defaultApiBase(): string {
  if (Platform.OS === 'web' && !__DEV__) return ''            // served by the Rust binary: same origin
  if (__DEV__) {
    const dev = extra.apiBaseDev ?? {}
    return dev[Platform.OS as keyof typeof dev] ?? dev.web ?? 'http://localhost:8787'
  }
  return extra.apiBase ?? ''
}
export const googleClientIds = extra.googleClientIds ?? {}
export const googleEnabled = Boolean(googleClientIds.ios || googleClientIds.android || googleClientIds.web)
