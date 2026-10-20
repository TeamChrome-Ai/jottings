import { useEffect, useRef, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BOOKS } from '@shared/books'
import { N_, t } from '@shared/i18n'
import { useColors, useInks } from '../hooks/useTheme'
import { bookmarkKey, type BookmarkTarget } from '../lib/bookmarks'
import { PANE_W } from '../lib/layout'
import { waveStep } from '../lib/springs'
import { PopIn, useReduceMotion } from './motion/nav'
import { CONFIRM_MS, Choice, pickerStyles } from './ChapterPicker'
import { SPACE, TYPE, Tap } from './ui'

const PAD = 12
/** Five of these and their 6 px gaps (224) fit the pane's inner width (PANE_W less the padding, 236) with the borders. */
const CELL_W = 40
const TESTAMENTS = [{ testament: 'OT', label: N_('Old Testament') }, { testament: 'NT', label: N_('New Testament') }] as const
const NO_MARKS: ReadonlyMap<string, number> = new Map()

/**
 * The desktop reader's book-and-chapter pane: every book by its full name, grouped by testament, and under the open
 * book its chapters as the picker's grid, the current one filled. A book tap opens its grid in place; a chapter tap
 * goes there through `onPick`, the same call the picker sheet makes. The pane scrolls on its own and keeps its place
 * across chapters; when a page turn crosses into the next book the open grid follows. A long press bookmarks, as in
 * the picker.
 */
export default function BookPane({ book, chapter, readSet, marks = NO_MARKS, onMark, onPick }: { book: number; chapter: number; readSet: ReadonlySet<string>; marks?: ReadonlyMap<string, number>; onMark?: (t: BookmarkTarget) => void; onPick: (b: number, c: number) => void }) {
  const c = useColors()
  const ink = useInks()
  const reduce = useReduceMotion()
  const insets = useSafeAreaInsets()
  const [open, setOpen] = useState(book)
  useEffect(() => { setOpen(book) }, [book])
  const [pickedCh, setPickedCh] = useState<number | null>(null)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current) }, [])
  // a tapped cell shows its fill for CONFIRM_MS before the chapter changes, as in the picker
  const pick = (n: number) => {
    setPickedCh(n)
    const go = () => { onPick(open, n); setPickedCh(null) }
    if (pending.current) clearTimeout(pending.current)
    if (reduce) go(); else pending.current = setTimeout(go, CONFIRM_MS)
  }
  const meta = BOOKS[open - 1]
  const selCh = pickedCh ?? (open === book ? chapter : null)
  const step = waveStep(meta.chapters)
  // on mount the current book comes up near the top; after that the reader's own scrolling stands
  const scroll = useRef<ScrollView>(null)
  const placed = useRef(false)
  const onRow = (n: number, y: number) => {
    if (n !== book || placed.current) return
    placed.current = true
    scroll.current?.scrollTo({ y: Math.max(0, y - 72), animated: false })
  }
  return (
    <ScrollView ref={scroll} style={[styles.pane, { backgroundColor: c.bg, borderRightColor: c.border }]} contentContainerStyle={{ padding: PAD, paddingTop: insets.top + PAD, gap: 2 }} accessibilityLabel={t('Books and chapters')}>
      {TESTAMENTS.map(({ testament, label }) => [
        <Text key={testament} style={[pickerStyles.group, styles.group, { color: c.muted }]}>{t(label)}</Text>,
        ...BOOKS.filter(bk => bk.testament === testament).map(bk => {
          const current = bk.n === book, shown = bk.n === open
          const marked = marks.has(bookmarkKey({ book: bk.n }))
          return (
            <View key={bk.n} onLayout={e => onRow(bk.n, e.nativeEvent.layout.y)}>
              <Tap onPress={() => setOpen(bk.n)} onLongPress={onMark ? () => onMark({ book: bk.n }) : undefined} scaleTo={0.98} accessibilityRole="button" aria-label={bk.name} aria-selected={current}
                accessibilityHint={onMark ? marked ? t('Hold to remove the bookmark') : t('Hold to bookmark') : undefined}
                style={[styles.row, { backgroundColor: shown ? ink.card : 'transparent' }]}>
                <Text numberOfLines={1} style={[styles.name, { color: current ? c.accent : c.text, fontWeight: current ? '700' : '400' }]}>{bk.name}</Text>
                {marked ? <View style={[styles.mark, { backgroundColor: c.accent }]} /> : null}
              </Tap>
              {shown ? (
                // keyed by the book: a newly opened grid pops in as one wave, the picker's
                <View key={open} style={[pickerStyles.wrap, styles.grid]}>
                  {Array.from({ length: meta.chapters }, (_, i) => i + 1).map((n, i) => {
                    const chMarked = marks.has(bookmarkKey({ book: open, chapter: n }))
                    return (
                      <PopIn key={n} index={i} cap={Infinity} step={step}>
                        <Choice label={String(n)} name={`${meta.name} ${n}`} selected={n === selCh} fillDelay={pickedCh ? 0 : i * step + 90} onPress={() => pick(n)} style={[pickerStyles.num, styles.cell]} fontSize={15}
                          bg={chMarked ? ink.accentSoft : readSet.has(`${open}.${n}`) ? ink.selected : ink.card} marked={chMarked} onLongPress={onMark ? () => onMark({ book: open, chapter: n }) : undefined} />
                      </PopIn>
                    )
                  })}
                </View>
              ) : null}
            </View>
          )
        }),
      ])}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  // a ScrollView grows and shrinks by default (flex 1 on the web): pinned, or it takes the row's slack from the text
  pane: { width: PANE_W, flexGrow: 0, flexShrink: 0, borderRightWidth: StyleSheet.hairlineWidth },
  group: { paddingTop: SPACE.m, paddingBottom: SPACE.xs },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10 },
  name: { flex: 1, fontSize: TYPE.small + 1 },
  mark: { width: 6, height: 6, borderRadius: 3, marginLeft: 8 },
  grid: { paddingVertical: SPACE.s },
  cell: { width: CELL_W },
})
