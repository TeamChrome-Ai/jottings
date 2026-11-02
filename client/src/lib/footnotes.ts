import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { buildFootnoteIndex, footnotesOn, noteAt, type FootnoteGroup, type FootnoteIndex, type FootnoteIndexFile, type FootnotePlace } from '@shared/footnotes'
import type { Ref } from '@shared/ref'
import { fetchChapter, peekChapter, type ChapterData } from './bible'
import type { Edition, Source } from './editionCore'
import { onSourceChange, peekSource } from './text'

export interface WordFootnotes {
  notes: number
  groups: readonly { text: string; places: readonly Ref[] }[]
  unread: number
  more: number
}

const INDEX_CHUNKS: Record<Edition, () => Promise<{ default: FootnoteIndexFile }>> = {
  '1961': () => import('../../public/bible/footnotes.json'),
  '1890': () => import('../../public/bible1890/footnotes.json'),
}
const built = new Map<Edition, FootnoteIndex>()

const englishEdition = (s: Source): Edition | null => (s === 'fr' || s === 'de' ? null : s)

function useIndex(e: Edition | null): FootnoteIndex | null {
  const [, setLoaded] = useState(0)
  useEffect(() => {
    if (!e || built.has(e)) return
    let live = true
    INDEX_CHUNKS[e]().then(m => {
      if (!built.has(e)) built.set(e, buildFootnoteIndex(m.default))
      if (live) setLoaded(n => n + 1)
    }).catch(() => {})
    return () => { live = false }
  }, [e])
  return e ? built.get(e) ?? null : null
}

function useLast<T>(key: string, value: T | null): T | null {
  const last = useRef<{ key: string; value: T } | null>(null)
  if (value !== null) last.current = { key, value }
  return value ?? (last.current?.key === key ? last.current.value : null)
}

const chapterKey = (r: Pick<Ref, 'book' | 'chapter'>) => `${r.book}.${r.chapter}`

function fromChapters(notes: number, groups: readonly FootnoteGroup[], upTo: number, chapterOf: (p: FootnotePlace) => ChapterData | undefined): WordFootnotes {
  const shown: WordFootnotes['groups'][number][] = []
  let unread = 0
  for (const { places } of groups.slice(0, upTo)) {
    const c = chapterOf(places[0])
    if (!c) { unread++; continue }
    const text = noteAt(c, places[0])
    if (text !== null) shown.push({ text, places: places.map(p => ({ book: p.book, chapter: p.chapter, v1: p.verse })) })
  }
  return { notes, groups: shown, unread, more: Math.max(0, groups.length - upTo) }
}

export function useWordFootnotes(word: string, upTo: number, scope = 'all'): WordFootnotes | null {
  const e = englishEdition(useSyncExternalStore(onSourceChange, peekSource, peekSource))
  const index = useIndex(e)
  const found = useMemo(() => (index ? footnotesOn(index, word, scope) : null), [index, word, scope])
  const held = useMemo(() => {
    if (!found || !e) return null
    const all = found.groups.slice(0, upTo).every(g => peekChapter(g.places[0].book, g.places[0].chapter, e))
    return all ? fromChapters(found.notes, found.groups, upTo, p => peekChapter(p.book, p.chapter, e)) : null
  }, [found, upTo, e])
  const of = `${e}\n${word}\n${scope}`
  const [read, setRead] = useState<{ of: string; answer: WordFootnotes } | null>(null)
  useEffect(() => {
    if (!found || !e || held) return
    let live = true
    const wanted = [...new Map(found.groups.slice(0, upTo).map(g => [chapterKey(g.places[0]), g.places[0]])).values()]
    void Promise.allSettled(wanted.map(p => fetchChapter(p.book, p.chapter, e))).then(rs => {
      if (!live) return
      const got = new Map<string, ChapterData>()
      rs.forEach((r, k) => { if (r.status === 'fulfilled') got.set(chapterKey(wanted[k]), r.value) })
      setRead({ of, answer: fromChapters(found.notes, found.groups, upTo, p => got.get(chapterKey(p))) })
    })
    return () => { live = false }
  }, [found, upTo, e, held, of])
  const shown = useLast(of, found ? held ?? (read?.of === of ? read.answer : null) : null)
  return found ? shown : null
}
