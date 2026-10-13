import { memo, type ComponentProps, type RefObject } from 'react'
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { book as bookMeta, nextChapter, prevChapter, type ChapterData } from '../lib/bible'
import ChapterView, { type ParaLayout } from './ChapterView'
import { Button, ErrorText, Spinner, T, Tap } from './ui'
import { InkPage } from '../hooks/useTheme'
import { tourRef } from '../store/tour'

/** Kept per chapter, so layout measured while a page sat offscreen is still valid once it slides in. */
export interface PageLayout {
  paras: Map<number, ParaLayout>
  /** Verse start inside its paragraph: (paragraph index, y). */
  marks: Map<number, { index: number; y: number }>
  height: number
  onPara: (l: ParaLayout) => void
  onVerse: (v: number, index: number, y: number) => void
  onSize: (w: number, h: number) => void
}

type ChapterProps = Omit<ComponentProps<typeof ChapterView>, 'data' | 'onParaLayout' | 'onVerseLayout'>
interface Props extends ChapterProps {
  book: number; chapter: number
  data: ChapterData | null
  err?: string
  layout: PageLayout
  padBottom: number
  go: (dir: 1 | -1) => void
  /** The screen scrolls, measures and tracks the current page through this; a neighbour's is only scrolled to where
   *  an edge pull will bring it in (the previous chapter at its end). */
  scrollRef?: RefObject<ScrollView | null>
  /** Current page only. */
  onScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  /** Current page only: the reader's finger begins a scroll. */
  onDragStart?: () => void
  onViewport?: (e: LayoutChangeEvent) => void
  /** A neighbour in the pager: a new theme reaches its text after the visible page has painted. */
  offscreen?: boolean
  /** Where `go(1)` lands when not the canonical next chapter (the path's next portion); undefined = canonical. */
  next?: { book: number; chapter: number } | null
  /** The path portion's ministry, offered under the turn buttons and never required ("then, if you like: Darby on Matthew 1"). */
  then?: { label: string; onPress: () => void }
}

/**
 * One chapter in its own scroll view, the unit SwipePager carries. Memoised: a neighbour gets stable props only, so
 * selection, highlights and read-aloud on the current page never render the pages either side of it.
 */
export default memo(function ReaderPage({ book, chapter, data, err, layout, padBottom, go, scrollRef, onScroll, onDragStart, onViewport, offscreen = false, next: nextGiven, then, ...view }: Props) {
  const prev = prevChapter(book, chapter), next = nextGiven === undefined ? nextChapter(book, chapter) : nextGiven
  return (
    // the drag and momentum ends report the resting offset too: the edge pull needs to know the text has reached an end
    <ScrollView ref={scrollRef} onScroll={onScroll} onScrollBeginDrag={onDragStart} onScrollEndDrag={onScroll} onMomentumScrollEnd={onScroll} scrollEventThrottle={100} contentContainerStyle={{ paddingBottom: padBottom }}
      onContentSizeChange={layout.onSize} onLayout={onViewport}>
      {err ? <View style={{ padding: 16 }}><ErrorText>{err}</ErrorText></View> : null}
      {!data && !err ? <Spinner /> : null}
      {data ? <InkPage offscreen={offscreen}><ChapterView data={data} onParaLayout={layout.onPara} onVerseLayout={layout.onVerse} {...view} /></InkPage> : null}
      {/* the chapter's end, where the full tour tells of the pull on to the next */}
      <View ref={offscreen ? undefined : tourRef('reader-end')} style={styles.nav}>
        {prev ? <Button title={`← ${bookMeta(prev.book).abbr} ${prev.chapter}`} onPress={() => go(-1)} /> : <View />}
        {next ? <Button title={`${bookMeta(next.book).abbr} ${next.chapter} →`} onPress={() => go(1)} /> : <View />}
      </View>
      {then ? <Tap onPress={then.onPress} scaleTo={0.98} accessibilityRole="link" style={styles.then}><T small muted>{then.label}</T></Tap> : null}
    </ScrollView>
  )
})

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
  then: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8 },
})
