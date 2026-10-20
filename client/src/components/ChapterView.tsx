import { memo, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Animated, Platform, StyleSheet, Text, View, type LayoutChangeEvent, type NativeSyntheticEvent, type TextLayoutEventData, type TextStyle } from 'react-native'
import { isLookupWord, wholeWord } from '@shared/cbd'
import { t, tc } from '@shared/i18n'
import { isLettered, relabel } from '../lib/noteLetters'
import type { Note, Verse } from '@shared/types'
import type { Ref } from '@shared/ref'
import type { ChapterData } from '../lib/bible'
import { book as bookMeta, tokenize, verseId } from '../lib/bible'
import { wordIndexAt } from '../lib/tts'
import { TEXT_FIT, face, fontFamily } from '../theme'
import { lineFactor } from '../lib/lineHeight'
import { hlKey, type HlColor } from '../lib/hlColours'
import { usePageInks, useThemeSelect } from '../hooks/useTheme'
import InkText from './InkText'
import { ALIGN_SELF, READ_EM, usePrefPick, usePrefsStore, type Prefs } from '../store/prefs'
import { POP_SPRING } from '../lib/motion'
import FootnoteText from './FootnoteText'
import Icon from './Icon'
import type { WordTags } from './WordSheet'
import { Reveal, phase, useColorTransition, useEntrance, useSetPresence } from './motion/reader'
import { Tap } from './ui'
import { tourRef, useTourNote } from '../store/tour'

export interface ParaLayout { index: number; y: number; height: number; firstVerse: number; lastVerse: number }
export type { HlColor } from '../lib/hlColours'

/** The "show all" toolbar toggle expands the lettered notes; one-word symbol glosses (· El, † Eloah) stay tap-to-open. */
export { isLettered } from '../lib/noteLetters'
const NO_TAGS: [string, string][] = []
const EMPTY: ReadonlySet<number> = new Set()

/** The preferences the chapter is laid out with; the theme is not among them (colour is painted by the leaves). */
export type ReadingPrefs = Pick<Prefs, 'fontSize' | 'font' | 'lineHeight' | 'letterSpacing' | 'wordSpacing' | 'paragraphs' | 'showNotes' | 'noteLetters' | 'verseNumbers' | 'reduceMotion' | 'width' | 'align'>
const READING: readonly (keyof ReadingPrefs)[] = ['fontSize', 'font', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paragraphs', 'showNotes', 'noteLetters', 'verseNumbers', 'reduceMotion', 'width', 'align']
/** Stable until a reading preference changes: a theme tap or any other setting leaves the chapter alone. */
export const useReadingPrefs = (): ReadingPrefs => usePrefPick(READING)

interface Props {
  data: ChapterData
  prefs: ReadingPrefs
  selected: ReadonlySet<number>
  /** Verses tinted briefly after arriving by link or search; no selection bar. */
  flash?: ReadonlySet<number>
  highlights: ReadonlyMap<number, string>
  bookmarked: ReadonlySet<number>
  openNotes: ReadonlySet<number>
  /** Every lettered note of the chapter expanded (the † toggle). */
  allNotes?: boolean
  /** Strong's word mode: tagged words get a dotted underline and open the dictionary on tap. */
  wordTags?: WordTags | null
  /** Dictionary word lookup: every word that could name an article opens the sheet on tap, an untagged one with code "". */
  tapWords?: boolean
  onWord?: (code: string, word: string) => void
  isRead: boolean
  /** The chapter itself is bookmarked: a small ribbon beside the numeral. */
  marked?: boolean
  onSelect: (v: number) => void
  onToggleNote: (id: number) => void
  onParaLayout: (l: ParaLayout) => void
  /** A cross-reference inside a footnote was tapped; the screen decides between scrolling and navigating. */
  onNavigate?: (r: Ref) => void
  /** Every verse reports where it starts inside its paragraph (index into `paras`), for exact scrolling. */
  onVerseLayout?: (v: number, paraIndex: number, y: number) => void
  /** Read-aloud: the word being spoken, as (verse, char offset into the verse text). */
  spoken?: { v: number; off: number | null } | null
  /** Side by side (docs/LANGUAGES.md): the same chapter of a second Bible, each verse under its own, or beside it on a
   *  wide screen (`wide`). Every verse is then a paragraph of its own. */
  second?: ChapterData | null
  wide?: boolean
}

/** A verse's own printed chapter and number in a Bible other than the English (the English ones elsewhere). */
const ownChapter = (v: Verse, c: number) => v.nc ?? c
export const verseLabel = (v: Verse) => (v.nvTo ? `${v.nv ?? v.v}${v.ncTo ? `–${v.ncTo}:` : '-'}${v.nvTo}` : String(v.nv ?? v.v))

/**
 * Paragraph layout from the `p` / `hd` flags; each verse is a memoised nested Text. Memoised itself: the reading
 * screen re-renders for its sheets, toasts and every spoken word, and none of those may walk the chapter. No colour
 * passes through it: a theme change repaints the leaves that carry one (InkText, the heading, a note, a tinted verse).
 */
export default memo(function ChapterView({ data, prefs, selected, flash = EMPTY, highlights, bookmarked, openNotes, allNotes = false, wordTags = null, tapWords = false, onWord, isRead, marked = false, onSelect, onToggleNote, onParaLayout, onNavigate, onVerseLayout, spoken = null, second = null, wide = false }: Props) {
  const meta = bookMeta(data.book)
  // the footnote letters the reader chose (lib/noteLetters.ts); `data` itself is what the server sent
  const verses = useMemo(() => relabel(data.verses, prefs.noteLetters), [data.verses, prefs.noteLetters])
  // a paragraph never runs across a printed chapter of the Bible shown (its number heads the new one), and side by side
  // every verse is one
  const paras = useMemo(() => {
    const out: Verse[][] = []
    let prev: Verse | null = null
    for (const v of verses) {
      const turn = prev !== null && ownChapter(prev, data.c) !== ownChapter(v, data.c)
      if (!out.length || !prefs.paragraphs || second || v.p || v.hd || turn) out.push([v])
      else out[out.length - 1].push(v)
      prev = v
    }
    return out
  }, [verses, prefs.paragraphs, second, data.c])
  const secondBy = useMemo(() => new Map((second?.verses ?? []).map(v => [v.v, v])), [second])
  const pair = !!second && wide

  const fs = prefs.fontSize
  const dys = prefs.font === 'dyslexic'
  // never below the font's floor: Android clips descenders at the bottom of each verse's Text (lib/lineHeight.ts)
  const lineHeight = fs * lineFactor(prefs.font, prefs.lineHeight)
  const letterSpacing = fs * (dys ? Math.max(prefs.letterSpacing, 0.03) : prefs.letterSpacing)
  const wordSpacing = fs * (dys ? Math.max(prefs.wordSpacing, 0.12) : prefs.wordSpacing)
  const family = fontFamily(prefs.font)
  const paraStyle = useMemo(() => ({ fontSize: fs, lineHeight, letterSpacing, fontFamily: family, ...TEXT_FIT }), [fs, lineHeight, letterSpacing, family])

  // footnotes: the ones that should be open, in chapter order (so an "expand all" batch staggers top-down);
  // a closed one stays mounted, collapsing, until its exit finishes
  const reduce = prefs.reduceMotion
  // the guided tour opens one note for a moment, exactly as a tap would
  const anyTourNote = useTourNote()
  const tourNote = useMemo(() => (anyTourNote !== null && data.verses.some(v => v.notes?.some(n => n.id === anyTourNote)) ? anyTourNote : null), [anyTourNote, data])
  const visible = useMemo(() => {
    const s = new Set<number>()
    if (!prefs.showNotes) return s
    for (const v of verses) {
      // one note printed at several words of a verse (its letter at each) opens once when every note is shown
      const seen = new Set<string>()
      for (const n of v.notes ?? []) {
        const again = seen.has(n.marker + '\u0000' + (n.text ?? ''))
        seen.add(n.marker + '\u0000' + (n.text ?? ''))
        if (openNotes.has(n.id) || (allNotes && isLettered(n) && !again) || n.id === tourNote) s.add(n.id)
      }
    }
    return s
  }, [verses, openNotes, allNotes, prefs.showNotes, tourNote])
  const notes = useSetPresence(visible, data, reduce)
  const shownNotes = useMemo(() => notes.leaving.size ? new Set([...visible, ...notes.leaving]) : visible, [visible, notes.leaving])

  const numeralSize = Math.round(Math.max(64, fs * 3.6))
  const paraNodes = useRef<Map<number, View>>(new Map())
  const getParaNode = useCallback((i: number) => paraNodes.current.get(i) ?? null, [])
  const registerPara = useCallback((i: number, el: View) => { paraNodes.current.set(i, el) }, [])
  // The web reports a paragraph only when its size changes (a ResizeObserver), so one that grows (its footnotes
  // open) leaves every paragraph below it with a stale `y`: where a verse is, and which is at the top of the view,
  // were then wrong. After any report the others are measured again, once a frame, and the moved ones reported.
  const reported = useRef(new Map<number, ParaLayout>())
  const sweep = useRef(0)
  useEffect(() => () => { if (sweep.current) cancelAnimationFrame(sweep.current) }, [])
  // another chapter or another grouping: every paragraph reports afresh, with its own verses
  useEffect(() => { reported.current.clear() }, [paras])
  const reportPara = useCallback((l: ParaLayout) => {
    onParaLayout(l)
    if (Platform.OS !== 'web') return
    reported.current.set(l.index, l)
    if (sweep.current) return
    sweep.current = requestAnimationFrame(() => {
      sweep.current = 0
      for (const [i, was] of reported.current) {
        const el = paraNodes.current.get(i) as unknown as { getBoundingClientRect?: () => { top: number; height: number }; parentElement?: { getBoundingClientRect: () => { top: number } } | null } | undefined
        if (!el?.getBoundingClientRect || !el.parentElement) continue
        const box = el.getBoundingClientRect(), y = box.top - el.parentElement.getBoundingClientRect().top
        if (Math.abs(y - was.y) < 0.5 && Math.abs(box.height - was.height) < 0.5) continue
        const now = { ...was, y, height: box.height }
        reported.current.set(i, now)
        onParaLayout(now)
      }
    })
  }, [onParaLayout])
  const noteContext = useMemo(() => ({ book: data.book, chapter: data.c }), [data.book, data.c])
  const maxWidth = READ_EM[prefs.width] ? Math.round(fs * READ_EM[prefs.width]! * (pair ? 2 : 1)) + (pair ? 64 : 40) : undefined
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, width: '100%', maxWidth, alignSelf: ALIGN_SELF[prefs.align] }}>
      <Heading name={meta.name} chapter={data.nc ?? ownChapter(data.verses[0] ?? { v: 1, t: '' }, data.c)} isRead={isRead} marked={marked} font={prefs.font} dys={dys} numeralSize={numeralSize} />
      {data.title ? <InkText ink="muted" style={{ textAlign: 'center', fontSize: Math.round(fs * 0.9), lineHeight: Math.round(fs * 0.9 * 1.45), marginBottom: 18, paddingHorizontal: 8, ...face(prefs.font, { italic: true }) }}>{data.title}</InkText> : null}
      {paras.map((pv, i) => {
        const own = ownChapter(pv[0], data.c), before = i ? paras[i - 1][paras[i - 1].length - 1] : null
        return (
          <Paragraph key={i} index={i} register={registerPara} onParaLayout={reportPara} onVerseLayout={onVerseLayout} getParaNode={getParaNode} spoken={spoken}
            verses={pv} book={data.book} chapter={data.c} noteContext={noteContext} paraStyle={paraStyle} wordSpacing={letterSpacing + wordSpacing} plainSeps={wordSpacing === 0}
            prefs={prefs} gap={Math.round(lineHeight * 0.55)} turn={before && ownChapter(before, data.c) !== own ? own : 0}
            second={second ? secondBy.get(pv[0].v) ?? null : undefined} pair={pair}
            selected={selected} flash={flash} highlights={highlights} bookmarked={bookmarked} shownNotes={shownNotes} leaving={notes.leaving} delays={notes.delays} onExited={notes.exited} pinned={allNotes}
            wordTags={wordTags} tapWords={tapWords} onWord={onWord} onSelect={onSelect} onToggleNote={onToggleNote} onNavigate={onNavigate}
            tourNote={tourNote !== null && pv.some(v => v.notes?.some(n => n.id === tourNote)) ? tourNote : null} />
        )
      })}
    </View>
  )
})

/**
 * 0 while `on` is false, 1 while true: already there when the chapter opens with it, springing in or out (`POP_SPRING`)
 * when it changes while the chapter is open, at once under Reduce animation.
 */
function useMark(on: boolean): Animated.Value {
  const store = usePrefsStore()
  const v = useRef(new Animated.Value(on ? 1 : 0)).current
  const was = useRef(on)
  useEffect(() => {
    if (on === was.current) return
    was.current = on
    if (store.get().reduceMotion) { v.setValue(on ? 1 : 0); return }
    const a = Animated.spring(v, { toValue: on ? 1 : 0, ...POP_SPRING, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [on, v, store])
  return v
}

/** A heading mark: in with the heading's last phase (`fade`), then shown or hidden by its `useMark` value. */
const settled = (fade: Animated.AnimatedInterpolation<number>, m: Animated.Value, from: number) => ({
  opacity: Animated.multiply(fade, m.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' })),
  transform: [{ scale: m.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }],
})

/**
 * Book in italic, then the rubric numeral, then the read mark: the reading screen's one orchestrated entrance, per
 * chapter. A bookmarked chapter carries a small ribbon at the numeral's shoulder.
 */
const Heading = memo(function Heading({ name, chapter, isRead, marked, font, dys, numeralSize }: { name: string; chapter: number; isRead: boolean; marked: boolean; font: Prefs['font']; dys: boolean; numeralSize: number }) {
  const colors = usePageInks()
  const v = useEntrance()
  // built once per mount: fresh interpolation nodes on each render would re-attach to the running native animation
  const anim = useMemo(() => ({
    name: { opacity: phase(v, 0, 0.55), transform: [{ translateY: phase(v, 0, 0.55, [-6, 0]) }] },
    numeral: { opacity: phase(v, 0.15, 0.7), transform: [{ translateY: phase(v, 0.15, 0.8, [10, 0]) }, { scale: phase(v, 0.15, 0.8, [0.92, 1]) }] },
    read: { opacity: phase(v, 0.55, 1) },
  }), [v])
  // credited or bookmarked while open: the mark settles in where it goes (it takes no room, so nothing below moves)
  const flip = useMark(isRead), ribbon = useMark(marked)
  const readMark = useMemo(() => settled(anim.read.opacity, flip, 0.8), [anim, flip])
  const ribbonMark = useMemo(() => settled(anim.read.opacity, ribbon, 0.6), [anim, ribbon])
  const ribbonSize = Math.round(numeralSize * 0.26)
  const label = isRead && marked ? t('{book} chapter {chapter}, read, bookmarked', { book: name, chapter })
    : isRead ? t('{book} chapter {chapter}, read', { book: name, chapter })
    : marked ? t('{book} chapter {chapter}, bookmarked', { book: name, chapter })
    : t('{book} chapter {chapter}', { book: name, chapter })
  return (
    <View style={{ alignItems: 'center', marginTop: 20, marginBottom: 22 }} accessibilityRole="header" accessibilityLabel={label}>
      <View>
        <Animated.Text style={[{ color: colors.muted, fontSize: 17, ...face(font, { italic: true }) }, anim.name]}>{name}</Animated.Text>
        <Animated.View pointerEvents="none" style={[styles.read, { backgroundColor: colors.accentSoft }, readMark]}>
          <Icon name="check" size={13} color={colors.accent} />
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600' }}>{tc('done', 'Read')}</Text>
        </Animated.View>
      </View>
      <Animated.View style={anim.numeral}>
        <Text style={{ color: colors.accent, fontSize: numeralSize, lineHeight: Math.round(numeralSize * 1.08), letterSpacing: -numeralSize * 0.02, ...face(dys ? 'dyslexic' : 'serif', { bold: true }) }}>{chapter}</Text>
        <Animated.View pointerEvents="none" style={[styles.ribbon, { top: Math.round(numeralSize * 0.2), marginLeft: Math.round(numeralSize * 0.04) }, ribbonMark]}>
          <Icon name="bookmark" fill size={ribbonSize} color={colors.accent} />
        </Animated.View>
      </Animated.View>
    </View>
  )
})

interface ParaProps {
  index: number; register: (i: number, el: View) => void; onParaLayout: (l: ParaLayout) => void
  onVerseLayout?: (v: number, paraIndex: number, y: number) => void; getParaNode: (i: number) => View | null; spoken: { v: number; off: number | null } | null
  verses: Verse[]; book: number; chapter: number; noteContext: { book: number; chapter: number }
  paraStyle: object; wordSpacing: number; plainSeps: boolean; prefs: ReadingPrefs; gap: number
  selected: ReadonlySet<number>; flash: ReadonlySet<number>; highlights: ReadonlyMap<number, string>; bookmarked: ReadonlySet<number>
  /** Notes to render open (visible ∪ leaving); `leaving` ones are collapsing, `delays` stagger a batch of arrivals. */
  shownNotes: ReadonlySet<number>; leaving: ReadonlySet<number>; delays: ReadonlyMap<number, number>; onExited: (id: number) => void
  /** every lettered note is held open by the toolbar's † toggle: their cards show no close button, a tap on it would do nothing */
  pinned: boolean
  wordTags: WordTags | null; tapWords: boolean; onWord?: (code: string, word: string) => void
  onSelect: (v: number) => void; onToggleNote: (id: number) => void; onNavigate?: (r: Ref) => void
  /** The note the guided tour has opened, when it is in this paragraph: its text and card are what the tour points at. */
  tourNote: number | null
  /** The printed chapter of the Bible shown that begins here, inside the English one (0: none). */
  turn: number
  /** Side by side: the second Bible's verse for this one (null: it has none here), beside it when `pair`. */
  second?: Verse | null
  pair: boolean
}
/** Chapter-wide collections: a new instance re-renders only the paragraphs whose own verses or notes read differently from it. */
const SLICED: ReadonlySet<string> = new Set<keyof ParaProps>(['selected', 'flash', 'highlights', 'bookmarked', 'spoken', 'shownNotes', 'leaving', 'delays'])
const spokenAt = (s: ParaProps['spoken'], v: number) => s && s.v === v ? s.off : undefined
function sameParagraph(a: ParaProps, b: ParaProps): boolean {
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  let sliced = false
  for (const k of kb) {
    if (a[k as keyof ParaProps] === b[k as keyof ParaProps]) continue
    if (!SLICED.has(k)) return false
    sliced = true
  }
  if (!sliced) return true
  for (const v of b.verses) {
    const id = verseId(b.book, b.chapter, v.v)
    if (a.selected.has(v.v) !== b.selected.has(v.v) || a.flash.has(v.v) !== b.flash.has(v.v) || a.bookmarked.has(v.v) !== b.bookmarked.has(v.v)
      || a.highlights.get(id) !== b.highlights.get(id) || spokenAt(a.spoken, v.v) !== spokenAt(b.spoken, v.v)) return false
    for (const n of v.notes ?? []) {
      if (a.shownNotes.has(n.id) !== b.shownNotes.has(n.id) || a.leaving.has(n.id) !== b.leaving.has(n.id) || a.delays.get(n.id) !== b.delays.get(n.id)) return false
    }
  }
  return true
}
/**
 * One paragraph = one Text, split wherever a verse has an expanded footnote so the note sits right under it.
 * Runs and notes are flat siblings keyed by first verse / note id, so opening one note never remounts another.
 */
const Paragraph = memo(function Paragraph({ index, register, onParaLayout, onVerseLayout, getParaNode, spoken, verses, book, chapter, noteContext, paraStyle, wordSpacing, plainSeps, prefs, gap, selected, flash, highlights, bookmarked, shownNotes, leaving, delays, onExited, pinned, wordTags, tapWords, onWord, onSelect, onToggleNote, onNavigate, tourNote, turn, second, pair }: ParaProps) {
  const firstVerse = verses[0].v, lastVerse = verses[verses.length - 1].v
  const ref = useCallback((el: View | null) => { if (el) register(index, el) }, [register, index])
  const onLayout = useCallback((e: LayoutChangeEvent) => onParaLayout({ index, y: e.nativeEvent.layout.y, height: e.nativeEvent.layout.height, firstVerse, lastVerse }), [onParaLayout, index, firstVerse, lastVerse])
  const runs: { verses: Verse[]; notes: Note[] }[] = [{ verses: [], notes: [] }]
  for (const v of verses) {
    runs[runs.length - 1].verses.push(v)
    const open = prefs.showNotes ? (v.notes ?? []).filter(n => shownNotes.has(n.id)) : []
    if (open.length) { runs[runs.length - 1].notes = open; runs.push({ verses: [], notes: [] }) }
  }
  const italicStyle = useMemo(() => face(prefs.font, { italic: true }), [prefs.font])
  const runStyle = [paraStyle, { marginBottom: prefs.paragraphs ? gap : 6, textAlign: 'left' as const }]
  // Native verse positions come from the text layout: the line that holds the verse number (or its first word when
  // numbers are off), plus the run's offset in the paragraph. A zero-size view inside Text never reports a
  // measurement on Android, so the marker path in VerseSpan is web only.
  const runYs = useRef<number[]>([]); const runLines = useRef<TextLayoutEventData['lines'][]>([])
  // side by side on a wide screen the runs sit in a row below the paragraph's headings: their y is from the row
  const rowY = useRef(0)
  const reportRun = useCallback((ri: number, rv: Verse[]) => {
    const y0 = runYs.current[ri] === undefined ? undefined : runYs.current[ri] + (pair ? rowY.current : 0), lines = runLines.current[ri]
    if (y0 === undefined || !lines || !onVerseLayout) return
    const starts: number[] = []; let joined = ''
    for (const l of lines) { starts.push(joined.length); joined += l.text }
    let from = 0
    for (const v of rv) {
      const key = prefs.verseNumbers ? verseLabel(v) : (v.t.trim().split(/\s+/)[0] ?? '')
      if (!key) continue
      let idx = joined.indexOf(key, from)
      while (idx > 0 && prefs.verseNumbers && /\d/.test(joined[idx - 1])) idx = joined.indexOf(key, idx + 1)
      if (idx < 0) continue
      let li = 0; for (let i = 0; i < starts.length; i++) if (starts[i] <= idx) li = i
      onVerseLayout(v.v, index, y0 + lines[li].y)
      from = idx + key.length
    }
  }, [onVerseLayout, index, prefs.verseNumbers, pair])
  const nativeMeasure = Platform.OS !== 'web' && !!onVerseLayout
  // the tour points at a note it has opened, with the text that holds its letter
  const body = runs.flatMap((r, ri) => r.verses.length === 0 ? [] : [
          <InkText key={'t' + r.verses[0].v} ink="text" style={runStyle} ref={tourNote !== null && r.notes.some(n => n.id === tourNote) ? tourRef('reader-note-run') : undefined}
            onLayout={nativeMeasure ? (e: LayoutChangeEvent) => { runYs.current[ri] = e.nativeEvent.layout.y; reportRun(ri, r.verses) } : undefined}
            onTextLayout={nativeMeasure ? (e: NativeSyntheticEvent<TextLayoutEventData>) => { runLines.current[ri] = e.nativeEvent.lines; reportRun(ri, r.verses) } : undefined}>
            {r.verses.map(v => v.m ? null : (
              <VerseSpan key={v.v} verse={v} fontSize={prefs.fontSize} font={prefs.font} wordSpacing={wordSpacing} plainSeps={plainSeps}
                selected={selected.has(v.v)} flashed={flash.has(v.v)} hl={highlights.get(verseId(book, chapter, v.v))} bookmarked={bookmarked.has(v.v)}
                showNumbers={prefs.verseNumbers} showNotes={prefs.showNotes} tags={wordTags ? wordTags.get(v.v) ?? NO_TAGS : null} tapWords={tapWords} onWord={onWord}
                reduce={prefs.reduceMotion} onSelect={onSelect} onToggleNote={onToggleNote} paraIndex={index} onVerseLayout={onVerseLayout} getParaNode={getParaNode} spokenOff={spokenAt(spoken, v.v)} />
            ))}
          </InkText>,
          ...r.notes.map(n => (
            <Reveal key={'n' + n.id} delay={delays.get(n.id)} closing={leaving.has(n.id)} onExited={() => onExited(n.id)} reduce={prefs.reduceMotion} style={styles.noteSlot}>
              <NoteCard note={n} tour={n.id === tourNote} font={prefs.font} italicStyle={italicStyle} context={noteContext} onNavigate={onNavigate} onClose={pinned && isLettered(n) ? undefined : onToggleNote} />
            </Reveal>
          )),
      ])
  const other = second === undefined ? null
    : <SecondVerse verse={second} chapter={chapter} fontSize={prefs.fontSize} font={prefs.font} pair={pair} onPress={() => onSelect(verses[0].v)} />
  return (
    <View ref={ref} onLayout={onLayout}>
      {turn ? <InkText ink="accent" accessibilityRole="header" style={{ textAlign: 'center', fontSize: Math.round(prefs.fontSize * 0.9), marginTop: 18, marginBottom: 10, ...sansBold }}>{t('Chapter {n}', { n: turn })}</InkText> : null}
      {verses[0].hd ? <InkText ink="muted" style={{ textAlign: 'center', fontSize: Math.round(prefs.fontSize * 0.85), marginTop: 18, marginBottom: 8, ...face(prefs.font, { italic: true }) }}>{verses[0].hd}</InkText> : null}
      {pair
        ? <View style={styles.pair} onLayout={(e: LayoutChangeEvent) => { rowY.current = e.nativeEvent.layout.y }}><View style={{ flex: 1 }}>{body}</View>{other}</View>
        : <>{body}{other}</>}
    </View>
  )
}, sameParagraph)

/**
 * The second Bible's verse side by side (docs/LANGUAGES.md): read-only, quieter than the first, its own printed number
 * (with its chapter where that is not the English one). A tap on it selects the verse it stands with.
 */
const SecondVerse = memo(function SecondVerse({ verse: v, chapter, fontSize, font, pair, onPress }: { verse: Verse | null; chapter: number; fontSize: number; font: Prefs['font']; pair: boolean; onPress: () => void }) {
  if (!v || v.m || !v.t) return pair ? <View style={{ flex: 1 }} /> : null
  const size = pair ? fontSize : Math.round(fontSize * 0.88)
  const italic = face(font, { italic: true })
  const parts = (v.h ?? v.t).split(/(<i>|<\/i>)/)
  let on = false
  return (
    <InkText ink="muted" onPress={onPress} style={{ flex: pair ? 1 : undefined, fontSize: size, lineHeight: Math.round(size * 1.5), marginBottom: pair ? 6 : 12, marginLeft: pair ? 0 : 14, ...face(font) }}>
      <InkText ink="accent" style={{ fontSize: size * 0.58, ...sansBold, ...inlineMark(size * 0.58) }}>{v.nc && v.nc !== chapter ? `${v.nc}:${verseLabel(v)}` : verseLabel(v)} </InkText>
      {parts.map((p, i) => {
        if (p === '<i>') { on = true; return null }
        if (p === '</i>') { on = false; return null }
        return p ? <Text key={i} style={on ? italic : undefined}>{p.replace(/<[^>]+>/g, '')}</Text> : null
      })}
    </InkText>
  )
})

/** An open footnote under its verse. */
const NoteCard = memo(function NoteCard({ note: n, tour, font, italicStyle, context, onNavigate, onClose }: { note: Note; tour: boolean; font: Prefs['font']; italicStyle: TextStyle; context: { book: number; chapter: number }; onNavigate?: (r: Ref) => void; onClose?: (id: number) => void }) {
  const colors = usePageInks()
  return (
    <View ref={tour ? tourRef('reader-note-card') : undefined} style={[styles.note, { backgroundColor: colors.card }]}>
      <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22, flex: 1, ...face(font) }}>
        <Text style={{ color: colors.accent, ...face('sans', { bold: true }) }}>{n.marker}  </Text>
        <FootnoteText text={n.text} italicStyle={italicStyle} context={context} onNavigate={onNavigate} />
      </Text>
      {onClose ? <Tap onPress={() => onClose(n.id)} hitSlop={10} scaleTo={0.8} accessibilityRole="button" accessibilityLabel={t('Close note')} style={styles.noteClose}><Icon name="x" size={16} color={colors.muted} /></Tap> : null}
    </View>
  )
})

interface VerseProps {
  verse: Verse; fontSize: number; font: Prefs['font']; wordSpacing: number
  /** No extra word spacing: separators render exactly like the words around them, so they share one string. */
  plainSeps: boolean
  selected: boolean; flashed: boolean; hl: string | undefined; bookmarked: boolean; showNumbers: boolean; showNotes: boolean; reduce: boolean
  /** Word-mode tags for this verse; null when word mode is off. */
  tags: [string, string][] | null
  /** Every word answers a tap (dictionary lookup), not only the tagged ones. */
  tapWords: boolean
  onWord?: (code: string, word: string) => void
  onSelect: (v: number) => void; onToggleNote: (id: number) => void
  paraIndex: number; onVerseLayout?: (v: number, paraIndex: number, y: number) => void; getParaNode: (i: number) => View | null
  /** Char offset of the word being read aloud in this verse; null = this verse but no word; undefined = not this verse. */
  spokenOff?: number | null
}
type RunClass = 'plain' | 'italic' | 'sep'
const VerseSpan = memo(function VerseSpan({ verse: v, fontSize, font, wordSpacing, plainSeps, selected, flashed, hl, bookmarked, showNumbers, showNotes, tags, tapWords, onWord, reduce, onSelect, onToggleNote, paraIndex, onVerseLayout, getParaNode, spokenOff }: VerseProps) {
  const spokenWi = spokenOff === null || spokenOff === undefined ? -1 : wordIndexAt(v, spokenOff)
  const markRef = useRef<View>(null)
  // the marker's own layout is relative to the verse span (0 on web); measure against the paragraph instead
  const reportMark = useCallback(() => {
    const para = getParaNode(paraIndex)
    if (!para || !markRef.current || !onVerseLayout) return
    markRef.current.measureLayout(para, (_x, y) => onVerseLayout(v.v, paraIndex, y), () => {})
  }, [getParaNode, paraIndex, onVerseLayout, v.v])
  const press = useCallback(() => onSelect(v.v), [onSelect, v.v])
  const toks = tokenize(v)
  const wordCount = useMemo(() => toks.filter(t => t.word).length, [toks])
  const notesAt = useMemo(() => {
    const m = new Map<number, Note[]>()
    if (showNotes) for (const n of v.notes ?? []) { const k = Math.min(n.pos ?? wordCount, wordCount); m.set(k, [...(m.get(k) ?? []), n]) }
    return m
  }, [v, showNotes, wordCount])
  // the tint is a real colour (it is tweened), subscribed per verse: an untinted verse never re-renders for a theme
  const tint: 'selected' | HlColor | null = selected || flashed ? 'selected' : hl ? hlKey(hl) : null
  const target = useThemeSelect(t => tint === null ? undefined : tint === 'selected' ? t.selected : t.hl[tint])
  // a nested span cannot carry an Animated node, so only this verse re-renders while its tint eases
  // Android: a selection tap changes colour at once; the per-frame JS tween made a run of quick taps drop
  const bg = useColorTransition(target, reduce || (Platform.OS === 'android' && !flashed), selected || flashed, tint)
  // The words do not depend on selection or tint, so a tap or a tween frame re-renders only the outer span.
  // A word with no note, tag or spoken highlight joins its plain neighbours in one string: a Text per word
  // cost a fibre and a native span each (several thousand per chapter), on every mount and theme change.
  // Dictionary lookup (`tapWords`) pays that cost on purpose, once per chapter: it is a mode the reader turns on.
  const body = useMemo(() => {
    const italicFace = face(font, { italic: true })
    // A note's `pos` is the word it precedes. Lettered notes explain the word BEFORE that point, so their letter sits
    // at the end of that word ("anewʰ he"); the divine-name symbols (·, †) mark the word after and stay in front.
    const markStyle = { fontSize: fontSize * 0.62, ...sansBold, ...inlineMark(fontSize * 0.62) }
    const marker = (n: Note) => (
      <InkText key={'n' + n.id} ink="accent" onPress={() => onToggleNote(n.id)} style={markStyle} accessibilityRole="button" accessibilityLabel={t('Note {marker}', { marker: n.marker })}>{n.marker}</InkText>
    )
    const before = (k: number) => (notesAt.get(k) ?? []).filter(n => !isLettered(n)).map(marker)
    const after = (k: number) => (notesAt.get(k) ?? []).filter(isLettered).map(marker)
    const out: ReactNode[] = after(0)
    if (v.t === '') {
      out.push(<InkText key="omitted" ink="muted" style={italicFace}>{t('[omitted]')}</InkText>)
    } else {
      // Android draws no dotted decoration, so tagged words fall back to a plain underline there
      const tagged = { textDecorationLine: 'underline' as const, textDecorationStyle: Platform.OS === 'android' ? 'solid' as const : 'dotted' as const }
      const sepStyle = { letterSpacing: wordSpacing }
      // separators were never italic, so an italic run is one word and the spaces around it stay upright
      let run = '', runClass: RunClass | null = null, runKey = 0
      const flush = () => {
        if (!run) return
        out.push(runClass === 'plain' ? run : <Text key={`${runClass}${runKey}`} style={runClass === 'italic' ? italicFace : sepStyle}>{run}</Text>)
        run = ''
      }
      toks.forEach((t, i) => {
        let cls: RunClass
        if (!t.word) cls = plainSeps ? 'plain' : 'sep'
        else {
          const code = tags?.[t.wi]?.[1]
          const first = code ? code.split(',')[0] : ''
          // the word opens the lookup sheet: a tagged one always; in dictionary lookup any word that could name an
          // article (function words never do, so they stay plain text and a tap on them still selects the verse)
          const lookup = !!onWord && (!!first || (tapWords && isLookupWord(t.tok)))
          const preNotes = (notesAt.get(t.wi) ?? []).filter(n => !isLettered(n)), postNotes = (notesAt.get(t.wi + 1) ?? []).filter(isLettered)
          if (lookup && !first && t.wi !== spokenWi && !preNotes.length && !postNotes.length) {
            // the common case in dictionary lookup: one span, no wrapper; the whole word ("Ænon") is joined at tap time
            flush(); runClass = null
            out.push(<Text key={i} style={t.italic ? italicFace : undefined} onPress={() => onWord!('', wholeWord(toks, i))}>{t.tok}</Text>)
            return
          }
          const pre = preNotes.map(marker), post = postNotes.map(marker)
          if (first || t.wi === spokenWi || pre.length || post.length) {
            flush(); runClass = null
            const spokenHere = t.wi === spokenWi
            const wordStyle = [t.italic ? italicFace : null, first ? tagged : null, spokenHere ? SPOKEN : null]
            const paint = { ink: spokenHere ? 'accentText' as const : undefined, bg: spokenHere ? 'accent' as const : undefined, line: first ? 'muted' as const : undefined }
            // the marker is tiny to look at, so the word it belongs to is the tap target for its note (word mode wins)
            const note = !lookup ? (preNotes[0] ?? postNotes[0]) : undefined
            // U+2060 word joiner: no line may break between a marker and its word ("· God", "anewʰ")
            out.push(
              <Text key={i} onPress={note ? () => onToggleNote(note.id) : undefined} accessibilityRole={note ? 'button' : undefined} accessibilityLabel={note ? noteWordLabel(t.tok, note.marker) : undefined}>
                {pre}{pre.length ? '\u2060' : null}
                {lookup && first
                  ? <InkText {...paint} style={wordStyle} onPress={() => onWord!(first, t.tok)} accessibilityRole="button" accessibilityLabel={strongsLabel(t.tok, first)}>{t.tok}</InkText>
                  : lookup ? <InkText {...paint} style={wordStyle} onPress={() => onWord!('', wholeWord(toks, i))}>{t.tok}</InkText>
                  : <InkText {...paint} style={wordStyle}>{t.tok}</InkText>}
                {post.length ? '\u2060' : null}{post}
              </Text>,
            )
            return
          }
          cls = t.italic ? 'italic' : 'plain'
        }
        if (cls !== runClass) { flush(); runClass = cls; runKey = i }
        run += t.tok
      })
      flush()
    }
    out.push(...before(wordCount))
    return out
  }, [v, toks, wordCount, notesAt, tags, tapWords, spokenWi, plainSeps, wordSpacing, font, fontSize, onWord, onToggleNote])
  return (
    <Text onPress={press} style={{ backgroundColor: bg, textDecorationLine: selected ? 'underline' : 'none' }} accessibilityRole="text">
      {onVerseLayout && Platform.OS === 'web' ? <View ref={markRef} style={MARK} onLayout={reportMark} /> : null}
      {v.s ? <InkText ink="muted" style={{ fontSize: fontSize * 0.7 }}>✦ </InkText> : null}
      {showNumbers ? <InkText ink="accent" style={{ fontSize: fontSize * 0.58, ...sansBold, ...inlineMark(fontSize * 0.58) }}>{verseLabel(v)}{bookmarked ? '▮' : ''} </InkText> : null}
      {body}
      {' '}
    </Text>
  )
})

// out here because the word loop above names its token `t`
const noteWordLabel = (word: string, marker: string) => t('{word}, note {marker}', { word, marker })
const strongsLabel = (word: string, code: string) => t('{word}, Strong’s {code}', { word, code })
const sansBold = face('sans', { bold: true })
const SPOKEN = { borderRadius: 3 }
/** Zero-size inline view whose layout gives the verse's y within its paragraph (nested text cannot be measured). */
const MARK = { width: 0, height: 0 } as const
/** Web only: a small sans span inside serif text keeps its own line box tight, or its different ascent pushes the line open. */
const inlineMark = (size: number) => Platform.OS === 'web' ? { lineHeight: Math.round(size) } : null
const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 24, alignItems: 'flex-start' },
  noteSlot: { marginTop: -2 },
  read: { position: 'absolute', left: '100%', marginLeft: 10, top: '50%', marginTop: -11, height: 22, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 11, paddingHorizontal: 8 },
  ribbon: { position: 'absolute', left: '100%' },
  noteClose: { paddingTop: 3, alignSelf: 'flex-start' },
  note: { flexDirection: 'row', gap: 10, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginLeft: 10, marginBottom: 14 },
})
