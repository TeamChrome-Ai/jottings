/** Native storage for added fonts: <documentDirectory>/fonts/<id>/<face>.<ext>, which survives cache clears. */
import { Directory, File, Paths } from 'expo-file-system'
import { loadAsync } from 'expo-font'
import { FACE_KEYS, nativeFamily, sniffFont, type CustomFont, type FaceKey } from './customFonts'

const dirFor = (id: string) => new Directory(Paths.document, 'fonts', id)
const fileAt = (path: string) => new File(Paths.document, ...path.split('/'))

function writeFace(id: string, face: FaceKey, bytes: Uint8Array): string {
  const kind = sniffFont(bytes)
  if (kind !== 'ttf' && kind !== 'otf') throw new Error('not a font')
  const dir = dirFor(id)
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  const path = `fonts/${id}/${face}.${kind}`
  const f = fileAt(path)
  if (f.exists) f.delete()
  f.write(bytes)
  return path
}

/** Downloads one face; the stored path and the bytes (the caller measures the Regular face), or a thrown error when
 *  the bytes are not a TrueType or OpenType font. */
export async function storeFromUrl(id: string, face: FaceKey, url: string): Promise<{ path: string; bytes: Uint8Array }> {
  const dir = dirFor(id)
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  const tmp = new File(dir, `${face}.download`)
  const got = await File.downloadFileAsync(url, tmp, { idempotent: true })
  try { const bytes = await got.bytes(); return { path: writeFace(id, face, bytes), bytes } } finally { if (got.exists) got.delete() }
}

/** The system picker. Font MIME types vary by provider (often octet-stream), so any file is offered and the bytes decide. */
export async function pickFontFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const r = await File.pickFileAsync({ mimeTypes: '*/*' })
  if (r.canceled) return null
  return { name: r.result.name, bytes: await r.result.bytes() }
}

export async function storeBytes(id: string, face: FaceKey, bytes: Uint8Array): Promise<string> {
  return writeFace(id, face, bytes)
}

export async function removeFontFiles(id: string): Promise<void> {
  try { const d = dirFor(id); if (d.exists) d.delete() } catch { /* already gone */ }
}

/** Registers each stored face under its own family name, as the bundled fonts are. */
export async function registerFaces(font: CustomFont): Promise<void> {
  const map: Record<string, string> = {}
  for (const k of FACE_KEYS) {
    const path = font.faces[k]
    if (!path) continue
    const f = fileAt(path)
    if (!f.exists) throw new Error('font file missing')
    map[nativeFamily(font.id, k)] = f.uri
  }
  await loadAsync(map)
}
