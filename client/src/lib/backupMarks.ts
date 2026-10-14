/**
 * The reader's own "read" marks in a backup file (docs/BACKUP.md; the rest of the file is `backupFile.ts`). They ride
 * under `chapter_marks` as `[{ book, chapter, marked_at }]`, the shape the account export gives them, outside the
 * signed reading history: a mark earns nothing, so there is nothing for the server to verify. Pure.
 */
import { readMarkList, type Mark } from './readMarksCore'

export const MARKS_FIELD = 'chapter_marks'
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const rows = (marks: readonly Mark[]) => marks.map(([book, chapter, marked_at]) => ({ book, chapter, marked_at }))

/** The marks a chosen file holds: real chapters only, one each; none for a file that is not ours or has none. */
export function readBackupMarks(text: string, now: string): Mark[] {
  let doc: unknown
  try { doc = JSON.parse(text.replace(/^﻿/, '')) } catch { return [] }
  return isObj(doc) ? readMarkList(doc[MARKS_FIELD], now) : []
}

/** A backup document with this device's marks added to the ones it holds (an account export from a server that knows
 *  marks already lists the account's; marks still waiting on the device are not in it yet). */
export function withBackupMarks(doc: Record<string, unknown>, marks: readonly Mark[], now: string): Record<string, unknown> {
  return { ...doc, [MARKS_FIELD]: rows(readMarkList([...rows(readMarkList(doc[MARKS_FIELD], now)), ...rows(marks)], now)) }
}

/** "12 chapters marked as read", or "" for none. */
export const describeMarks = (n: number): string => (n ? `${n.toLocaleString()} ${n === 1 ? 'chapter' : 'chapters'} marked as read` : '')
