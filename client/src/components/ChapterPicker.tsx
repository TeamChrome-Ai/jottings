import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { BOOKS } from '@shared/books'
import { ownChapters } from '@shared/texts'
import { N_, t } from '@shared/i18n'
import { useColors, useInks } from '../hooks/useTheme'
import { bookmarkKey, type BookmarkTarget } from '../lib/bookmarks'
import Icon from './Icon'
import { FILL_SPRING, waveStep } from '../lib/springs'
import { FadeSwap, PopIn, useReduceMotion } from './motion/nav'
import { mix } from '../theme'
import { Button, SPACE, Sheet, TYPE, Tap, useSheetArrivalDelay } from './ui'

/** How long a tapped cell shows its selected fill before the picker moves on. */
export const CONFIRM_MS = 110
const NUM_W = 46
const GAP = 6
const PAD = 12
/** The bookmark ribbon's glyph box on a bookmarked cell. */
const NOTCH = 12
/** How far the New Testament's chips lean toward the accent. */
const NT_TINT = 0.08
const TESTAMENTS = [{ testament: 'OT', label: N_('Old Testament') }, { testament: 'NT', label: N_('New Testament') }] as const

const NO_MARKS: ReadonlyMap<string, number> = new Map()

/**
 * Books, then a book's chapters. With `onMark`, a long press on a book or a chapter toggles its bookmark; bookmarked
 * ones (`marks`, by `bookmarkKey`) carry the accent-soft fill and a small ribbon in the corner.
 */
export default function ChapterPicker({ open, book, chapter, readSet, marks = NO_MARKS, onMark, onClose, onPick }: { open: boolean; book: number; chapter: number; readSet: ReadonlySet<string>; marks?: ReadonlyMap<string, number>; onMark?: (t: BookmarkTarget) => void; onClose: () => void; onPick: (b: number, c: number, v?: number) => void }) {
  const c = useColors()
  const ink = useInks()
  const reduce = useReduceMotion()
  const [b, setB] = useState<number | null>(null)
  const [pickedBook, setPickedBook] = useState<number | null>(null)
  const [pickedCh, setPickedCh] = useState<number | null>(null)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current) }, [])
  const cur = b ?? book
  const meta = BOOKS[cur - 1]
  // every cell pops in, as one wave: the step shrinks with the count so the last cell starts by 240 ms, Psalms' 150th
  // as much as Ruth's 4th (the wave used to run 600 ms, which kept the chapter a reader was reaching for faint)
  const cap = Infinity
  const stepFor = (count: number) => waveStep(count)
  const later = (fn: () => void) => { if (pending.current) clearTimeout(pending.current); if (reduce) fn(); else pending.current = setTimeout(fn, CONFIRM_MS) }
  const reset = () => { setB(null); setPickedBook(null); setPickedCh(null) }
  const close = () => { if (pending.current) clearTimeout(pending.current); reset(); onClose() }
  const openBook = (n: number) => { setPickedBook(n); later(() => { setB(n); setPickedCh(null) }) }
  const pick = (n: number, v = 1) => { setPickedCh(n); later(() => { onPick(cur, n, v > 1 ? v : undefined); reset() }) }
  const selBook = pickedBook ?? book
  const bookIdx = BOOKS.findIndex(bk => bk.n === selBook)
  const selCh = pickedCh ?? (cur === book ? chapter : null)
  const toBooks = () => { setB(null); setPickedBook(null) }
  // the current selection lands just after the stagger settles; a tapped cell fills at once
  const settle = (i: number, step: number, wait: number) => wait + i * step + 90
  // the New Testament's books carry a faint wash of the accent, under their own label
  const ntFill = mix(c.card, c.accent, NT_TINT), ntBorder = mix(c.border, c.accent, NT_TINT * 3)
  return (
    <Sheet open={open} onClose={close} onBack={b ? toBooks : undefined} title={b ? meta.name : t('Books')}>
      <ScrollView contentContainerStyle={{ padding: PAD }}>
        <FadeSwap k={b ?? 'books'}>
          {b === null ? (
            <Grid>{wait => <View style={{ gap: SPACE.l }}>
              {TESTAMENTS.map(({ testament, label }) => (
                <View key={testament} style={{ gap: SPACE.s }}>
                  <Text style={[pickerStyles.group, { color: c.muted }]}>{t(label)}</Text>
                  <View style={pickerStyles.wrap}>
                    {BOOKS.map((bk, i) => {
                      if (bk.testament !== testament) return null
                      const marked = marks.has(bookmarkKey({ book: bk.n }))
                      return (
                        <PopIn key={bk.n} index={i} cap={cap} step={stepFor(BOOKS.length)} base={wait}>
                          <Choice label={bk.abbr} name={bk.name} selected={bk.n === selBook} fillDelay={pickedBook ? 0 : settle(bookIdx, stepFor(BOOKS.length), wait)} onPress={() => openBook(bk.n)} style={pickerStyles.chip} fontSize={14}
                            bg={marked ? ink.accentSoft : testament === 'NT' ? ntFill : ink.card} border={testament === 'NT' ? ntBorder : undefined}
                            marked={marked} onLongPress={onMark ? () => onMark({ book: bk.n }) : undefined} />
                        </PopIn>
                      )
                    })}
                  </View>
                </View>
              ))}
            </View>}</Grid>
          ) : (
            <Grid>{wait => <View style={{ gap: 10 }}>
              <Button small lead="back" title={t('All books')} onPress={toBooks} style={pickerStyles.back} />
              <View style={pickerStyles.wrap}>
                {/* the chapters as the Bible shown prints them (French Joel has four); each opens at the English verse it begins at */}
                {ownChapters(cur).map(({ n: own, c: n, v }, i, all) => {
                  const marked = marks.has(bookmarkKey({ book: cur, chapter: n }))
                  return (
                    <PopIn key={own} index={i} cap={cap} step={stepFor(all.length)} base={wait}>
                      <Choice label={String(own)} name={`${meta.name} ${own}`} selected={n === selCh && (v === 1 || pickedCh === n)} fillDelay={pickedCh ? 0 : settle(i, stepFor(all.length), wait)} onPress={() => pick(n, v)} style={pickerStyles.num} fontSize={15}
                        bg={marked ? ink.accentSoft : readSet.has(`${cur}.${n}`) ? ink.selected : ink.card} marked={marked} onLongPress={onMark ? () => onMark({ book: cur, chapter: n }) : undefined} />
                    </PopIn>
                  )
                })}
              </View>
            </View>}</Grid>
          )}
        </FadeSwap>
      </ScrollView>
    </Sheet>
  )
}

/**
 * One appearance of a grid (the books, or a book's chapters): its wave waits for the sheet to be up when it arrives
 * with the sheet, and starts at once when it replaces the other grid. Read once, on mount, so a re-render never
 * replays it.
 */
export function Grid({ children }: { children: (wait: number) => ReactNode }) {
  const wait = useSheetArrivalDelay()
  return <>{children(wait)}</>
}

/**
 * A book chip or chapter number. The selected one carries an accent layer that springs in over the plain cell; a
 * bookmarked one (`marked`) a small ribbon hanging from its top right corner; one with an `order` (its place in the
 * order a reader is tapping books in, from 1) that number on a badge over the same corner. `name` is what a screen
 * reader says.
 */
export function Choice({ label, name = label, selected, fillDelay, onPress, onLongPress, marked = false, order, style, fontSize, bg, border }: { label: string; name?: string; selected: boolean; fillDelay: number; onPress: () => void; onLongPress?: () => void; marked?: boolean; order?: number; style: StyleProp<ViewStyle>; fontSize: number; bg: string; border?: string }) {
  const c = useInks()
  return (
    <Tap onPress={onPress} onLongPress={onLongPress} scaleTo={0.9} accessibilityRole="button" aria-label={marked ? t('{name}, bookmarked', { name }) : name} aria-selected={selected}
      accessibilityHint={onLongPress ? marked ? t('Hold to remove the bookmark') : t('Hold to bookmark') : undefined} style={[style, { backgroundColor: bg, borderColor: border ?? c.border }]}>
      <Text style={{ color: c.text, fontSize }}>{label}</Text>
      {selected ? <Fill label={label} delay={fillDelay} fontSize={fontSize} /> : null}
      {marked ? <View pointerEvents="none" style={pickerStyles.notch}><Icon name="bookmark" fill size={NOTCH} color={selected ? c.accentText : c.accent} /></View> : null}
      {order ? <View pointerEvents="none" aria-hidden style={[pickerStyles.order, { backgroundColor: c.text, borderColor: c.card }]}><Text style={[pickerStyles.orderText, { color: c.bg }]}>{order}</Text></View> : null}
    </Tap>
  )
}
function Fill({ label, delay, fontSize }: { label: string; delay: number; fontSize: number }) {
  const c = useInks()
  const reduce = useReduceMotion()
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current
  useEffect(() => {
    if (reduce) { v.setValue(1); return }
    // tight: the old friction 6 / tension 180 swung 31% past full and wobbled over the cell
    const a = Animated.spring(v, { toValue: 1, delay, ...FILL_SPRING, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [v, delay, reduce])
  const grow = useMemo(() => ({ opacity: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }), [v])
  return (
    <Animated.View pointerEvents="none" aria-hidden style={[StyleSheet.absoluteFill, pickerStyles.fill, { backgroundColor: c.accent }, grow]}>
      <Text style={{ color: c.accentText, fontSize }}>{label}</Text>
    </Animated.View>
  )
}
export const pickerStyles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth },
  num: { width: NUM_W, height: 40, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  fill: { borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  group: { fontSize: TYPE.caption, paddingHorizontal: 2 },
  back: { alignSelf: 'flex-start' },
  // the glyph's ribbon starts 1/8 of its box down: lifted by that, it hangs from the cell's top edge
  notch: { position: 'absolute', top: -NOTCH / 8, right: 2 },
  // half over the corner, into the grid's gap: the chip's label stays whole
  order: { position: 'absolute', top: -GAP, right: -GAP, minWidth: 18, height: 18, borderRadius: 9, borderWidth: 1, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  orderText: { fontSize: 11, lineHeight: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
})
