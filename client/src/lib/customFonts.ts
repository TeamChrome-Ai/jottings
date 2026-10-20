/**
 * Fonts the reader added (Google Fonts or a file from the device). Pure data and naming only, so theme.ts and the
 * prefs store can use it without pulling in file storage or font loading.
 */
import { t } from '@shared/i18n'

export type FaceKey = 'regular' | 'bold' | 'italic'
export const FACE_KEYS: readonly FaceKey[] = ['regular', 'bold', 'italic']
export interface CustomFont {
  id: string
  name: string
  source: 'google' | 'file'
  /**
   * Where each face is stored: a path under the document directory on native (never an absolute URI: the iOS
   * container path changes between app updates), an IndexedDB key on web. Regular is always present.
   */
  faces: { regular: string; bold?: string; italic?: string }
  /** The tightest line height (× size) the Regular face can be set on without clipping its descenders, measured from
   *  the file when the font was added (lineFloorOf); absent when it could not be (a WOFF2 on the web, older records). */
  minLine?: number
}
export const CUSTOM_PREFIX = 'custom:'
export type CustomFontKey = `custom:${string}`
export const customKey = (id: string): CustomFontKey => `${CUSTOM_PREFIX}${id}`
export const isCustomKey = (font: string): font is CustomFontKey => font.startsWith(CUSTOM_PREFIX)
export const customIdOf = (font: string): string | null => (isCustomKey(font) ? font.slice(CUSTOM_PREFIX.length) : null)

/** Native registers one family name per face; web links every face into the single `webFamily`. */
export const nativeFamily = (id: string, face: FaceKey) => (face === 'regular' ? `Custom-${id}` : `Custom-${id}-${face === 'bold' ? 'Bold' : 'Italic'}`)
export const webFamily = (id: string) => `Custom ${id}`

/** An id safe in a file path, a family name and a pref value: slug of the name plus a random tail. */
export function newFontId(name: string, rand: () => number = Math.random): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 24).replace(/^-+|-+$/g, '') || 'font'
  return `${slug}-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')}`
}

/** What a font file is, from its first four bytes; the extension and MIME type of a picked file are not trusted. */
export function sniffFont(bytes: Uint8Array): 'ttf' | 'otf' | 'woff' | 'woff2' | null {
  if (bytes.length < 4) return null
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if ((bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) || tag === 'true') return 'ttf'
  if (tag === 'OTTO') return 'otf'
  if (tag === 'wOFF') return 'woff'
  if (tag === 'wOF2') return 'woff2'
  return null
}

/** A display name from a picked file name: "EBGaramond-Regular.ttf" becomes "EBGaramond". */
export function nameFromFile(file: string): string {
  const base = file.replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, '')
  const trimmed = base.replace(/[-_ ]?(regular|roman|book|normal)$/i, '').replace(/[-_]+/g, ' ').trim()
  return (trimmed || base || t('My font')).slice(0, 40)
}

const ID_RE = /^[a-z0-9-]{1,40}$/
/** Stored records are checked field by field; anything malformed is dropped rather than half-loaded. */
export function cleanCustomFonts(raw: unknown): CustomFont[] {
  if (!Array.isArray(raw)) return []
  const out: CustomFont[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const { id, name, source, faces } = r as Record<string, unknown>
    if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id)) continue
    if (typeof name !== 'string' || !name.trim()) continue
    if (source !== 'google' && source !== 'file') continue
    if (!faces || typeof faces !== 'object') continue
    const f = faces as Record<string, unknown>
    if (typeof f.regular !== 'string' || !f.regular) continue
    const clean: CustomFont['faces'] = { regular: f.regular }
    if (typeof f.bold === 'string' && f.bold) clean.bold = f.bold
    if (typeof f.italic === 'string' && f.italic) clean.italic = f.italic
    seen.add(id)
    const { minLine } = r as Record<string, unknown>
    out.push({ id, name: name.trim(), source, faces: clean, ...(typeof minLine === 'number' && minLine >= 1 && minLine <= 3 ? { minLine } : null) })
  }
  return out
}

/** The font pref and the custom font list, checked together: a custom choice whose record is gone reads as Serif. */
export function migrateFontPrefs(raw: Record<string, unknown>): { font: string; customFonts: CustomFont[] } {
  const customFonts = cleanCustomFonts(raw.customFonts)
  // 'noto' was a bundled choice for a few builds (2026-09); it reads as serif now
  const f = raw.font === 'noto' ? 'serif' : raw.font
  const builtIn = f === 'serif' || f === 'sans' || f === 'dyslexic'
  const id = typeof f === 'string' ? customIdOf(f) : null
  const font = builtIn ? f : id && customFonts.some(c => c.id === id) ? (f as string) : 'serif'
  return { font, customFonts }
}

/**
 * The fonts theme.ts resolves against. The prefs store keeps it in step with `prefs.customFonts` before anything
 * renders with a new list, so `face()` stays a plain function of the font key.
 */
const registry = new Map<string, CustomFont>()
export function setCustomFonts(list: readonly CustomFont[]): void {
  registry.clear()
  for (const f of list) registry.set(f.id, f)
}
export const getCustomFont = (id: string): CustomFont | undefined => registry.get(id)

/**
 * The line height floor of a TrueType or OpenType file, in em: the ascent and descent the platforms lay lines out
 * with (OS/2 typo metrics when USE_TYPO_METRICS is set, else hhea), and the descenders taken as three quarters of
 * the descent, which is where text faces put g, j, p and y (Literata 0.23 of 0.308, Roboto 0.21 of 0.244), so
 * line ≥ 2·(0.75·desc) + asc − desc = asc + 0.5·desc, plus 0.05 for Android's whole-pixel metrics. Bounded to
 * [1.15, 2]; null for anything that is not an sfnt with the three tables (a WOFF, a collection, a bad file).
 */
export function lineFloorOf(bytes: Uint8Array): number | null {
  const kind = sniffFont(bytes)
  if (kind !== 'ttf' && kind !== 'otf') return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 12) return null
  const n = dv.getUint16(4)
  const tables = new Map<string, { off: number; len: number }>()
  for (let i = 0; i < n; i++) {
    const at = 12 + 16 * i
    if (at + 16 > bytes.length) return null
    const tag = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
    tables.set(tag, { off: dv.getUint32(at + 8), len: dv.getUint32(at + 12) })
  }
  const head = tables.get('head'), hhea = tables.get('hhea'), os2 = tables.get('OS/2')
  if (!head || !hhea || head.off + 20 > bytes.length || hhea.off + 8 > bytes.length) return null
  const upm = dv.getUint16(head.off + 18)
  if (!upm) return null
  let asc = dv.getInt16(hhea.off + 4), desc = -dv.getInt16(hhea.off + 6)
  if (os2 && os2.len >= 72 && os2.off + 72 <= bytes.length && dv.getUint16(os2.off + 62) & 0x80) { asc = dv.getInt16(os2.off + 68); desc = -dv.getInt16(os2.off + 70) }
  if (asc <= 0 || desc < 0) return null
  const floor = (asc + 0.5 * desc) / upm + 0.05
  return Math.min(2, Math.max(1.15, Math.round(floor * 100) / 100))
}
