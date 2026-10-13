/**
 * Web: the dictionary is not in the bundle. The articles are 1.2 MB gzipped, and the Strong's sheet (which needs the
 * server for word tags anyway) wants one of them, so the index comes from GET /api/dictionary (~65 KB gzipped) and
 * each article from GET /api/dictionary/{id}. A failed request resolves to null and is retried on the next call.
 */
import { buildIndex, type CbdEntry, type CbdIndex, type CbdIndexRow } from '@shared/cbd'
import { get } from './api'

let index: Promise<CbdIndex | null> | null = null
const entries = new Map<string, CbdEntry>()

export function loadDictionaryIndex(): Promise<CbdIndex | null> {
  index ??= get<CbdIndexRow[]>('/dictionary').then(buildIndex, () => { index = null; return null })
  return index
}

export async function loadDictionaryEntry(id: string): Promise<CbdEntry | null> {
  const hit = entries.get(id)
  if (hit) return hit
  try {
    const e = await get<CbdEntry>(`/dictionary/${encodeURIComponent(id)}`)
    entries.set(id, e)
    return e
  } catch { return null }
}

export const dictionaryOffline = false
