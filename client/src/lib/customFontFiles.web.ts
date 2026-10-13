/**
 * Web storage for added fonts: the bytes in IndexedDB (a database of their own, so the chapter store's schema version
 * is never touched), keyed "<id>/<face>". Every face of a font is linked into one family with real weight and style
 * descriptors, as public/index.html does for Literata.
 */
import { FACE_KEYS, sniffFont, webFamily, type CustomFont, type FaceKey } from './customFonts'

const DB = 'berean-fonts'
const STORE = 'faces'
let dbp: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return }
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  dbp.catch(() => { dbp = null })
  return dbp
}
function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(db => new Promise<T>((resolve, reject) => {
    const r = run(db.transaction(STORE, mode).objectStore(STORE))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  }))
}

export async function storeBytes(id: string, face: FaceKey, bytes: Uint8Array): Promise<string> {
  if (!sniffFont(bytes)) throw new Error('not a font')
  const key = `${id}/${face}`
  await tx('readwrite', s => s.put(bytes.slice().buffer, key))
  return key
}

export async function storeFromUrl(id: string, face: FaceKey, url: string): Promise<{ path: string; bytes: Uint8Array }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const bytes = new Uint8Array(await res.arrayBuffer())
  return { path: await storeBytes(id, face, bytes), bytes }
}

/** A hidden file input; resolves null when the dialog is dismissed. */
export function pickFontFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.ttf,.otf,font/ttf,font/otf'
    input.addEventListener('cancel', () => resolve(null))
    input.addEventListener('change', () => {
      const f = input.files?.[0]
      if (!f) { resolve(null); return }
      f.arrayBuffer().then(b => resolve({ name: f.name, bytes: new Uint8Array(b) }), () => resolve(null))
    })
    input.click()
  })
}

export async function removeFontFiles(id: string): Promise<void> {
  try { await tx('readwrite', s => s.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`))) } catch { /* nothing stored */ }
  const family = webFamily(id)
  for (const f of Array.from(document.fonts)) if (f.family.replace(/["']/g, '') === family) document.fonts.delete(f)
  linked.delete(id)
}

const DESC: Record<FaceKey, FontFaceDescriptors> = { regular: { weight: '400', style: 'normal' }, bold: { weight: '700', style: 'normal' }, italic: { weight: '400', style: 'italic' } }
const linked = new Set<string>()
export async function registerFaces(font: CustomFont): Promise<void> {
  if (linked.has(font.id)) return
  const faces: FontFace[] = []
  for (const k of FACE_KEYS) {
    const key = font.faces[k]
    if (!key) continue
    const buf = await tx<ArrayBuffer | undefined>('readonly', s => s.get(key))
    if (!buf) throw new Error('font file missing')
    faces.push(new FontFace(webFamily(font.id), buf, { ...DESC[k], display: 'swap' }))
  }
  await Promise.all(faces.map(f => f.load()))
  for (const f of faces) document.fonts.add(f)
  linked.add(font.id)
}
