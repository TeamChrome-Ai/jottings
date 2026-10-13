import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { homeOf } from '@shared/companion'
import type { Library, MinistrySection, WorkContents } from '@shared/ministry'
import type { Ref } from '@shared/ref'
import SwipePager, { type Page, type SwipePagerHandle } from './SwipePager'
import LibraryPage, { type LibraryLayout, type LibraryPlace } from './LibraryPage'
import ContentsPicker from './ContentsPicker'
import ThemeGallery from './ThemeGallery'
import FontLoading from './FontLoading'
import { refParams } from './FootnoteText'
import { Button, ErrorText, Sheet, Spinner, SwitchRow, T } from './ui'
import WordSheet, { type WordTarget } from './WordSheet'
import { ToggleButton } from './motion/reader'
import { isLookupWord, warmWordLookup } from '@shared/cbd'
import { lookupGlossary } from '@shared/glossary'
import type { WordTap } from '@shared/wordTap'
import { loadDictionaryIndex } from '../lib/dictionary'
import { darbyGlossary } from '../lib/glossary'
import { topWordCode } from '../lib/wordCodes'
import { setWordLookup, useWordLookup } from '../store/wordLookup'
import { createEdgeLedger, edgesOf, type Edges, type PullDir } from '../lib/edgePull'
import { headingLine, landing, neighbourOf, opensToContents, pageIndex, paragraphAt, shelfOf, shortTitle, toolbarTitle, fromLabel, fromRef, type ReaderLink, type Spot } from '../lib/libraryNav'
import { loadContents, loadLibrary, loadSection, peekContents, peekLibrary, peekSection, unavailableFor } from '../lib/ministryLibrary'
import { flushPositions, loadPositions, peekPosition, savePosition } from '../lib/libraryPosition'
import { useLazyFontState } from '../lib/fonts'
import { TOOLBAR_WIDE } from '../lib/tour'
import { tourRef } from '../store/tour'
import { useInks } from '../hooks/useTheme'
import { ALIGN_SELF, FONT_MAX, FONT_MIN, READ_EM, usePrefPick, usePrefsStore } from '../store/prefs'

/** Pages either side are laid out this long after the current one has its text: the reader's. */
const NEIGHBOURS_AFTER_MS = 150
/** A landing puts its paragraph this far below the top, so the paragraph before it just shows. */
const LEAD = 24
/** After a landing, later layout (web fonts, a note opening above) re-places it for this long. */
const HOLD_MS = 1500
/** How often the place is noted while reading (it is also noted on every turn and on leaving). */
const SAVE_MS = 4000

const keyOf = (work: string, n: number) => `${work}/${n}`

/**
 * A work of the ministry library, read as the Bible is: one section at a time in its own scroll view, the sections
 * either side mounted offscreen (SwipePager: sideways turns, and the edge pull at the top or bottom of a section, with
 * its cue), across into the next work of the collection as Genesis 50 turns to Exodus 1. The title opens the
 * contents (ContentsPicker); the reader's font, size, line height, measure and theme apply; the place is kept per
 * work on the device. A deep link lands on a paragraph with one accent wash (`p`), and `from` (the verse it was
 * opened from) turns Back into a way back to that verse.
 */
const READER_PREFS = ['align', 'font', 'fontSize', 'lineHeight', 'reduceMotion', 'width'] as const

export default function LibraryReader({ author, work, link }: { author: string; work: string; link: ReaderLink }) {
  const router = useRouter()
  // the fields read here, not the whole record: a theme tap must not re-render the pages
  const prefs = usePrefPick(READER_PREFS)
  const { set } = usePrefsStore()
  const colors = useInks()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const compact = width < TOOLBAR_WIDE
  const fontState = useLazyFontState(prefs.font)
  const reduce = prefs.reduceMotion

  // ---- what is loaded: the library (for the collection), contents per work, sections per (work, n) ----
  const [library, setLibrary] = useState<Library | null>(peekLibrary)
  useEffect(() => { let on = true; void loadLibrary().then(l => { if (on) setLibrary(l) }); return () => { on = false } }, [])
  const shelf = useMemo(() => shelfOf(library, author, work), [library, author, work])
  const [contentsTick, setContentsTick] = useState(0)
  const failedContents = useRef(new Map<string, null>())
  const contentsOf = useCallback((w: string): WorkContents | null | undefined => peekContents(author, w) ?? failedContents.current.get(w), [author, contentsTick])  // eslint-disable-line react-hooks/exhaustive-deps
  const wantContents = useCallback((w: string) => {
    if (peekContents(author, w)) return
    void loadContents(author, w).then(c => { if (!c) failedContents.current.set(w, null); setContentsTick(t => t + 1) })
  }, [author])
  const [sectionTick, setSectionTick] = useState(0)
  const failedSections = useRef(new Set<string>())
  const sectionOf = useCallback((s: Spot): MinistrySection | null | undefined => peekSection(author, s.work, s.n) ?? (failedSections.current.has(keyOf(s.work, s.n)) ? null : undefined), [author, sectionTick])  // eslint-disable-line react-hooks/exhaustive-deps
  const wantSection = useCallback((s: Spot) => {
    if (peekSection(author, s.work, s.n)) return Promise.resolve(true)
    failedSections.current.delete(keyOf(s.work, s.n))
    return loadSection(author, s.work, s.n).then(x => { if (!x) failedSections.current.add(keyOf(s.work, s.n)); setSectionTick(t => t + 1); return !!x })
  }, [author])

  // ---- where the reader is: `n` from the link, else where this work was left (read once the positions are in) ----
  const [positionsIn, setPositionsIn] = useState(peekPosition(author, work) !== undefined)
  useEffect(() => { if (!positionsIn) void loadPositions().then(() => setPositionsIn(true)) }, [positionsIn])
  const contents = contentsOf(work)
  const count = contents?.sections.length
  const target = useMemo(() => positionsIn ? landing(link, peekPosition(author, work), count) : null, [positionsIn, link.n, link.p, author, work, count])  // eslint-disable-line react-hooks/exhaustive-deps
  const n = target?.n ?? 1
  const liveKey = useRef(keyOf(work, n))
  liveKey.current = keyOf(work, n)
  useEffect(() => { wantContents(work) }, [work, wantContents])
  const placed = !!target
  useEffect(() => { if (placed) void wantSection({ work, n }) }, [placed, work, n, wantSection])
  const section = sectionOf({ work, n })

  // ---- each page's scroll view and layout, kept for the pages either side (the reader's pattern) ----
  const pageRefs = useRef(new Map<string, { current: ScrollView | null }>())
  const pageRef = useCallback((k: string) => {
    let r = pageRefs.current.get(k)
    if (!r) { r = { current: null }; pageRefs.current.set(k, r) }
    return r
  }, [])
  const scrollRef = useMemo(() => ({ get current() { return pageRefs.current.get(liveKey.current)?.current ?? null } }), [])
  const scrollY = useRef(0), contentH = useRef(1), viewportH = useRef(1)
  /** Each page's offset as last reported or set (see createEdgeLedger): a page turned back to keeps its scroll, and
   *  the previous section comes in scrolled to its end while offscreen, where onScroll never reaches this reader. */
  const ledger = useRef(createEdgeLedger()).current
  const pager = useRef<SwipePagerHandle>(null)
  const syncEdges = useCallback(() => {
    const e = ledger.edges(liveKey.current, contentH.current, viewportH.current)
    pager.current?.setEdges(e.top, e.bottom)
  }, [ledger])
  const edgesNow = useCallback((): Edges => {
    const node = Platform.OS === 'web' ? (scrollRef.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null)?.getScrollableNode?.() : null
    return node ? edgesOf(node.scrollTop, node.scrollHeight, node.clientHeight) : ledger.edges(liveKey.current, contentH.current, viewportH.current)
  }, [scrollRef, ledger])
  /** A scroll this reader makes itself: what the ledger and the edges know at once, not after an onScroll that may
   *  never come (a page already where it is asked to go emits none). */
  const placeAt = useCallback((k: string, y: number | 'end') => {
    if (y === 'end') { ledger.toEnd(k); if (k === liveKey.current) scrollY.current = Math.max(0, contentH.current - viewportH.current) }
    else { ledger.scrolled(k, y); if (k === liveKey.current) scrollY.current = y }
    if (k === liveKey.current) syncEdges()
  }, [ledger, syncEdges])
  const layouts = useRef(new Map<string, LibraryLayout>())
  const landRef = useRef(() => {})
  const layoutOf = useCallback((k: string) => {
    let l = layouts.current.get(k)
    if (!l) {
      const rec: LibraryLayout = {
        textY: -1, tops: [], height: 1,
        onText: y => { rec.textY = y; if (liveKey.current === k) landRef.current() },
        onPara: (i, y) => { rec.tops[i] = y; if (liveKey.current === k) landRef.current() },
        onSize: (_w, h) => { rec.height = h; if (liveKey.current === k) { contentH.current = h; syncEdges(); landRef.current() } },
      }
      layouts.current.set(k, rec)
      l = rec
    }
    return l
  }, [syncEdges])

  // ---- landing: on arrival at the kept place or the linked paragraph; after a turn, at the top (or the end) ----
  const pending = useRef<{ key: string; p: number; dy: number; wash: boolean } | null>(null)
  const held = useRef<{ key: string; p: number; dy: number; until: number } | null>(null)
  const [wash, setWash] = useState<{ key: string; p: number } | null>(null)
  /** A turn or a pick sets this before it moves the params, so the arrival is not taken for a link. */
  const expected = useRef<{ key: string; end: boolean } | null>(null)
  /** Whether the place may be noted: not before a landing has put the page where it belongs. */
  const settled = useRef(false)
  const arrived = useRef('')
  const yFor = useCallback((k: string, p: number, dy: number) => {
    const l = layouts.current.get(k)
    const top = l?.tops[p]
    if (!l || l.textY < 0 || top === undefined) return null
    return Math.max(0, l.textY + top + (dy || -LEAD))
  }, [])
  const land = useCallback(() => {
    const L = pending.current
    if (L && L.key === liveKey.current) {
      if (L.p === 0 && L.dy === 0 && !L.wash) { pending.current = null; settled.current = true; return }
      const y = yFor(L.key, L.p, L.dy)
      if (y === null) return
      pending.current = null
      held.current = { key: L.key, p: L.p, dy: L.dy, until: Date.now() + HOLD_MS }
      // as a book falls open at its page: no scroll down from the heading; the wash starts with the jump, where it is seen
      const go = () => {
        if (liveKey.current !== L.key) return
        const at = yFor(L.key, L.p, L.dy) ?? y
        scrollRef.current?.scrollTo({ y: at, animated: false })
        placeAt(L.key, at)
        settled.current = true
        if (L.wash) setWash({ key: L.key, p: L.p })
      }
      const fonts = (globalThis as { document?: { fonts?: { ready: Promise<unknown> } } }).document?.fonts
      if (fonts) void fonts.ready.then(() => setTimeout(go, 30)); else setTimeout(go, 30)
      return
    }
    const h = held.current
    if (h && h.key === liveKey.current && Date.now() < h.until) { const y = yFor(h.key, h.p, h.dy); if (y !== null) { scrollRef.current?.scrollTo({ y, animated: false }); placeAt(h.key, y) } }
  }, [yFor, scrollRef, placeAt])
  landRef.current = land

  // an arrival: the first render with a place, a pick, a link; a turn has set `expected` and lands where it said
  useEffect(() => {
    if (!target) return
    const k = keyOf(work, n)
    if (arrived.current === k) return
    arrived.current = k
    const lay = layoutOf(k)
    contentH.current = lay.height
    const e = expected.current
    expected.current = null
    held.current = null
    setWash(w => w && w.key === k ? w : null)
    // the edges are the page's own: where a turn's page was left (the ledger), its end, or unknown until it lands
    if (e && e.key === k) {
      pending.current = null
      settled.current = true
      if (e.end) { placeAt(k, 'end'); requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: false })) }
      else placeAt(k, ledger.y(k) ?? 0)
    } else {
      settled.current = false
      pending.current = { key: k, p: target.p, dy: target.dy, wash: target.wash }
      if (!target.p && !target.dy) { scrollRef.current?.scrollTo({ y: 0, animated: false }); placeAt(k, 0) }
      else { ledger.unknown(k); scrollY.current = 0; syncEdges() }
    }
    // drop the layouts and refs of pages no longer beside this one
    const keep = new Set([k, ...[prevSpot, nextSpot].map(s => s ? keyOf(s.work, s.n) : '')])
    for (const x of layouts.current.keys()) if (!keep.has(x)) { layouts.current.delete(x); ledger.drop(x) }
    for (const x of pageRefs.current.keys()) if (!keep.has(x)) pageRefs.current.delete(x)
    land()
  })  // eslint-disable-line react-hooks/exhaustive-deps

  // ---- the place, noted per work ----
  const note = useCallback(() => {
    if (!target || !settled.current || pending.current) return
    const k = liveKey.current
    const l = layouts.current.get(k)
    if (!l || l.textY < 0 || !l.tops.length) return
    const [w, nn] = [k.slice(0, k.lastIndexOf('/')), +k.slice(k.lastIndexOf('/') + 1)]
    const at = paragraphAt(l.tops.map(t => t === undefined ? undefined : t + l.textY), scrollY.current)
    const c = peekContents(author, w)
    savePosition(author, w, { n: nn, p: at.p, dy: at.dy, title: c?.work.title, section: c?.sections[nn - 1]?.title })
  }, [author, target])
  useEffect(() => {
    const t = setInterval(note, SAVE_MS)
    const sub = AppState.addEventListener('change', s => { if (s !== 'active') { note(); flushPositions() } })
    return () => { clearInterval(t); sub.remove(); note(); flushPositions() }
  }, [note])
  useFocusEffect(useCallback(() => () => { note(); flushPositions() }, [note]))

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y
    contentH.current = e.nativeEvent.contentSize.height
    viewportH.current = e.nativeEvent.layoutMeasurement.height
    ledger.scrolled(liveKey.current, scrollY.current)
    syncEdges()
  }, [ledger, syncEdges])
  const onViewport = useCallback((e: LayoutChangeEvent) => { viewportH.current = e.nativeEvent.layout.height; syncEdges() }, [syncEdges])

  // ---- turns ----
  const prevSpot = target ? neighbourOf(shelf, work, n, count ?? shelf?.collection.works[shelf.at]?.count ?? n, -1) : null
  const nextSpot = target ? neighbourOf(shelf, work, n, count ?? shelf?.collection.works[shelf.at]?.count ?? n, 1) : null
  useEffect(() => { for (const s of [nextSpot, prevSpot]) if (s && s.work !== work) wantContents(s.work) }, [nextSpot?.work, prevSpot?.work, work, wantContents])  // eslint-disable-line react-hooks/exhaustive-deps
  const moveTo = useCallback((s: Spot, end = false) => {
    note()
    expected.current = { key: keyOf(s.work, s.n), end }
    setWash(null)
    router.setParams({ work: s.work, n: String(s.n), p: '' })
  }, [note, router])
  const onTurn = useCallback((dir: 1 | -1, vertical: boolean) => {
    const s = dir > 0 ? nextSpot : prevSpot
    if (s) moveTo(s, vertical && dir < 0)
  }, [nextSpot, prevSpot, moveTo])
  const onPull = useCallback((dir: PullDir, active: boolean) => {
    const s = dir > 0 ? nextSpot : prevSpot
    const k = s ? keyOf(s.work, s.n) : ''
    const r = s && pageRefs.current.get(k)?.current
    if (!r) return
    if (dir < 0 && active) { r.scrollToEnd({ animated: false }); placeAt(k, 'end') }
    else { r.scrollTo({ y: 0, animated: false }); placeAt(k, 0) }
  }, [nextSpot, prevSpot, placeAt])
  const go = useCallback((dir: 1 | -1) => pager.current?.go(dir), [])
  const goRef = useRef(go)
  goRef.current = go

  // the pages either side, fetched and allowed to render once the current one has its text, next first
  const [neighbours, setNeighbours] = useState<ReadonlySet<string>>(new Set())
  const hasText = !!section
  useEffect(() => {
    if (!hasText) return
    let cancelled = false
    const around = [nextSpot, prevSpot].filter((s): s is Spot => !!s)
    const frame = () => new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0)))
    const t = setTimeout(async () => {
      for (const s of around) {
        const ok = await wantSection(s)
        if (cancelled) return
        const k = keyOf(s.work, s.n)
        // only the pages beside the current one stay allowed
        // a transition: the offscreen section renders in slices that yield to a tap, a scroll or the next turn
        if (ok) startTransition(() => setNeighbours(x => x.has(k) ? x : new Set([...[...x].filter(y => around.some(a => keyOf(a.work, a.n) === y)), k])))
        await frame()
      }
    }, NEIGHBOURS_AFTER_MS)
    return () => { cancelled = true; clearTimeout(t) }
  }, [hasText, nextSpot?.work, nextSpot?.n, prevSpot?.work, prevSpot?.n, wantSection])  // eslint-disable-line react-hooks/exhaustive-deps

  // web: arrow keys turn sections while this screen is focused
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== 'web') return
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as { tagName?: string } | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'ArrowRight') goRef.current(1)
      else if (e.key === 'ArrowLeft') goRef.current(-1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, []))

  // ---- following a reference, and back to the verse ----
  const onRef = useCallback((r: Ref) => { note(); flushPositions(); router.push(refParams(r)) }, [note, router])
  const refRef = useRef(onRef)
  refRef.current = onRef
  const pageRefLink = useCallback((r: Ref) => refRef.current(r), [])
  const from = link.from
  const summaryOf = (w: string) => shelf?.collection.works.find(x => x.id === w)
  const back = () => {
    note(); flushPositions()
    if (from) { router.dismissTo(refParams(fromRef(from))); return }
    if (router.canGoBack()) { router.back(); return }
    // a link with no history: up to the work's contents where the library lists them, else the library
    const w = summaryOf(work)
    router.replace(shelf && w && opensToContents(shelf.collection.works, w) ? { pathname: '/companion', params: { author, work, view: 'contents' } } : '/companion')
  }

  // ---- word lookup: the session's switch (store/wordLookup); a tap opens the word sheet on Darby's own term when
  // the word is one, the Strong's number his text renders with the word when it has one, and the dictionary ----
  const lookup = useWordLookup()
  const [wordTarget, setWordTarget] = useState<WordTarget | null>(null)
  // the first tapped word should not wait for the dictionary's index
  useEffect(() => { if (lookup) void loadDictionaryIndex().then(i => { if (i) warmWordLookup(i) }) }, [lookup])
  const onWord = useCallback((tap: WordTap) => {
    const entry = lookupGlossary(darbyGlossary(), tap)
    // function words open nothing, as in the Bible reader; a term of Darby's always does
    if (!entry && !isLookupWord(tap.word)) return
    void topWordCode(tap.word).then(code => setWordTarget({ code, word: tap.word, term: entry?.term }))
  }, [])

  // ---- the toolbar and its sheets ----
  const [picker, setPicker] = useState(false)
  const [more, setMore] = useState(false)
  const [themes, setThemes] = useState(false)
  const pick = (w: string, k: number) => {
    setPicker(false)
    if (w === work && k === n) return
    note()
    setWash(null)
    // an arrival like a link's: at the section's top, or where it was left when it is the one kept for its work
    router.setParams({ work: w, n: String(k), p: '' })
  }

  // ---- the pages ----
  const workOf = (w: string) => { const c = contentsOf(w); return c ? c.work : summaryOf(w) ?? { id: w, title: w, kind: 'papers' as const } }
  const labelOf = (s: Spot | null) => s ? (contentsOf(s.work) || s.work === work ? toolbarTitle(workOf(s.work), contentsOf(s.work)?.sections[s.n - 1], s.n) : shortTitle(workOf(s.work).title)) : null
  const places = useRef(new Map<string, { meta: unknown; place: LibraryPlace }>())
  const placeOf = (s: Spot): LibraryPlace | null => {
    const meta = contentsOf(s.work)?.sections[s.n - 1]
    if (!meta) return null
    const k = keyOf(s.work, s.n)
    const hit = places.current.get(k)
    if (hit && hit.meta === meta) return hit.place
    const w = workOf(s.work)
    const place = { author, work: { id: w.id, title: w.title, kind: w.kind }, section: meta }
    places.current.set(k, { meta, place })
    return place
  }
  const homes = useRef(new Map<string, ReturnType<typeof homeOf>>())
  const homeFor = (s: Spot, place: LibraryPlace | null) => {
    const k = keyOf(s.work, s.n)
    if (!place) return undefined
    if (!homes.current.has(k)) homes.current.set(k, homeOf(place, contentsOf(s.work) ?? undefined))
    return homes.current.get(k)
  }
  const fs = prefs.fontSize
  const maxWidth = READ_EM[prefs.width] ? Math.round(fs * READ_EM[prefs.width]!) + 40 : undefined
  const source = shelf?.author.source ?? library?.authors.find(a => a.id === author)?.source ?? ''
  const pageFor = (s: Spot, current: boolean): Page => {
    const k = keyOf(s.work, s.n)
    const place = placeOf(s)
    const around = [neighbourOf(shelf, s.work, s.n, contentsOf(s.work)?.sections.length ?? s.n, -1), neighbourOf(shelf, s.work, s.n, contentsOf(s.work)?.sections.length ?? s.n, 1)]
    const at = shelf ? Math.max(0, shelf.collection.works.findIndex(x => x.id === s.work)) : 0
    return { key: k, index: pageIndex(at, s.n), node: (
      <LibraryPage place={place} line={place ? headingLine(shelf && shelf.collection.works.length > 1 ? shelf.collection.title : undefined, place.work.title, place.section.part) : ''}
        section={current || neighbours.has(k) ? sectionOf(s) : undefined} home={homeFor(s, place)} unavailable={unavailableFor(author)}
        size={fs} lineHeight={prefs.lineHeight} maxWidth={maxWidth} alignSelf={ALIGN_SELF[prefs.align]}
        wash={wash && wash.key === k ? wash.p : -1} prevLabel={labelOf(around[0])} nextLabel={labelOf(around[1])} source={source}
        layout={layoutOf(k)} padBottom={24} go={go} onRef={pageRefLink} scrollRef={pageRef(k)} onWord={lookup ? onWord : undefined}
        onScroll={current ? onScroll : undefined} onViewport={current ? onViewport : undefined} offscreen={!current} />
    ) }
  }

  const title = contents ? toolbarTitle(contents.work, contents.sections[n - 1], n) : shortTitle(summaryOf(work)?.title ?? '')
  const unit = shelf && shelf.collection.works.length > 1 ? shelf.collection.title : shortTitle(workOf(work).title)
  const cue = {
    next: nextSpot ? `Next: ${labelOf(nextSpot)}` : `The end of ${unit}`,
    prev: prevSpot ? `Previous: ${labelOf(prevSpot)}` : `The start of ${unit}`,
  }
  const verse = from ? fromLabel(from) : ''
  const size = (d: 1 | -1) => set({ fontSize: prefs.fontSize + d })
  const failedWork = contents === null && !count

  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ headerShown: false, title: title || 'Ministry' }} />
      <View style={[styles.toolbar, { paddingTop: insets.top + 6, backgroundColor: colors.bar, borderBottomColor: colors.border }]}>
        {from ? <Button ref={tourRef('library-back')} lead="back" title={compact ? fromLabel(from, 'abbr') : verse} accessibilityLabel={`Back to the verse, ${verse}`} onPress={back} style={{ flexShrink: 0 }} />
          : <Button ref={tourRef('library-back')} iconName="back" title="Back" onPress={back} />}
        <Button title={title} trail="disclose" accessibilityLabel={`${title}, contents`} onPress={() => setPicker(true)} style={styles.title} disabled={!contents} />
        <View style={{ flex: 1 }} />
        {!compact ? <Button icon title="A−" accessibilityLabel="Smaller text" disabled={fs <= FONT_MIN} onPress={() => size(-1)} textStyle={{ fontSize: 14 }} /> : null}
        {!compact ? <Button icon title="A+" accessibilityLabel="Larger text" disabled={fs >= FONT_MAX} onPress={() => size(1)} textStyle={{ fontSize: 18 }} /> : null}
        {!compact ? <ToggleButton on={lookup} title="Aa" accessibilityLabel={lookup ? 'Word lookup off' : 'Word lookup'} onPress={() => setWordLookup(!lookup)} textStyle={{ fontSize: 14 }} /> : null}
        {!compact ? <Button iconName="palette" title="Theme" onPress={() => setThemes(true)} /> : null}
        {!compact ? <Button iconName="sliders" title="Reading settings" onPress={() => router.push('/settings')} /> : null}
        {compact ? <Button iconName="more" title="More" primary={lookup} onPress={() => setMore(true)} /> : null}
      </View>

      {!target ? <Spinner /> : failedWork ? <View style={{ padding: 20 }}><ErrorText>{unavailableFor(author)}</ErrorText></View> : (
        <SwipePager ref={pager} reduce={reduce} width={width} onTurn={onTurn} cue={cue} onPull={onPull} edges={edgesNow}
          prev={prevSpot ? pageFor(prevSpot, false) : null} next={nextSpot ? pageFor(nextSpot, false) : null} page={pageFor({ work, n }, true)} />
      )}
      {prevSpot ? <Pressable accessibilityLabel="Previous section" onPress={() => go(-1)} style={[styles.edge, { left: 0 }]} /> : null}
      {nextSpot ? <Pressable accessibilityLabel="Next section" onPress={() => go(1)} style={[styles.edge, { right: 0 }]} /> : null}
      <FontLoading state={fontState} size={52} />

      <ContentsPicker open={picker} author={author} shelf={shelf} work={work} contents={contents} n={n} load={w => loadContents(author, w)}
        onClose={() => setPicker(false)} onPick={pick} />
      <Sheet open={more} onClose={() => setMore(false)} title={title}>
        <View style={{ padding: 16, gap: 12 }}>
          <Button lead="list" title="Contents" disabled={!contents} onPress={() => { setMore(false); setTimeout(() => setPicker(true), reduce ? 0 : 220) }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <T style={{ flex: 1 }}>Text size</T>
            <Button icon title="A−" accessibilityLabel="Smaller text" disabled={fs <= FONT_MIN} onPress={() => size(-1)} textStyle={{ fontSize: 14 }} />
            <T muted style={{ minWidth: 28, textAlign: 'center' }}>{fs}</T>
            <Button icon title="A+" accessibilityLabel="Larger text" disabled={fs >= FONT_MAX} onPress={() => size(1)} textStyle={{ fontSize: 18 }} />
          </View>
          <SwitchRow label="Word lookup" hint="Tap a word: Darby’s usage, Strong’s concordance and Morrish" value={lookup} onChange={setWordLookup} />
          <Button lead="palette" title="Theme" onPress={() => { setMore(false); setTimeout(() => setThemes(true), reduce ? 0 : 220) }} />
          <Button lead="sliders" title="Reading settings" onPress={() => { setMore(false); router.push('/settings') }} />
        </View>
      </Sheet>
      <WordSheet target={wordTarget} onClose={() => setWordTarget(null)} />
      <Sheet open={themes} onClose={() => setThemes(false)} title="Theme">
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 8 }}><ThemeGallery compact /></ScrollView>
      </Sheet>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flexShrink: 1, paddingHorizontal: 16 },
  edge: { position: 'absolute', top: 120, bottom: 120, width: 18 },
})
