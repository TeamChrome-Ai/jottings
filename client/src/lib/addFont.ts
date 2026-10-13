import type { PrefsStore } from '../store/prefs'
import { Platform } from 'react-native'
import { pickFontFile, removeFontFiles, storeBytes, storeFromUrl } from './customFontFiles'
import { customKey, lineFloorOf, nameFromFile, newFontId, sniffFont, type CustomFont, type FaceKey } from './customFonts'
import { forgetFont, lazyFontState, loadCustomFont } from './fonts'
import { familyCandidates, googleCssUrl, parseGoogleCss } from './googleFonts'

/** A failure worth showing as it is: the message is the one line the sheet prints. */
export class FontAddError extends Error {}

/** Registers the stored faces before the record is returned, so a font that cannot render never reaches the list. */
async function finish(font: CustomFont): Promise<CustomFont> {
  await loadCustomFont(font)
  if (lazyFontState(customKey(font.id)) !== 'ready') {
    forgetFont(customKey(font.id))
    await removeFontFiles(font.id)
    throw new FontAddError('That font could not be used on this device.')
  }
  return font
}

/** Tells "offline" from "no such family" by asking for a family that exists. */
const googleReachable = (headers: Record<string, string>) =>
  fetch(googleCssUrl('Lora'), { headers }).then(r => r.ok, () => false)

/**
 * Finds the family on Google Fonts and stores Regular, Bold and Italic where the family has them. Native asks with a
 * plain user agent, which gets whole TTF files; a browser sends its own and gets WOFF2, which it can use as well.
 */
export async function addGoogleFont(input: string): Promise<CustomFont> {
  const headers: Record<string, string> = Platform.OS === 'web' ? {} : { 'User-Agent': 'Mozilla/5.0' }
  let parsed: ReturnType<typeof parseGoogleCss> | null = null, family = '', answered = false
  for (const name of familyCandidates(input)) {
    let res: Response
    // the "family not found" page carries no CORS header, so in a browser an unknown name also lands here
    try { res = await fetch(googleCssUrl(name), { headers }) } catch { continue }
    answered = true
    if (res.status === 400) continue
    if (!res.ok) throw new FontAddError(`Google Fonts answered ${res.status}. Try again later.`)
    const p = parseGoogleCss(await res.text())
    if (p.regular) { parsed = p; family = p.family ?? name; break }
  }
  if (!parsed?.regular) {
    if (!answered && !(await googleReachable(headers))) throw new FontAddError('Google Fonts could not be reached. Check the connection and try again.')
    throw new FontAddError(`No Google font called “${input.trim()}”. Check the spelling on fonts.google.com.`)
  }
  const id = newFontId(family)
  const src = parsed
  const get = (k: FaceKey) => { const f = src[k]; return f ? storeFromUrl(id, k, f.url) : Promise.reject(new Error('absent')) }
  const [regular, bold, italic] = await Promise.allSettled([get('regular'), get('bold'), get('italic')])
  if (regular.status === 'rejected') {
    await removeFontFiles(id)
    throw new FontAddError('The font files did not download. Check the connection and try again.')
  }
  const faces: CustomFont['faces'] = { regular: regular.value.path }
  if (bold.status === 'fulfilled') faces.bold = bold.value.path
  if (italic.status === 'fulfilled') faces.italic = italic.value.path
  // the line height floor is measured from the Regular face (a browser gets WOFF2, which measures as nothing)
  const minLine = lineFloorOf(regular.value.bytes)
  return finish({ id, name: family, source: 'google', faces, ...(minLine ? { minLine } : null) })
}

/** A .ttf or .otf from the device, stored as the Regular face; null when the picker is dismissed. `onPicked` fires once a file is chosen. */
export async function addFontFromFile(onPicked?: () => void): Promise<CustomFont | null> {
  const picked = await pickFontFile()
  if (!picked) return null
  onPicked?.()
  const kind = sniffFont(picked.bytes)
  if (kind !== 'ttf' && kind !== 'otf') throw new FontAddError('That file is not a TrueType or OpenType font (.ttf or .otf).')
  const name = nameFromFile(picked.name)
  const id = newFontId(name)
  let regular: string
  try { regular = await storeBytes(id, 'regular', picked.bytes) } catch { await removeFontFiles(id); throw new FontAddError('The font could not be saved on this device.') }
  const minLine = lineFloorOf(picked.bytes)
  return finish({ id, name, source: 'file', faces: { regular }, ...(minLine ? { minLine } : null) })
}

/** Deletes the stored files; the caller drops the record from prefs. */
export async function deleteFont(id: string): Promise<void> {
  forgetFont(customKey(id))
  await removeFontFiles(id)
}

/** Forget a custom font: out of the prefs list (the reader falls back to the serif face if it was in use) and its files gone. */
export function removeCustomFont(store: Pick<PrefsStore, 'get' | 'set'>, f: CustomFont): void {
  const p = store.get()
  store.set({ customFonts: p.customFonts.filter(x => x.id !== f.id), font: p.font === customKey(f.id) ? 'serif' : p.font })
  void deleteFont(f.id)
}
