import { createRef, memo, useCallback, useMemo, useRef, type RefObject } from 'react'
import { Animated, Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { paragraphsOf, type WorkKind } from '@shared/companion'
import type { MinistrySection, MinistrySectionMeta } from '@shared/ministry'
import type { Ref, RefHome } from '@shared/ref'
import type { WordTap } from '@shared/wordTap'
import { CompanionHeading, CompanionText } from './CompanionReading'
import Figures, { PageScrollCtx, type PageScroll } from './Figures'
import { rowCount } from '@shared/figures'
import { Button, ErrorText, Spinner, T } from './ui'
import { InkPage } from '../hooks/useTheme'
import { tourRef } from '../store/tour'

/** Kept per section, so a page laid out offscreen arrives measured: where its text starts, where each paragraph starts
 *  inside the text, and the content's height. */
export interface LibraryLayout {
  textY: number
  tops: (number | undefined)[]
  height: number
  onText: (y: number) => void
  onPara: (i: number, y: number) => void
  onSize: (w: number, h: number) => void
}

export interface LibraryPlace { author: string; work: { id: string; title: string; kind: WorkKind }; section: MinistrySectionMeta }

interface Props {
  place: LibraryPlace | null
  /** The heading's small line: collection, volume, part. */
  line: string
  section: MinistrySection | null | undefined
  home?: RefHome
  unavailable: string
  size: number
  lineHeight: number
  maxWidth?: number
  alignSelf: 'flex-start' | 'center' | 'flex-end'
  /** The wash on the paragraph the reader was opened at (-1: none). */
  wash: number
  prevLabel: string | null
  nextLabel: string | null
  source: string
  layout: LibraryLayout
  padBottom: number
  go: (dir: 1 | -1) => void
  onRef: (r: Ref) => void
  scrollRef?: RefObject<ScrollView | null>
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  onViewport?: (e: LayoutChangeEvent) => void
  /** A neighbour in the pager: a new theme reaches its text after the visible page has painted. */
  offscreen?: boolean
  /** Word lookup is on: a tap on a word of the prose. */
  onWord?: (t: WordTap) => void
}

/**
 * One section of a work in its own scroll view, the unit SwipePager carries (ReaderPage's counterpart): the heading,
 * the text in the reader's font and size (a long section simply scrolls, as a chapter does), the previous and next
 * sections as buttons for whoever does not swipe, and the credit. Memoised: the pages either side get stable props.
 */
/** Native pages scroll through Animated (a harmony's header rides the offset); the web's header is CSS sticky. */
const Scroller = (Platform.OS === 'web' ? ScrollView : Animated.ScrollView) as typeof ScrollView

export default memo(function LibraryPage({ place, line, section, home, unavailable, size, lineHeight, maxWidth, alignSelf, wash, prevLabel, nextLabel, source, layout, padBottom, go, onRef, scrollRef, onScroll, onViewport, offscreen = false, onWord }: Props) {
  // a harmony's header holds at the top of the page: on native it follows the offset on the UI thread, so this page
  // reports every frame while it has one
  const sticky = Platform.OS !== 'web' && !!section?.figures?.some(f => f.kind === 'parallels')
  const scroll = useMemo<PageScroll>(() => ({ y: new Animated.Value(0), content: createRef<View>(), resized: new Set() }), [])
  const onPageScroll = useMemo(() => sticky
    ? Animated.event([{ nativeEvent: { contentOffset: { y: scroll.y } } }], { useNativeDriver: true, listener: onScroll }) as unknown as typeof onScroll
    : onScroll, [sticky, scroll, onScroll])
  const onSize = useCallback((w: number, h: number) => { layout.onSize(w, h); for (const f of scroll.resized) f() }, [layout, scroll])
  return (
    // the drag and momentum ends report the resting offset too: the edge pull needs to know the text has reached an end
    <Scroller ref={scrollRef} onScroll={onPageScroll} onScrollEndDrag={onScroll} onMomentumScrollEnd={onScroll} scrollEventThrottle={sticky ? 16 : 100}
      contentContainerStyle={{ paddingBottom: padBottom }} onContentSizeChange={onSize} onLayout={onViewport}>
      <PageScrollCtx.Provider value={sticky ? scroll : null}>
      <View ref={scroll.content} style={[styles.column, { maxWidth, alignSelf }]}>
        <InkPage offscreen={offscreen}>
          {place ? <View ref={offscreen ? undefined : tourRef('library-heading')}><CompanionHeading place={place} line={line} size={Math.round(size * 1.25)} onPassage={onRef} /></View> : null}
          <View onLayout={e => layout.onText(e.nativeEvent.layout.y)} style={{ minHeight: 120 }}>
            {section === undefined ? <Spinner /> : section === null ? <ErrorText>{unavailable}</ErrorText>
              : section.figures?.length ? <WithFigures section={section} home={home} onRef={onRef} layout={layout} wash={wash} size={size} line={lineHeight} onWord={onWord} />
                : <CompanionText section={section} home={home} onRef={onRef} onPara={layout.onPara} wash={wash} size={size} line={lineHeight} onWord={onWord} />}
          </View>
        </InkPage>
        <T small muted>{source}</T>
      </View>
      </PageScrollCtx.Provider>
      <View style={styles.nav}>
        {prevLabel ? <Button title={`← ${prevLabel}`} accessibilityLabel={`Previous: ${prevLabel}`} onPress={() => go(-1)} style={styles.navButton} /> : <View />}
        {nextLabel ? <Button title={`${nextLabel} →`} accessibilityLabel={`Next: ${nextLabel}`} onPress={() => go(1)} style={styles.navButton} /> : <View />}
      </View>
    </Scroller>
  )
})

/**
 * A section whose page prints figures beside its text: the paragraphs in runs, each figure after the paragraph it
 * follows (shared/figures.ts `after`; the end where it has none). Each run reports its paragraphs' places measured from
 * the top of the text, as one CompanionText would, so landing on a paragraph still finds it; the figures' rows report
 * theirs as slots after the paragraphs, so a link to a row of a table lands on it the same way and washes it.
 */
function WithFigures({ section, home, onRef, layout, wash, size, line, onWord }: { section: MinistrySection; home?: RefHome; onRef: (r: Ref) => void; layout: LibraryLayout; wash: number; size: number; line: number; onWord?: (t: WordTap) => void }) {
  const figures = section.figures!
  const runs = useMemo(() => {
    const n = paragraphsOf(section.text).length
    const at = (a: number | undefined) => Math.max(-1, Math.min(a ?? n - 1, n - 1))
    const stops = [...new Set(figures.map(f => at(f.after)))].sort((a, b) => a - b)
    // each run's figures take their rows' slots after the paragraphs, in the section's order of figures
    let slot = n
    return [...stops.map((stop, k) => {
      const figs = figures.filter(f => at(f.after) === stop)
      const base = slot
      slot += figs.reduce((m, f) => m + rowCount(f), 0)
      return { from: k ? stops[k - 1] + 1 : 0, to: stop + 1, figures: figs, base }
    }), { from: stops[stops.length - 1] + 1, to: n, figures: [], base: slot }].filter(r => r.to > r.from || r.figures.length)
  }, [section.text, figures])
  // flat, so each run's own y is its distance from the text's top
  return (
    <View style={{ gap: Math.round(size * line * 0.55) }}>
      {runs.flatMap((r, k) => [
        r.to > r.from ? <Run key={`t${k}`} section={section} home={home} onRef={onRef} onPara={layout.onPara} wash={wash} size={size} line={line} from={r.from} to={r.to} onWord={onWord} /> : null,
        r.figures.length ? <Figures key={`f${k}`} figures={r.figures} size={size} onRef={onRef} base={r.base} onRow={layout.onPara} wash={wash} /> : null,
      ])}
    </View>
  )
}

/** Paragraphs from..to, their places reported from the top of the text: offset by where the run itself stands (a run
 *  lays out its paragraphs before it learns its own place, so they are reported again then). */
function Run({ onPara, ...p }: { section: MinistrySection; home?: RefHome; onRef: (r: Ref) => void; onPara: (i: number, y: number) => void; wash: number; size: number; line: number; from: number; to: number; onWord?: (t: WordTap) => void }) {
  const top = useRef(0)
  const seen = useRef(new Map<number, number>())
  const report = useCallback((i: number, y: number) => { seen.current.set(i, y); onPara(i, y + top.current) }, [onPara])
  return (
    <View onLayout={e => {
      top.current = e.nativeEvent.layout.y
      for (const [i, y] of seen.current) onPara(i, y + top.current)
    }}>
      <CompanionText {...p} onPara={report} />
    </View>
  )
}

const styles = StyleSheet.create({
  column: { width: '100%', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8, gap: 20 },
  nav: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  navButton: { flexShrink: 1 },
})
