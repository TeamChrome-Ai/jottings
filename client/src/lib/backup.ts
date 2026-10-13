/**
 * Back up, restore and import (docs/BACKUP.md): gathering what a backup holds, saving and choosing the file, and
 * putting a file's contents back. The file's rules are `backupFile.ts`; this is the storage, network and dialog side.
 *
 * Restoring only ever adds. A bookmark, a highlight or a jotting already here is left as it is, so a file restored
 * twice changes nothing the second time. Everything goes through the same calls the reader's own taps use
 * (`library.ts`, `highlights.ts`): signed in it lands in the account and is scanned like typed text, signed out it
 * stays on this device.
 */
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import { Directory, File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { ApiError, post } from './api'
import { bookmarkKey } from './bookmarks'
import { cachedHighlights, chapterOf, localHighlightChapters, setHighlight, syncHighlights } from './highlights'
import { addBookmark, createOutline, deleteOutline, getOwnOutline, listBookmarks, listOutlines, saveOutlineItems } from './library'
import { localBookmarks, localOutline, localOutlines } from './localLibrary'
import { fetchExport } from './yourdata'
import { localPosition, savePosition } from '../hooks/usePosition'
import { isThemeId } from '../theme'
import type { Prefs, PrefsStore } from '../store/prefs'
import {
  HL_COLORS, MAX_FILE_BYTES, buildDeviceBackup, jottingKey, readPrefs,
  type BackupColor, type BackupContent, type BackupItem, type BackupPrefs, type ParsedBackup,
} from './backupFile'
import { NOUN } from '@shared/brand'

const appVersion = () => Constants.expoConfig?.version ?? ''
export const backupFilename = (day: string) => `jottings-backup-${day}.json`

// ---------------- making one ----------------
/** What is kept on this device while nobody is signed in. */
export async function deviceContent(prefs: Prefs): Promise<BackupContent> {
  const [bms, outlines, chapters, position] = await Promise.all([localBookmarks(), localOutlines(), localHighlightChapters(), localPosition()])
  const jottings: BackupContent['jottings'] = []
  for (const o of outlines) {
    const full = await localOutline(o.id)
    if (!full) continue
    jottings.push({ title: full.title, description: full.description, print_style: full.print_style, items: (full.items ?? []).map(toItem) })
  }
  return {
    bookmarks: bms.map(b => ({ book: b.book, chapter: b.chapter ?? null, verse: b.verse ?? null, label: b.label ?? null })),
    highlights: chapters.flatMap(c => [...c.tints]).filter(([, color]) => HL_COLORS.includes(color as BackupColor)).map(([verse_id, color]) => ({ verse_id, color: color as BackupColor })),
    jottings, position, prefs: readPrefs(prefs),
  }
}
const toItem = (i: Partial<BackupItem> & { kind: BackupItem['kind'] }): BackupItem =>
  ({ kind: i.kind, book: i.book ?? null, chapter: i.chapter ?? null, v1: i.v1 ?? null, v2: i.v2 ?? null, text: i.text ?? null, url: i.url ?? null, depth: i.depth ?? 0 })

/**
 * The file's text. Signed in it is the account export, whose reading history the server has signed, with this
 * device's reading settings added; signed out it is built here and holds no history.
 */
export async function backupText(signedIn: boolean, prefs: Prefs): Promise<string> {
  if (!signedIn) return buildDeviceBackup(await deviceContent(prefs), new Date().toISOString(), appVersion())
  const doc: unknown = JSON.parse(await fetchExport())
  if (doc === null || typeof doc !== 'object') throw new Error('Unexpected response from the server')
  return JSON.stringify({ ...doc, device_settings: readPrefs(prefs), app_version: appVersion() })
}

export type SaveOutcome = 'downloaded' | 'shared'
/** Web: a browser download. Native: a cache file handed to the share sheet (Files, Drive, a message to yourself). */
export async function saveBackup(signedIn: boolean, prefs: Prefs): Promise<SaveOutcome> {
  const text = await backupText(signedIn, prefs)
  const name = backupFilename(new Date().toISOString().slice(0, 10))
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url; a.download = name; a.rel = 'noopener'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return 'downloaded'
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device')
  const f = new File(Paths.cache, name)
  f.write(text)
  await Sharing.shareAsync(f.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save your backup' })
  return 'shared'
}

/** Android's share sheet does not always offer the phone's own storage, so a folder can be chosen outright. */
export const canSaveToFolder = Platform.OS === 'android'
/** Writes the backup into a folder the reader picks; null when they backed out of the dialog. */
export async function saveBackupToFolder(signedIn: boolean, prefs: Prefs): Promise<string | null> {
  let dir: Directory
  // the dialog opens in Documents: Android refuses the top of Downloads ("Can't use this folder")
  try { dir = await Directory.pickDirectoryAsync('content://com.android.externalstorage.documents/document/primary%3ADocuments') } catch { return null }
  const name = backupFilename(new Date().toISOString().slice(0, 10))
  dir.createFile(name, 'application/json').write(await backupText(signedIn, prefs))
  return name
}

// ---------------- choosing one ----------------
/** The chosen file's text, or null when the reader backed out of the dialog. */
export async function pickBackupText(): Promise<string | null> {
  if (Platform.OS === 'web') return pickInBrowser()
  // loaded on demand: the picker is a native module only this screen needs
  const DocumentPicker = await import('expo-document-picker')
  // the old Darby Bible app's `.setting` files have no type the system knows, so any file may be chosen
  const r = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false })
  const asset = r.canceled ? null : r.assets[0]
  if (!asset) return null
  if (asset.size != null && asset.size > MAX_FILE_BYTES) throw new Error('This file is too large to be a backup.')
  const f = new File(asset.uri)
  try { return await f.text() } finally { try { f.delete() } catch { /* the cache is cleared by the system anyway */ } }
}

function pickInBrowser(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.setting,application/json'
    input.style.display = 'none'
    const done = (fn: () => void) => { input.remove(); fn() }
    input.addEventListener('cancel', () => done(() => resolve(null)))
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return done(() => resolve(null))
      if (file.size > MAX_FILE_BYTES) return done(() => reject(new Error('This file is too large to be a backup.')))
      file.text().then(t => done(() => resolve(t)), e => done(() => reject(e as Error)))
    })
    document.body.appendChild(input)
    input.click()
  })
}

// ---------------- putting one back ----------------
export interface RestoreResult {
  bookmarks: number; highlights: number; jottings: number
  /** Outlines the server would not take (its scan, or a limit); everything else still went in. */
  refused: number
  position: boolean; settings: boolean
  /** One sentence about the streak and reading history, or null when the file held none. */
  history: string | null
}
export const HISTORY_NEEDS_ACCOUNT = 'Your streak and reading history were not restored: sign in, then restore this file again.'

/** A refusal about this one record (scan, limit, validation) rather than the connection or the session. */
const refusedByServer = (e: unknown) => e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429

export async function applyBackup(p: ParsedBackup, user: { id: number } | null, prefs: PrefsStore, onStep?: (label: string) => void): Promise<RestoreResult> {
  const res: RestoreResult = { bookmarks: 0, highlights: 0, jottings: 0, refused: 0, position: false, settings: false, history: null }
  const uid = user?.id ?? null
  const { content } = p

  if (content.bookmarks.length) {
    onStep?.('Bookmarks…')
    const have = new Set((await listBookmarks()).map(bookmarkKey))
    for (const b of content.bookmarks) {
      if (have.has(bookmarkKey(b))) continue
      await addBookmark(b)
      have.add(bookmarkKey(b)); res.bookmarks++
    }
  }

  if (content.highlights.length) {
    onStep?.('Highlights…')
    const byChapter = new Map<string, typeof content.highlights>()
    for (const h of content.highlights) {
      const { book, chapter } = chapterOf(h.verse_id), k = `${book}.${chapter}`
      const rows = byChapter.get(k)
      if (rows) rows.push(h); else byChapter.set(k, [h])
    }
    for (const rows of byChapter.values()) {
      const { book, chapter } = chapterOf(rows[0].verse_id)
      const have = uid === null ? await cachedHighlights(null, book, chapter) : await syncHighlights(uid, book, chapter)
      if (!have) throw new Error('Could not reach the server. What was restored so far is kept; restore the file again to finish.')
      for (const h of rows) {
        if (have.has(h.verse_id)) continue
        await setHighlight(uid, h.verse_id, h.color)
        res.highlights++
      }
    }
  }

  if (content.jottings.length) {
    onStep?.(`${NOUN.Many}…`)
    const mine = await listOutlines()
    const known = new Set<string>()
    for (const j of content.jottings) {
      const key = jottingKey(j.title, j.items)
      if (known.has(key)) continue
      let here = false
      for (const o of mine.filter(o => o.title.trim() === j.title)) {
        const full = await getOwnOutline(o.id).catch(() => null)
        if (full && jottingKey(full.title, (full.items ?? []).map(toItem)) === key) { here = true; break }
      }
      known.add(key)
      if (here) continue
      let id: number | null = null
      try {
        id = (await createOutline({ title: j.title, description: j.description, print_style: j.print_style })).id
        if (j.items.length) await saveOutlineItems(id, j.items)
        res.jottings++
      } catch (e) {
        // no half-made jotting is left behind, whatever stopped it
        if (id !== null) await deleteOutline(id).catch(() => {})
        if (!refusedByServer(e)) throw e
        res.refused++
      }
    }
  }

  // a device already in use keeps its place; a new one opens where the backup left off
  if (content.position && !(await localPosition())) { savePosition(content.position, uid !== null); res.position = true }

  const settings = content.prefs ? knownPrefs(content.prefs) : null
  if (settings) {
    const now = prefs.get() as unknown as Record<string, unknown>
    // "your settings are back" only when something was different
    res.settings = Object.entries(settings).some(([k, v]) => now[k] !== v)
    if (res.settings) prefs.set(settings)
  }

  if (p.history) res.history = uid === null ? HISTORY_NEEDS_ACCOUNT : await restoreHistory(p.history)
  return res
}

/** A theme this build does not have is left out, so the reader's current one stays. */
function knownPrefs(p: BackupPrefs): Partial<Prefs> | null {
  const { theme, themeLight, themeDark, ...rest } = p
  const out: Partial<Prefs> = { ...rest }
  if (theme === 'system' || (theme && isThemeId(theme))) out.theme = theme as Prefs['theme']
  if (themeLight && isThemeId(themeLight)) out.themeLight = themeLight
  if (themeDark && isThemeId(themeDark)) out.themeDark = themeDark
  return Object.keys(out).length ? out : null
}

interface Restored { restored: { days: number; credits: number; chapters: number; badges: number } }
/** The server checks the signature and whose history it is; its refusal is the sentence shown. */
async function restoreHistory(h: NonNullable<ParsedBackup['history']>): Promise<string> {
  try {
    const { restored: r } = await post<Restored>('/me/restore-activity', h)
    return r.days + r.credits + r.chapters + r.badges > 0 ? 'Your streak and reading history are restored.' : 'Your streak and reading history were already up to date.'
  } catch (e) {
    if (e instanceof ApiError && (e.status === 400 || e.status === 403)) return e.message
    return 'Your streak and reading history could not be restored just now. Restore the file again later; nothing else is added twice.'
  }
}

/** "Added 12 bookmarks, 3 jottings." and what else happened, one sentence each. */
export function describeRestore(r: RestoreResult, skipped: number, describe: (c: { bookmarks: number; highlights: number; jottings: number }) => string): string {
  const added = describe(r)
  const out = [added ? `Added ${added}.` : 'Nothing new to add: everything in this file is already here.']
  if (r.position && r.settings) out.push('Your place and reading settings are back.')
  else if (r.position) out.push('Your place is back.')
  else if (r.settings) out.push('Your reading settings are back.')
  if (r.refused) out.push(`${r.refused} ${r.refused === 1 ? `${NOUN.one} was` : `${NOUN.many} were`} not accepted.`)
  if (skipped) out.push(`${skipped} ${skipped === 1 ? 'entry' : 'entries'} in the file could not be read.`)
  if (r.history) out.push(r.history)
  return out.join(' ')
}
