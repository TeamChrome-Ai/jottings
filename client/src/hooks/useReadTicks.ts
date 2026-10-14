import { useEffect, useMemo, useState } from 'react'
import { chapterKey } from '@shared/paths'
import { cachedGet } from '../lib/api'
import { useDeviceReads } from '../lib/paths'
import { useMarks } from './useMarks'
import { useAuth } from '../store/auth'
import { onBeat } from './useActivity'

/**
 * The chapters ticked as read in the reader and its pickers: the account's credits (`credited`, from
 * `/stats/progress`), the reader's own marks (readMarks.ts) and, signed out, the chapters this device judged read.
 * The reader's own view only; the same set comes back while nothing is added to it.
 */
export function useReadTicks(credited: Set<string>): Set<string> {
  const { user } = useAuth()
  const marks = useMarks().at
  const device = useDeviceReads()
  return useMemo(() => {
    const own = user ? null : device
    if (!marks.size && !own?.size) return credited
    const s = new Set(credited)
    for (const k of marks.keys()) s.add(k)
    if (own) for (const k of own) s.add(k)
    return s
  }, [credited, marks, device, user])
}

const NONE: ReadonlySet<string> = new Set()
/** Whether the account has `book` `chapter` credited, for a screen that keeps no read set of its own (paged mode):
 *  asked when the chapter opens, then kept current by the beats' answers. False signed out. */
export function useCredited(book: number, chapter: number): boolean {
  const { user } = useAuth()
  const uid = user?.id
  const [set, setSet] = useState<ReadonlySet<string>>(NONE)
  useEffect(() => {
    if (!uid) { setSet(NONE); return }
    let live = true
    cachedGet<Record<string, number[]>>('/stats/progress').then(p => { if (live) setSet(new Set(Object.entries(p).flatMap(([b, cs]) => cs.map(c => chapterKey(Number(b), c))))) }).catch(() => {})
    return () => { live = false }
  }, [uid, book, chapter])
  useEffect(() => onBeat(r => { if (r.credited) { const k = chapterKey(r.credited.book, r.credited.chapter); setSet(s => (s.has(k) ? s : new Set(s).add(k))) } }), [])
  return !!uid && set.has(chapterKey(book, chapter))
}
