import { shareText } from '../../../../src/lib/share'
import { useEdition } from '../../../../src/lib/edition'
import { siteOrigin } from '../../../../src/lib/outlines'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import SwipePager, { type Page, type SwipePagerHandle } from '../../../../src/components/SwipePager'
import ReaderPage, { type PageLayout } from '../../../../src/components/ReaderPage'
import * as Clipboard from 'expo-clipboard'
import type { Outline } from '@shared/types'
import { formatVerseRuns, type Ref } from '@shared/ref'
import { book as bookMeta, chapterIndex, fetchChapter, key as chapterKeyOf, nextChapter, peekChapter, prevChapter, validRef, verseId, warmAround, type ChapterData } from '../../../../src/lib/bible'
import { get, getApiBase, isNetworkError } from '../../../../src/lib/api'
import { addBookmark, listBookmarks, removeBookmark } from '../../../../src/lib/library'
import { bookmarkIds, bookmarkKey, bookmarkTitle, markedVerses, type BookmarkTarget } from '../../../../src/lib/bookmarks'
import { useMergeTick } from '../../../../src/hooks/useLocalLibraryMerge'
import { cachedHighlights, setHighlight, syncHighlights } from '../../../../src/lib/highlights'
import { savePosition } from '../../../../src/hooks/usePosition'
import { onBeat, useActivity } from '../../../../src/hooks/useActivity'
import { useInks } from '../../../../src/hooks/useTheme'
import { useAuth } from '../../../../src/store/auth'
import { FONT_MAX, FONT_MIN, usePrefPick, usePrefsStore } from '../../../../src/store/prefs'
import { useToast } from '../../../../src/store/toast'
import { useReadingPrefs, type HlColor, type ParaLayout } from '../../../../src/components/ChapterView'
import WordSheet, { fetchWordTags, type WordTags, type WordTarget } from '../../../../src/components/WordSheet'
import { loadDictionaryIndex } from '../../../../src/lib/dictionary'
import { matchWord, warmWordLookup } from '@shared/cbd'
import ActionBar from '../../../../src/components/ActionBar'
import ChapterPicker from '../../../../src/components/ChapterPicker'
import BookPane from '../../../../src/components/BookPane'
import { useDesktop } from '../../../../src/hooks/useDesktop'
import { readerColumnWidth } from '../../../../src/lib/layout'
import AddToOutlineSheet from '../../../../src/components/AddToOutlineSheet'
import { refParams } from '../../../../src/components/FootnoteText'
import ThemeGallery from '../../../../src/components/ThemeGallery'
import PlayerBar from '../../../../src/components/PlayerBar'
import FontLoading from '../../../../src/components/FontLoading'
import { useLazyFontState } from '../../../../src/lib/fonts'
import { usePlayer } from '../../../../src/store/player'
import { Button, ErrorText, Sheet, SwitchRow, T } from '../../../../src/components/ui'
import { ToggleButton } from '../../../../src/components/motion/reader'
import { edgesOf, type Edges, type PullDir } from '../../../../src/lib/edgePull'
import { atEnd, chapterWords } from '@shared/reading'
import { AUTHORS, sectionsFor } from '@shared/companion'
import MinistrySheet, { type MinistryScope } from '../../../../src/components/MinistrySheet'
import { loadMinistryRefs, ministryVerses, peekMinistryVerses } from '../../../../src/lib/ministry'
import { useCompanionIndexes } from '../../../../src/hooks/useCompanion'
import { EXIT_MS } from '../../../../src/lib/motion'
import { scaleMs } from '../../../../src/lib/motionSpeed'
import { offerTourControls, tourRef } from '../../../../src/store/tour'
import { TOOLBAR_WIDE } from '../../../../src/lib/tour'
import { usePathHere } from '../../../../src/lib/paths'

type Target = { book: number; chapter: number }

/**
 * The word the full tour looks up: the first tagged word of the chapter (four letters or more) that the dictionary also
 * has a subject for, so the sheet shows both its parts; else the first tagged word. Null without Strong's tags.
 */
async function tourWord(book: number, chapter: number): Promise<WordTarget | null> {
  const tags = await fetchWordTags(book, chapter).catch(() => null)
  if (!tags) return null
  const index = await loadDictionaryIndex().catch(() => null)
  const words = [...tags.keys()].sort((a, b) => a - b).flatMap(v => tags.get(v)!).filter(([w, code]) => code && w.length >= 4)
  const best = (index && words.find(([w]) => matchWord(index, w, 1).length)) || words[0]
  return best ? { code: best[1], word: best[0] } : null
}
const SCREEN_PREFS = ['font', 'fontSize', 'lineHeight', 'reduceMotion', 'ttsAutoNext', 'ttsStopAtSelection'] as const
const NO_VERSES: ReadonlySet<number> = new Set()
const NO_KEYS: ReadonlySet<string> = new Set()
const NO_TINTS: ReadonlyMap<number, string> = new Map()
/** Pages either side are laid out this long after the current one lands, so they never compete with its first paint. */
const NEIGHBOURS_AFTER_MS = 150

/** Another edition (docs/EDITION.md) remounts the screen on the same chapter, read again in that edition. */
export default function ReadScreen() {
  const edition = useEdition()
  return <ReadScreenPage key={edition} />
}

function ReadScreenPage() {
  const params = useLocalSearchParams<{ book: string; chapter: string; v?: string; v2?: string; listen?: string }>()
  const player = usePlayer()
  const router = useRouter()
  const { user, ready } = useAuth()
  // the fields this screen reads, not the whole record: a theme tap must not re-render the reader
  const livePrefs = usePrefPick(SCREEN_PREFS)
  const { set } = usePrefsStore()
  // what the chapter is laid out with: stable across a theme change, so the memoised pages stay put
  const liveReading = useReadingPrefs()
  // While another tab is up (Settings' sliders), the reader keeps the prefs it was laid out with and catches up on
  // focus: word spacing re-lays out every word of the chapter, and it was doing so behind Settings per tick.
  const [focused, setFocused] = useState(true)
  useFocusEffect(useCallback(() => { setFocused(true); return () => setFocused(false) }, []))
  const held = useRef({ prefs: livePrefs, reading: liveReading })
  if (focused) held.current = { prefs: livePrefs, reading: liveReading }
  const { prefs, reading } = held.current
  const fontState = useLazyFontState(prefs.font)
  const colors = useInks()
  const toast = useToast()
  const insets = useSafeAreaInsets()
  const { width, fontScale } = useWindowDimensions()
  const pathDot = Math.round(8 * fontScale)
  const compact = width < TOOLBAR_WIDE
  // the desktop (1024 px up): the book pane stands beside the reading column, whose measured width the pager turns by
  // (before the first layout, the window less the rail and the pane)
  const desktop = useDesktop()
  const [columnW, setColumnW] = useState<number | null>(null)
  const pageW = desktop ? columnW ?? readerColumnWidth(width) : width
  const bookN = parseInt(params.book ?? '0', 10)
  const chapterN = parseInt(params.chapter ?? '0', 10)
  const valid = validRef(bookN, chapterN)

  const [loaded, setData] = useState<ChapterData | null>(null)
  // a page carried in by a swipe was loaded as a neighbour: show it in the same commit, no spinner in between
  const data = loaded && loaded.book === bookN && loaded.c === chapterN ? loaded : valid ? peekChapter(bookN, chapterN) ?? null : null
  const [err, setErr] = useState('')
  const [openNotes, setOpenNotes] = useState<Set<number>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  /** Verse arrived at by link/search: tinted for a moment so the eye lands on it, without opening the selection bar. */
  const [flash, setFlash] = useState<Set<number>>(new Set())
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flashVerse = useCallback((v: number, to?: number) => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    const end = to && to > v ? to : v
    setFlash(new Set(Array.from({ length: end - v + 1 }, (_, i) => v + i)))
    flashTimer.current = setTimeout(() => setFlash(new Set()), 2600)
  }, [])
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])
  const [highlights, setHighlights] = useState<Map<number, string>>(new Map())
  /** Every bookmark (verse, chapter, book) by `bookmarkKey`, to its id for removal. */
  const [marks, setMarks] = useState<ReadonlyMap<string, number>>(new Map())
  const [readSet, setReadSet] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState(false)
  const [addOutline, setAddOutline] = useState(false)
  const [themes, setThemes] = useState(false)
  const [more, setMore] = useState(false)          // the controls behind More: on a phone those that do not fit beside the picker; on a wide screen Reading settings
  const [allNotes, setAllNotes] = useState(false)
  const [wordMode, setWordMode] = useState(false)
  const [wordTags, setWordTags] = useState<WordTags | null>(null)
  /** Ministry on the selected verses or on this chapter (opened at the first verse selected, else the one at the top). */
  const [ministry, setMinistry] = useState<{ open: boolean; scope: MinistryScope | null }>({ open: false, scope: null })
  const [wordTarget, setWordTarget] = useState<WordTarget | null>(null)

  /** Each page's scroll view, one ref object per chapter for as long as its page is mounted: react-native-web's
   *  ScrollView binds its forwarded ref once, at mount, so a ref handed from page to page on a turn stays on the old
   *  page (and the edge pull then read the old page's scroll). */
  const pageRefs = useRef(new Map<string, { current: ScrollView | null }>())
  const pageRef = useCallback((k: string) => {
    let r = pageRefs.current.get(k)
    if (!r) { r = { current: null }; pageRefs.current.set(k, r) }
    return r
  }, [])
  /** The current page's scroll view. */
  const scrollRef = useMemo(() => ({ get current() { return pageRefs.current.get(liveKey.current)?.current ?? null } }), [])
  const paras = useRef(new Map<number, ParaLayout>())
  const scrollY = useRef(0)
  const contentH = useRef(1)
  const viewportH = useRef(1)
  const pendingVerse = useRef<number | null>(null)
  const pendingEnd = useRef<number | null>(null)
  /** The chapter and `v`/`v2` last landed on, so a verse asked for again on the open chapter lands too. */
  const consumedV = useRef('')
  /** Where each verse starts inside its paragraph, from the zero-size marker at its head: (paragraph index, y). */
  const verseMarks = useRef<Map<number, { index: number; y: number }>>(new Map())
  const chapterKey = `${bookN}.${chapterN}`
  /** Layout per chapter, kept for the pages either side so the one a swipe carries in arrives measured. */
  const pageLayouts = useRef(new Map<string, PageLayout>())
  const liveKey = useRef(chapterKey)
  liveKey.current = chapterKey
  const landRef = useRef(() => {})
  const pager = useRef<SwipePagerHandle>(null)
  /** Native reads the edges on touch-down (UI thread), so they are pushed whenever the scroll, its content or its
   *  viewport changes. */
  const syncEdges = useCallback(() => {
    const e = edgesOf(scrollY.current, contentH.current, viewportH.current)
    pager.current?.setEdges(e.top, e.bottom)
  }, [])
  /** The web reads them from the scroll element itself when a gesture begins, which is never stale. */
  const edgesNow = useCallback((): Edges => {
    const n = Platform.OS === 'web' ? (scrollRef.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null)?.getScrollableNode?.() : null
    return n ? edgesOf(n.scrollTop, n.scrollHeight, n.clientHeight) : edgesOf(scrollY.current, contentH.current, viewportH.current)
  }, [])
  const layoutOf = useCallback((k: string) => {
    let l = pageLayouts.current.get(k)
    if (!l) {
      const rec: PageLayout = {
        paras: new Map(), marks: new Map(), height: 1,
        onPara: p => { rec.paras.set(p.index, p); if (liveKey.current === k) landRef.current() },
        onVerse: (v, index, y) => { rec.marks.set(v, { index, y }); if (liveKey.current === k) landRef.current() },
        onSize: (_w, h) => { rec.height = h; if (liveKey.current === k) { contentH.current = h; syncEdges() } },
      }
      pageLayouts.current.set(k, rec)
      l = rec
    }
    return l
  }, [syncEdges])
  /** Set by a vertical turn to the previous chapter: it lands at its end. */
  const landEnd = useRef(false)

  // ---- where "next" goes (docs/PATHS.md rule 3) ----
  // While a path is on and this chapter is on it, the edge pull, the next-turn, the end-of-chapter button, the right
  // arrow and read aloud's continue all go to the path's next portion; "previous" stays canonical. A finished path
  // (nothing left after this chapter) hands back to the canonical next without path wording.
  const onPathHere = usePathHere(bookN, chapterN)
  const pathNext = onPathHere.next
  const next = useMemo<Target | null>(() => !valid ? null : pathNext ? { book: pathNext.book, chapter: pathNext.chapter } : nextChapter(bookN, chapterN), [valid, pathNext, bookN, chapterN])
  const prev = useMemo<Target | null>(() => valid ? prevChapter(bookN, chapterN) : null, [valid, bookN, chapterN])
  const nextRef = useRef(next)
  nextRef.current = next
  /** The pager's place: the current page's index, the neighbours at ±1. A running count rather than the chapter's
   *  canonical index, so a path's jump (Matthew 8 to Matthew 5 in the life of Christ) turns like any other chapter. */
  const slot = useRef(chapterIndex(bookN, chapterN))

  // ---- load the chapter and the per-user decorations ----
  useEffect(() => {
    if (!valid) return
    let cancelled = false
    setData(null); setErr(''); setSelected(new Set()); setOpenNotes(new Set()); setHighlights(new Map())
    const nx = nextRef.current, pv = prevChapter(bookN, chapterN)
    const keep = new Set([chapterKey, ...[nx, pv].map(t => t ? chapterKeyOf(t.book, t.chapter) : '')])
    for (const k of pageLayouts.current.keys()) if (!keep.has(k)) pageLayouts.current.delete(k)
    for (const k of pageRefs.current.keys()) if (!keep.has(k)) pageRefs.current.delete(k)
    const lay = layoutOf(chapterKey)
    paras.current = lay.paras
    verseMarks.current = lay.marks
    contentH.current = lay.height
    syncEdges()
    // already there when it was laid out in time; this covers a pull made before the neighbour had its text
    if (landEnd.current) { landEnd.current = false; requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false })) }
    pendingVerse.current = params.v ? parseInt(params.v, 10) || null : null
    pendingEnd.current = params.v2 ? parseInt(params.v2, 10) || null : null
    consumedV.current = `${chapterKey}:${params.v ?? ''}:${params.v2 ?? ''}`
    landRef.current()
    fetchChapter(bookN, chapterN).then(ch => { if (!cancelled) setData(ch) }).catch(e => { if (!cancelled) setErr((e as Error).message) })
    warmAround(bookN, chapterN)
    if (user) {
      get<Record<string, number[]>>('/stats/progress').then(p => { if (!cancelled) setReadSet(new Set(Object.entries(p).flatMap(([b, cs]) => cs.map(c => `${b}.${c}`)))) }).catch(() => {})
    }
    return () => { cancelled = true }
    // params.v is consumed once per chapter, on purpose
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookN, chapterN, valid, user])

  // a verse asked for on the chapter already open (Back to the verse from the library, a link to this chapter): land on
  // it and flash it as a new chapter would
  useEffect(() => {
    const k = `${chapterKey}:${params.v ?? ''}:${params.v2 ?? ''}`
    if (!params.v || consumedV.current === k) return
    consumedV.current = k
    pendingVerse.current = parseInt(params.v, 10) || null
    pendingEnd.current = params.v2 ? parseInt(params.v2, 10) || null : null
    landRef.current()
  }, [chapterKey, params.v, params.v2])

  // tints and bookmarks: the account's when signed in, this device's when not; `ready` keeps a session still being
  // restored from reading as signed out. A sign-in merge that lands later reloads them.
  const merged = useMergeTick()
  useEffect(() => {
    if (!valid || !ready) return
    let cancelled = false
    const uid = user?.id ?? null
    // cached tints first (they show offline), then the server's copy
    cachedHighlights(uid, bookN, chapterN).then(m => { if (!cancelled && m.size) setHighlights(m) })
      .then(() => syncHighlights(uid, bookN, chapterN)).then(m => { if (!cancelled && m) setHighlights(m) })
    listBookmarks().then(r => { if (!cancelled) setMarks(bookmarkIds(r)) }).catch(() => {})
    return () => { cancelled = true }
  }, [bookN, chapterN, valid, user, ready, merged])

  // ---- word lookup: Strong's tags come from the API only; the dictionary matches any word by headword, offline ----
  /** The missing-tags toast is said once per switch-on, not on every chapter turned offline. */
  const tagsWarned = useRef(false)
  useEffect(() => { tagsWarned.current = false }, [wordMode])
  // the first tapped word should not wait for the index (a bundled JSON on native, one request on the web)
  useEffect(() => { if (wordMode) void loadDictionaryIndex().then(i => { if (i) warmWordLookup(i) }) }, [wordMode])
  useEffect(() => {
    if (!wordMode || !valid) { setWordTags(null); return }
    let cancelled = false
    fetchWordTags(bookN, chapterN).then(t => { if (!cancelled) setWordTags(t) }).catch(e => {
      if (cancelled || tagsWarned.current) return
      tagsWarned.current = true
      toast.show(isNetworkError(e) ? 'Strong’s tags need a connection; tapping a word still opens the dictionary' : 'Could not load Strong’s tags; tapping a word still opens the dictionary')
    })
    return () => { cancelled = true }
  }, [wordMode, bookN, chapterN, valid, toast])

  // ---- web: arrow keys turn chapters, only while this screen is focused (the tab stays mounted under
  // pushed routes such as paged mode, whose own arrow handling must not be doubled) ----
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'web') return
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as { tagName?: string } | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowRight') goRef.current(1)
      else if (e.key === 'ArrowLeft') goRef.current(-1)
      else if (e.key === 'Escape') setSelected(new Set())
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, []))

  // ---- reading position: first paragraph in view ----
  const currentVerse = useCallback(() => {
    let verse = 1
    const y = scrollY.current + 40
    for (const p of [...paras.current.values()].sort((a, b) => a.y - b.y)) { if (p.y + p.height > y) { verse = p.firstVerse; break } }
    return verse
  }, [])
  useEffect(() => {
    if (!valid) return
    const save = () => savePosition({ book: bookN, chapter: chapterN, verse: currentVerse() }, !!user)
    const t = setInterval(save, 10_000)
    save()
    return () => { clearInterval(t); save() }
  }, [bookN, chapterN, valid, user, currentVerse])

  /** Scroll offset that puts verse `v` in the middle of the viewport; falls back to a proportional guess before its marker lands. */
  const verseY = useCallback((v: number) => {
    const mark = verseMarks.current.get(v)
    const para = mark ? paras.current.get(mark.index) : [...paras.current.values()].find(p => v >= p.firstVerse && v <= p.lastVerse)
    if (!para) return null
    const top = mark ? para.y + mark.y : para.y + (para.lastVerse > para.firstVerse ? ((v - para.firstVerse) / (para.lastVerse - para.firstVerse + 1)) * para.height : 0)
    return Math.max(0, top - viewportH.current / 2 + prefs.fontSize * prefs.lineHeight)
  }, [prefs.fontSize, prefs.lineHeight])
  /**
   * Land on the pending verse once both its paragraph and its marker have laid out. Layout keeps shifting for a
   * moment after that (web fonts arriving, images of notes), so the landed verse is re-centred on every later
   * layout report for two seconds; the flash fires once.
   */
  const landed = useRef<{ v: number; until: number } | null>(null)
  const landPending = useCallback(() => {
    const want = pendingVerse.current
    if (want) {
      // web waits for the verse marker; native lands on the paragraph estimate at once and re-centres when the
      // line measurement arrives (inside the two-second window below)
      if (!verseMarks.current.has(want) && (Platform.OS === 'web' || ![...paras.current.values()].some(p => want >= p.firstVerse && want <= p.lastVerse))) return
      const y = verseY(want)
      if (y === null) return
      pendingVerse.current = null
      landed.current = { v: want, until: Date.now() + 2000 }
      const end = pendingEnd.current ?? undefined
      pendingEnd.current = null
      // A link or a return opens the chapter at the verse, as a book falls open at its page: no smooth scroll down from
      // the heading (the re-centring below cut it short anyway), and the arrival pulse starts with the jump, where it
      // is seen; flashed before, it spent itself offscreen or mid-scroll.
      const k = liveKey.current
      const go = () => { if (liveKey.current !== k) return; scrollRef.current?.scrollTo({ y: verseY(want) ?? y, animated: false }); flashVerse(want, end) }
      const fonts = (globalThis as { document?: { fonts?: { ready: Promise<unknown> } } }).document?.fonts
      if (fonts) fonts.ready.then(() => setTimeout(go, 30)); else setTimeout(go, 30)
      return
    }
    const l = landed.current
    if (l && Date.now() < l.until) { const y = verseY(l.v); if (y !== null) scrollRef.current?.scrollTo({ y, animated: false }) }
    const h = noteHold.current
    if (h && Date.now() < h.until) {
      const y = Math.max(0, h.top + (heightAbove(h.index) - h.above) + (markY(h.v, h.index) - h.mark) - h.dy)
      scrollRef.current?.scrollTo({ y, animated: false })
      // the hold owns the offset while it lasts (onScroll): Android's events for these jumps are throttled, and the
      // one that does arrive is of an earlier jump
      h.y = y
      scrollY.current = y
    }
  }, [verseY, flashVerse])
  landRef.current = landPending

  /**
   * Showing or hiding every footnote (†) moves all the text below the first one, and the reader lost their place. The
   * first verse that starts in the view is held where it is: remembered at the tap, and put back on every layout
   * report while the notes open or close. Where it has moved to is worked out from what is always reported, the
   * heights of the paragraphs above it (the notes open inside their paragraphs): on the web a paragraph that only
   * moves reports nothing, so its own `y` there is stale.
   */
  const noteHold = useRef<{ v: number; index: number; top: number; above: number; mark: number; dy: number; until: number; /** where the hold last put the text */ y?: number } | null>(null)
  const heightAbove = (index: number) => { let h = 0; for (const p of paras.current.values()) if (p.index < index) h += p.height; return h }
  /** A verse's line inside its paragraph, once measured; 0 for the paragraph's top. */
  const markY = (v: number, index: number) => { const m = verseMarks.current.get(v); return m && m.index === index ? m.y : 0 }
  /** A finger on the page takes the place over from the hold. */
  const endNoteHold = useCallback(() => { noteHold.current = null }, [])
  const toggleAllNotes = useCallback(() => {
    // the web has the true offset to hand; elsewhere it is the last one reported
    const node = Platform.OS === 'web' ? (scrollRef.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null)?.getScrollableNode?.() : null
    const y = node ? node.scrollTop : scrollY.current
    let first: { v: number; index: number; top: number } | null = null
    if (y > 0) for (const p of paras.current.values()) {
      for (let v = p.firstVerse; v <= p.lastVerse; v++) {
        const m = verseMarks.current.get(v)
        if (v !== p.firstVerse && !(m && m.index === p.index)) continue
        const top = p.y + markY(v, p.index)
        if (top >= y && (!first || top < first.top)) first = { v, index: p.index, top }
      }
    }
    noteHold.current = first ? { v: first.v, index: first.index, top: first.top, above: heightAbove(first.index), mark: markY(first.v, first.index), dy: first.top - y, until: Date.now() + 2000 } : null
    setAllNotes(a => !a)
  }, [])

  /** The streak heartbeat's hands, set once it is created below. */
  const markRef = useRef(() => {})
  const reachEndRef = useRef((_b: number, _c: number) => {})
  // read-aloud follow-along: the spoken verse stays tinted and is kept in view; a finished chapter moves on
  const spokenHere = player.spoken && player.spoken.book === bookN && player.spoken.chapter === chapterN ? player.spoken : null
  const spokenSet = useMemo(() => spokenHere && spokenHere.v > 0 ? new Set([spokenHere.v]) : new Set<number>(), [spokenHere?.v, spokenHere ? 1 : 0])
  // a stable instance per (flash, spoken verse): ChapterView is memoised and this screen re-renders on every spoken word
  const tinted = useMemo(() => spokenSet.size ? new Set([...flash, ...spokenSet]) : flash, [flash, spokenSet])
  const lastSpokenVerse = useRef(0)
  useEffect(() => {
    if (!spokenHere || spokenHere.v === lastSpokenVerse.current) return
    lastSpokenVerse.current = spokenHere.v
    // listening is reading: it keeps the time counting without a touch
    markRef.current()
    if (spokenHere.v > 0) { const y = verseY(spokenHere.v); if (y !== null) scrollRef.current?.scrollTo({ y, animated: !prefs.reduceMotion }) }
  }, [spokenHere, verseY, prefs.reduceMotion])
  useEffect(() => {
    player.onEnded((b, c) => {
      reachEndRef.current(b, c)
      if (!prefs.ttsAutoNext || b !== bookN || c !== chapterN) return
      // the path's next portion while one is on (its chapter; the ministry `then` is read, not listened to)
      const nx = nextRef.current
      if (nx) router.replace({ pathname: '/read/[book]/[chapter]', params: { book: String(nx.book), chapter: String(nx.chapter), listen: '1' } })
    })
    return () => player.onEnded(null)
  }, [player, prefs.ttsAutoNext, bookN, chapterN, router])
  useEffect(() => { if (params.listen === '1' && data) player.start(bookN, chapterN, 1) }, [params.listen, data, bookN, chapterN])  // eslint-disable-line react-hooks/exhaustive-deps
  const listen = () => { if (player.status === 'loading') return; if (player.status !== 'idle' && player.book === bookN && player.chapter === chapterN) player.toggle(); else player.start(bookN, chapterN, selList[0] ?? 1, prefs.ttsStopAtSelection && selList.length ? { stopAfter: selList[selList.length - 1] } : undefined) }

  /** Footnote cross-reference: within this chapter scroll to the verse and flash it selected; elsewhere open that chapter. */
  const onNavigate = useCallback((r: Ref) => {
    if (r.book === bookN && r.chapter === chapterN && r.v1) {
      const y = verseY(r.v1)
      if (y !== null) scrollRef.current?.scrollTo({ y, animated: !prefs.reduceMotion })
      flashVerse(r.v1, r.v2)
      return
    }
    router.push(refParams(r))
  }, [bookN, chapterN, prefs.reduceMotion, router, flashVerse, verseY])


  // ---- streak heartbeat ----
  const tourAtEnd = useRef(false)
  const getProgress = useCallback(() => contentH.current <= viewportH.current ? 1 : Math.min(1, (scrollY.current + viewportH.current) / contentH.current), [])
  /** The shown chapter's end is on screen: only once its text is laid out, so the spinner before it does not count. */
  const atChapterEnd = useCallback((b: number, c: number) => {
    const k = chapterKeyOf(b, c)
    // the full tour showing the chapter's end is not the reader reaching it
    if (tourAtEnd.current || k !== liveKey.current || !pageLayouts.current.get(k)?.paras.size || viewportH.current <= 1) return false
    return atEnd(scrollY.current, viewportH.current, contentH.current)
  }, [])
  const words = useMemo(() => data ? chapterWords(data.verses) : undefined, [data])
  const { mark, reachEnd } = useActivity(valid ? bookN : undefined, valid ? chapterN : undefined, { getProgress, atEnd: atChapterEnd, words })
  markRef.current = mark
  reachEndRef.current = reachEnd
  // a chapter left just before its credit lands is credited by the beat that closes it, with this screen on the next
  useEffect(() => onBeat(r => {
    if (r.credited) { const k = chapterKeyOf(r.credited.book, r.credited.chapter); setReadSet(s => s.has(k) ? s : new Set(s).add(k)); toast.show('Chapter credited') }
    for (const b of r.new_badges ?? []) toast.show(`Badge earned: ${b.name}`)
  }), [toast])
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // while the footnote hold lasts (and a throttled event may still be on its way) the offset is where it put the text
    const h = noteHold.current
    scrollY.current = h && h.y !== undefined && Date.now() < h.until + 300 ? h.y : e.nativeEvent.contentOffset.y
    contentH.current = e.nativeEvent.contentSize.height
    viewportH.current = e.nativeEvent.layoutMeasurement.height
    syncEdges()
    mark()
  }, [mark, syncEdges])

  // ---- page turns ----
  // The chapters either side are mounted in SwipePager; a turn slides one in, then the params follow, so nothing
  // remounts ("Reduce animation" makes the turn instant).
  const navigate = useCallback((t: Target) => {
    scrollY.current = 0
    scrollRef.current?.scrollTo({ y: 0, animated: false })
    router.setParams({ book: String(t.book), chapter: String(t.chapter), v: '' })
  }, [router])
  const reduce = prefs.reduceMotion
  const reduceRef = useRef(reduce)
  reduceRef.current = reduce
  const onTurn = useCallback((dir: 1 | -1, vertical: boolean) => {
    const t = dir > 0 ? next : prev
    if (!t) return
    mark()
    slot.current += dir
    navigate(t)
    // pulled down past the top: the previous chapter came in from above showing its end, and stays there
    if (vertical && dir < 0) {
      scrollY.current = Math.max(0, (pageLayouts.current.get(chapterKeyOf(t.book, t.chapter))?.height ?? 0) - viewportH.current)
      landEnd.current = true
    }
  }, [next, prev, navigate, mark])
  /** An edge pull toward `dir` began or was let go: ready the chapter it brings in (the previous one at its end,
   *  the next at its top), and put the previous one back at its top for a sideways turn. */
  const onPull = useCallback((dir: PullDir, active: boolean) => {
    const t = dir > 0 ? next : prev
    const r = t && pageRefs.current.get(chapterKeyOf(t.book, t.chapter))?.current
    if (!r) return
    if (dir < 0 && active) r.scrollToEnd({ animated: false })
    else r.scrollTo({ y: 0, animated: false })
  }, [next, prev])
  const go = useCallback((dir: 1 | -1) => pager.current?.go(dir), [])
  const goRef = useRef(go)
  goRef.current = go
  /** Neighbour chapters allowed to render: set once the current page has data, then kept while they stay beside it. */
  const [neighbours, setNeighbours] = useState<ReadonlySet<string>>(NO_KEYS)
  const hasData = !!data
  useEffect(() => {
    if (!valid || !hasData) return
    let cancelled = false
    // next first (the likelier turn), one chapter per frame so neither mount is a long task
    const around = [next, prev].filter((t): t is Target => !!t).map(n => ({ ...n, k: chapterKeyOf(n.book, n.chapter) }))
    const inWindow = new Set([chapterKey, ...around.map(n => n.k)])
    const frame = () => new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0)))
    const t = setTimeout(async () => {
      for (const n of around) {
        const ch = await fetchChapter(n.book, n.chapter).catch(() => null)
        if (cancelled) return
        // a transition: the offscreen chapter renders in slices that yield to a tap, a scroll or the next turn
        if (ch) startTransition(() => setNeighbours(s => s.has(n.k) ? s : new Set([...[...s].filter(k => inWindow.has(k)), chapterKey, n.k])))
        await frame()
      }
    }, NEIGHBOURS_AFTER_MS)
    return () => { cancelled = true; clearTimeout(t) }
  }, [valid, hasData, bookN, chapterN, chapterKey, next, prev])

  // ---- selection actions ----
  // read through a ref: the player context changes on every spoken word, and this callback must stay stable or
  // every memoised paragraph re-renders with it
  const playerRef = useRef(player); playerRef.current = player
  // while this chapter is being read aloud a tap on a verse moves the reading there instead of selecting it
  const toggleSelect = useCallback((v: number) => {
    mark()
    const pl = playerRef.current
    if ((pl.status === 'playing' || pl.status === 'paused') && pl.book === bookN && pl.chapter === chapterN) { pl.seekVerse(bookN, chapterN, v); return }
    setSelected(s => { const n = new Set(s); if (n.has(v)) n.delete(v); else n.add(v); return n })
  }, [mark, bookN, chapterN])
  // the full tour selects a verse to show the action bar, and opens this screen's sheets, while it is on this screen
  const here = useRef({ book: bookN, chapter: chapterN })
  here.current = { book: bookN, chapter: chapterN }
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  /** Where the chapter was scrolled before the tour showed its end. */
  const tourScrollBack = useRef(0)
  useFocusEffect(useCallback(() => offerTourControls('reader', {
    select: async on => {
      if (!on) { setSelected(new Set()); return }
      // a verse the bar offers Ministry on: the chapter's first, or the first with ministry when the first has none
      const { book, chapter } = here.current
      const known = await Promise.race([ministryVerses(book, chapter), new Promise<null>(r => setTimeout(() => r(null), 1500))]).catch(() => null)
      setSelected(new Set([known?.size && !known.has(1) ? Math.min(...known) : 1]))
    },
    sheet: async which => {
      setMore(which === 'more'); setThemes(which === 'themes')
      if (which !== 'ministry') setMinistry(m => ({ ...m, open: false }))
      if (which !== 'word') setWordTarget(null)
      const { book, chapter } = here.current
      if (which === 'ministry') {
        const verses = [...selectedRef.current].sort((a, b) => a - b)
        setMinistry({ open: true, scope: { kind: 'verse', book, chapter, verses: verses.length ? verses : [1] } })
      }
      if (which === 'word') {
        const w = await tourWord(book, chapter)
        if (!w) return false
        setWordTarget(w)
      }
      return true
    },
    end: on => {
      const r = scrollRef.current
      if (!r) return
      tourAtEnd.current = on
      if (on) { tourScrollBack.current = scrollY.current; r.scrollToEnd({ animated: !reduceRef.current }) }
      else r.scrollTo({ y: tourScrollBack.current, animated: false })
    },
  }), []))
  // stable, so a state change on this screen does not re-render every (memoised) verse of the chapter
  const onWord = useCallback((code: string, word: string) => { mark(); setWordTarget({ code, word }) }, [mark])
  const toggleNote = useCallback((id: number) => setOpenNotes(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])
  // one identity for every page, so the page a turn carries in keeps its memoised paragraphs
  const navigateRef = useRef(onNavigate)
  navigateRef.current = onNavigate
  const pageNavigate = useCallback((r: Ref) => navigateRef.current(r), [])
  const onViewport = useCallback((e: LayoutChangeEvent) => { viewportH.current = e.nativeEvent.layout.height; syncEdges() }, [syncEdges])
  const selList = useMemo(() => [...selected].sort((a, b) => a - b), [selected])
  const bookmarked = useMemo(() => markedVerses(marks, bookN, chapterN), [marks, bookN, chapterN])
  // the authors going through this chapter (Darby's Synopsis, Coates's Outlines), Darby first; offered only where there is one
  const indexes = useCompanionIndexes()
  const companionAuthors = useMemo(() => valid ? AUTHORS.filter(a => { const i = indexes[a.id]; return !!i && sectionsFor(i, bookN, chapterN).length > 0 }).map(a => a.id) : [], [valid, indexes, bookN, chapterN])
  const chapterMinistry = companionAuthors.length ? 'Ministry on this chapter' : ''
  const closeMinistry = useCallback(() => setMinistry(m => ({ ...m, open: false })), [])
  const openChapterMinistry = (fromMore: boolean) => {
    const scope: MinistryScope = { kind: 'chapter', book: bookN, chapter: chapterN, verse: selList[0] ?? currentVerse(), text: data?.verses, authors: companionAuthors }
    // from the More sheet: that sheet leaves before this one rises, as one sheet at a time
    if (!fromMore) { setMinistry({ open: true, scope }); return }
    setMore(false)
    setTimeout(() => setMinistry({ open: true, scope }), reduce ? 0 : scaleMs(EXIT_MS))
  }
  // the verses of this chapter some author wrote on: asked quietly when a selection first opens here, then kept, so the
  // bar offers Ministry only when there is something to show
  const selecting = selected.size > 0
  const [ministryHere, setMinistryHere] = useState<{ key: string; verses: ReadonlySet<number> } | null>(null)
  const known = ministryHere?.key === chapterKey ? ministryHere.verses : valid ? peekMinistryVerses(bookN, chapterN) : undefined
  useEffect(() => {
    if (!selecting || !valid) return
    let on = true
    void ministryVerses(bookN, chapterN).then(v => { if (on && v) setMinistryHere({ key: `${bookN}.${chapterN}`, verses: v }) })
    return () => { on = false }
  }, [selecting, valid, bookN, chapterN])
  const hasMinistry = !!known && selList.some(v => known.has(v))
  // the list the Ministry button opens, asked for quietly once the selection has settled: the sheet opens on it
  useEffect(() => {
    if (!hasMinistry) return
    const t = setTimeout(() => { void loadMinistryRefs(bookN, chapterN, selList) }, 400)
    return () => clearTimeout(t)
  }, [hasMinistry, selList, bookN, chapterN])
  const openVerseMinistry = () => setMinistry({ open: true, scope: { kind: 'verse', book: bookN, chapter: chapterN, verses: selList } })
  const selLabel = selList.length ? formatVerseRuns(bookN, chapterN, selList) : ''
  const selText = () => selList.map(v => data?.verses.find(x => x.v === v)?.t ?? '').join(' ')
  const highlight = async (color: HlColor | null) => {
    // the colour every selected verse already carries clears them; otherwise it paints the whole selection
    if (color && selList.every(v => highlights.get(verseId(bookN, chapterN, v)) === color)) color = null
    let failed = false
    for (const v of selList) {
      const id = verseId(bookN, chapterN, v)
      setHighlights(h => { const n = new Map(h); if (color) n.set(id, color); else n.delete(id); return n })
      await setHighlight(user?.id ?? null, id, color).catch(() => { failed = true })
    }
    if (failed) toast.show(user ? 'Highlight kept on this device; it will not sync until the server is reachable' : 'Could not save the highlight on this device')
    setSelected(new Set())
  }
  const openFlip = () => router.push({ pathname: '/flip/[book]/[chapter]', params: { book: String(bookN), chapter: String(chapterN), v: String(currentVerse()) } })
  const verseKey = (v: number) => bookmarkKey({ book: bookN, chapter: chapterN, verse: v })
  const bookmarkedAll = selList.length > 0 && selList.every(v => marks.has(verseKey(v)))
  /** Every selected verse already bookmarked: remove them; otherwise bookmark the ones that are not yet. */
  const bookmark = async () => {
    const put = (k: string, id: number | null) => setMarks(m => { const n = new Map(m); if (id === null) n.delete(k); else n.set(k, id); return n })
    try {
      if (bookmarkedAll) {
        for (const v of selList) { const id = marks.get(verseKey(v)); if (id !== undefined) { await removeBookmark(id); put(verseKey(v), null) } }
        toast.show(selList.length > 1 ? 'Bookmarks removed' : 'Bookmark removed')
      } else {
        for (const v of selList) {
          if (marks.has(verseKey(v))) continue
          put(verseKey(v), (await addBookmark({ book: bookN, chapter: chapterN, verse: v, label: null })).id)
        }
        toast.show('Bookmarked')
      }
    } catch { toast.show(bookmarkedAll ? 'Could not remove the bookmark' : 'Could not bookmark') }
    setSelected(new Set())
  }
  /** A chapter's or a book's bookmark on or off (the More sheet, a long press in the picker), said in a toast. */
  const toggleMark = async (t: BookmarkTarget) => {
    const k = bookmarkKey(t), id = marks.get(k)
    try {
      if (id !== undefined) {
        await removeBookmark(id)
        setMarks(m => { const n = new Map(m); n.delete(k); return n })
        toast.show('Bookmark removed')
      } else {
        const b = await addBookmark(t)
        setMarks(m => new Map(m).set(k, b.id))
        toast.show(`${bookmarkTitle(t)} bookmarked`)
      }
    } catch { toast.show(id !== undefined ? 'Could not remove the bookmark' : 'Could not bookmark') }
  }
  const chapterMarked = marks.has(bookmarkKey({ book: bookN, chapter: chapterN }))
  const copy = async () => {
    await Clipboard.setStringAsync(`${selText()} (${selLabel}, Darby)`)
    toast.show('Copied'); setSelected(new Set())
  }
  const share = async () => {
    const last = selList[selList.length - 1]
    const url = `${getApiBase() || siteOrigin()}/read/${bookN}/${chapterN}?v=${selList[0]}${last !== selList[0] ? `&v2=${last}` : ''}`
    const r = await shareText({ title: selLabel, message: `${selText()}\n— ${selLabel} (Darby)`, url })
    if (r === 'copied') toast.show('Copied with link')
  }

  // the portion's ministry, offered at the chapter's end and never required (docs/PATHS.md rule 6): opens the library
  // reader with `from` set, so Back returns to the verse the reader was at
  const then = onPathHere.portion?.then?.[0]
  const openThen = useCallback(() => {
    if (!then) return
    router.push({ pathname: '/companion', params: { author: then.author, work: then.work, n: String(then.n), from: `${bookN}.${chapterN}.${currentVerse()}` } })
  }, [then, router, bookN, chapterN, currentVerse])
  const thenLine = useMemo(() => then ? { label: `then, if you like: ${AUTHORS.find(a => a.id === then.author)?.short ?? then.author} on ${bookMeta(bookN).name} ${chapterN}`, onPress: openThen } : undefined, [then, openThen, bookN, chapterN])

  const neighbour = (t: Target | null, dir: 1 | -1): Page | null => {
    if (!t) return null
    const k = chapterKeyOf(t.book, t.chapter)
    return { key: k, index: slot.current + dir, node: (
      <ReaderPage book={t.book} chapter={t.chapter} data={neighbours.has(k) ? peekChapter(t.book, t.chapter) ?? null : null} layout={layoutOf(k)} scrollRef={pageRef(k)} padBottom={24} go={go} offscreen
        prefs={reading} selected={NO_VERSES} flash={NO_VERSES} spoken={null} highlights={NO_TINTS} bookmarked={NO_VERSES} openNotes={NO_VERSES}
        onNavigate={pageNavigate} allNotes={allNotes} wordTags={null} tapWords={wordMode} onWord={onWord} isRead={readSet.has(k)} marked={marks.has(bookmarkKey(t))} onSelect={toggleSelect} onToggleNote={toggleNote} />
    ) }
  }

  if (!valid) return <View style={[styles.fill, { backgroundColor: colors.bg, paddingTop: insets.top + 16 }]}><ErrorText>Pick a book and chapter.</ErrorText></View>
  const meta = bookMeta(bookN)
  const cue = {
    next: next ? `${pathNext ? 'Next on your path · ' : 'Next: '}${bookMeta(next.book).name} ${next.chapter}` : `${meta.name} ${chapterN} is the last chapter`,
    prev: prev ? `Previous: ${bookMeta(prev.book).name} ${prev.chapter}` : `${meta.name} ${chapterN} is the first chapter`,
    // the read-aloud bar covers the bottom of the page: the next cue rides above it
    inset: player.status !== 'idle' ? player.barHeight : 0,
  }

  return (
    <View style={[styles.fill, styles.row, { backgroundColor: colors.bg }]} onTouchStart={mark}>
      {/* the desktop's book pane: the primary way about the Bible there; the pill still opens the picker sheet */}
      {desktop ? <BookPane book={bookN} chapter={chapterN} readSet={readSet} marks={marks} onMark={t => { void toggleMark(t) }} onPick={(b, ch) => navigate({ book: b, chapter: ch })} /> : null}
      <View style={styles.fill} onLayout={desktop ? e => setColumnW(e.nativeEvent.layout.width) : undefined}>
      <View style={[styles.toolbar, { paddingTop: insets.top + 6, backgroundColor: colors.bar, borderBottomColor: colors.border }]}>
        <View>
          {/* the path dot scales with the system text size, so it stays a quiet mark beside a larger pill too */}
          <Button ref={tourRef('reader-picker')} title={`${meta.name} ${chapterN} ▾`} onPress={() => setPicker(true)} />
          {/* on the active path: one dot beside the ▾, nothing else changes */}
          {onPathHere.onPath ? <View pointerEvents="none" accessibilityLabel="On your path" style={[styles.pathDot, { backgroundColor: colors.accent, width: pathDot, height: pathDot, borderRadius: pathDot / 2, marginTop: -pathDot / 2 }]} /> : null}
        </View>
        <View style={{ flex: 1 }} />
        {/* nine controls need ~700 pt; a phone has 360-430, so the rarer ones move behind "more" there (TOOLBAR_WIDE); Reading
            settings sits behind More at every width (it leaves the reader, so it is not a reading control) */}
        {!compact ? <Button ref={tourRef('reader-size-down')} icon title="A−" accessibilityLabel="Smaller text" disabled={prefs.fontSize <= FONT_MIN} onPress={() => set({ fontSize: prefs.fontSize - 1 })} textStyle={{ fontSize: 14 }} /> : null}
        {!compact ? <Button ref={tourRef('reader-size')} icon title="A+" accessibilityLabel="Larger text" disabled={prefs.fontSize >= FONT_MAX} onPress={() => set({ fontSize: prefs.fontSize + 1 })} textStyle={{ fontSize: 18 }} /> : null}
        <ToggleButton on={allNotes} title="†" accessibilityLabel={allNotes ? 'Hide all footnotes' : 'Show all footnotes'} onPress={toggleAllNotes} textStyle={{ fontSize: 18 }} />
        {/* wrapped for the tour to measure; the button itself takes no ref */}
        {!compact ? <View ref={tourRef('reader-lookup')} collapsable={false}><ToggleButton on={wordMode} title="Aa" accessibilityLabel={wordMode ? 'Word lookup off' : 'Word lookup'}
          onPress={() => setWordMode(w => !w)} textStyle={{ fontSize: 14 }} /></View> : null}
        <Button ref={tourRef('reader-listen')} iconName="headphones" title="Read aloud" primary={player.status === 'playing' && player.book === bookN && player.chapter === chapterN} onPress={listen} />
        <Button ref={tourRef('reader-theme')} iconName="palette" title="Theme" onPress={() => setThemes(true)} />
        {!compact ? <Button ref={tourRef('reader-paged')} iconName="pages" title="Paged mode" onPress={openFlip} /> : null}
        {!compact && chapterMinistry ? <Button ref={tourRef('reader-ministry')} iconName="companion" title={chapterMinistry} onPress={() => openChapterMinistry(false)} /> : null}
        <Button ref={tourRef('reader-more')} iconName="more" title="More" primary={compact && wordMode} onPress={() => setMore(true)} />
      </View>
      <Sheet open={more} onClose={() => setMore(false)} title={`${meta.name} ${chapterN}`}>
        <View style={{ padding: 16, gap: 12 }}>
          {compact ? <View ref={tourRef('more-size')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <T style={{ flex: 1 }}>Text size</T>
            <Button icon title="A−" accessibilityLabel="Smaller text" disabled={prefs.fontSize <= FONT_MIN} onPress={() => set({ fontSize: prefs.fontSize - 1 })} textStyle={{ fontSize: 14 }} />
            <T muted style={{ minWidth: 28, textAlign: 'center' }}>{prefs.fontSize}</T>
            <Button icon title="A+" accessibilityLabel="Larger text" disabled={prefs.fontSize >= FONT_MAX} onPress={() => set({ fontSize: prefs.fontSize + 1 })} textStyle={{ fontSize: 18 }} />
          </View> : null}
          {compact ? <View ref={tourRef('more-lookup')}><SwitchRow label="Word lookup" hint="Tap a word: Strong’s concordance and Morrish" value={wordMode} onChange={setWordMode} /></View> : null}
          {compact ? <Button ref={tourRef('more-bookmark')} lead="bookmark" title={chapterMarked ? 'Remove chapter bookmark' : 'Bookmark this chapter'} onPress={() => { setMore(false); void toggleMark({ book: bookN, chapter: chapterN }) }} /> : null}
          {compact && chapterMinistry ? <Button ref={tourRef('more-ministry')} lead="companion" title={chapterMinistry} onPress={() => openChapterMinistry(true)} /> : null}
          {compact ? <Button ref={tourRef('more-paged')} lead="pages" title="Paged mode" onPress={() => { setMore(false); openFlip() }} /> : null}
          <Button lead="sliders" title="Reading settings" onPress={() => { setMore(false); router.push('/settings') }} />
        </View>
      </Sheet>

      <SwipePager ref={pager} reduce={reduce} width={pageW} onTurn={onTurn} cue={cue} onPull={onPull} edges={edgesNow} prev={neighbour(prev, -1)} next={neighbour(next, 1)} page={{ key: chapterKey, index: slot.current, node: (
        <ReaderPage book={bookN} chapter={chapterN} data={data} err={err} layout={layoutOf(chapterKey)} scrollRef={pageRef(chapterKey)} onScroll={onScroll} onDragStart={endNoteHold} onViewport={onViewport} next={next} then={thenLine}
          padBottom={selected.size ? 140 : player.status !== 'idle' ? 120 : 24} go={go}
          prefs={reading} selected={selected} flash={tinted} spoken={spokenHere} highlights={highlights} bookmarked={bookmarked} openNotes={openNotes}
          onNavigate={pageNavigate} allNotes={allNotes} wordTags={wordMode ? wordTags : null} tapWords={wordMode} onWord={onWord} isRead={readSet.has(chapterKey)} marked={chapterMarked} onSelect={toggleSelect} onToggleNote={toggleNote} />
      ) }} />
      {/* tap zones on the screen edges: previous / next chapter */}
      {prev && <Pressable accessibilityLabel="Previous chapter" onPress={() => go(-1)} style={[styles.edge, { left: 0 }]} />}
      {next && <Pressable accessibilityLabel="Next chapter" onPress={() => go(1)} style={[styles.edge, { right: 0 }]} />}
      <FontLoading state={fontState} size={52} />
      <ActionBar open={selected.size > 0} label={selLabel} shortLabel={selList.length ? formatVerseRuns(bookN, chapterN, selList, 'abbr') : ''} bookmarked={bookmarkedAll} lift={player.status !== 'idle' ? player.barHeight : 0} onListen={() => { const v = selList[0] ?? 1; const last = selList[selList.length - 1]; setSelected(new Set()); player.seekVerse(bookN, chapterN, v, prefs.ttsStopAtSelection && last ? { stopAfter: last } : undefined) }} onHighlight={highlight} onBookmark={bookmark} onCopy={copy} onShare={share} onClose={() => setSelected(new Set())}
        onJot={() => setAddOutline(true)} onMinistry={hasMinistry ? openVerseMinistry : undefined} />
      <ChapterPicker open={picker} book={bookN} chapter={chapterN} readSet={readSet} marks={marks} onMark={t => { void toggleMark(t) }} onClose={() => setPicker(false)} onPick={(b, c) => { setPicker(false); navigate({ book: b, chapter: c }) }} />
      <WordSheet target={wordTarget} onClose={() => setWordTarget(null)} />
      <MinistrySheet open={ministry.open} scope={ministry.scope} onClose={closeMinistry} />
      <PlayerBar flatTop={selected.size > 0} />
      <Sheet open={themes} onClose={() => setThemes(false)} title="Theme">
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8 }}><ThemeGallery compact /></ScrollView>
      </Sheet>
      <AddToOutlineSheet open={addOutline} book={bookN} chapter={chapterN} verses={selList} onDone={(o: Outline | null) => { setAddOutline(false); if (o) { setSelected(new Set()); toast.show(`Added to “${o.title}”`) } }} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: 'row' },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  edge: { position: 'absolute', top: 120, bottom: 120, width: 18 },
  pathDot: { position: 'absolute', right: 8, top: '50%' },
})
