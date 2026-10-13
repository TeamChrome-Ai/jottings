import { Platform, Share } from 'react-native'
import * as Clipboard from 'expo-clipboard'

export interface ShareInput { title?: string; message: string; url?: string }

/**
 * Share text (and a link) the way the platform can. Native uses the system sheet. On the web,
 * `navigator.share` exists only on phones and some Macs; desktop browsers get the text copied to the
 * clipboard instead. Returns what happened so the caller can toast "Link copied".
 */
export async function shareText(input: ShareInput): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const text = input.url && !input.message.includes(input.url) ? `${input.message}\n${input.url}` : input.message
  if (Platform.OS === 'web') {
    const nav = globalThis.navigator as Navigator & { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void>; canShare?: (d: object) => boolean }
    if (nav?.share) {
      try { await nav.share({ title: input.title, text: input.message, url: input.url }); return 'shared' }
      catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled' }
    }
    try { await Clipboard.setStringAsync(text); return 'copied' } catch { return 'failed' }
  }
  try {
    // iOS wants the url separately; Android puts everything in the message
    const r = await Share.share(Platform.OS === 'ios' ? { title: input.title, message: input.message, url: input.url } : { title: input.title, message: text }, { dialogTitle: input.title })
    return r.action === Share.dismissedAction ? 'cancelled' : 'shared'
  } catch { return 'failed' }
}
