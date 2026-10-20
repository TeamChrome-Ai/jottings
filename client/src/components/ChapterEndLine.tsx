import { memo, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { chapterKey } from '@shared/paths'
import { t } from '@shared/i18n'
import { END_WORDS, endLine } from '../lib/chapterEnd'
import { refreshPath, useDeviceReads, usePathCounts } from '../lib/paths'
import { firstMark, markRead, unmarkRead } from '../lib/readMarks'
import { useMarks } from '../hooks/useMarks'
import { useInks } from '../hooks/useTheme'
import { useAuth } from '../store/auth'
import { useToast } from '../store/toast'
import type { CreditWait } from '../hooks/useActivity'
import Icon from './Icon'
import { T, Tap } from './ui'

/** The verses still to read, looked at once a second: only this line renders, and only when they change. */
function useGaps(toCredit: (() => CreditWait | null) | undefined, on: boolean): CreditWait['gaps'] | null {
  const [gaps, setGaps] = useState<CreditWait['gaps'] | null>(null)
  useEffect(() => {
    if (!toCredit || !on) { setGaps(null); return }
    const look = () => {
      const next = toCredit()?.gaps ?? null
      setGaps(was => (String(was) === String(next) ? was : next))
    }
    look()
    const t = setInterval(look, 1000)
    return () => clearInterval(t)
  }, [toCredit, on])
  return gaps
}

interface Props {
  book: number; chapter: number
  /** The account has the chapter credited. */
  credited: boolean
  /** useActivity's `toCredit`, for the chapter on screen only: without it nothing is said about time. */
  toCredit?: () => CreditWait | null
  /** Paged mode: no padding of its own and a capped text size, so it stays inside the page's bottom margin. */
  bare?: boolean
  /** Takes the reader to a verse still to read. */
  goToVerse?: (v: number) => void
}

/**
 * The quiet line at a chapter's end (lib/chapterEnd.ts): "Read", or the verses still to read, and the reader's own mark ("Mark as read", then "Marked as read" and "Undo"). One line of small muted text that never
 * moves; a signed-out reader is told nothing about credit, only offered the mark, which stays on the device.
 */
export default memo(function ChapterEndLine({ book, chapter, credited, toCredit, bare = false, goToVerse }: Props) {
  const { user } = useAuth()
  const c = useInks()
  const toast = useToast()
  const marks = useMarks()
  const device = useDeviceReads()
  const path = usePathCounts(book, chapter)
  const k = chapterKey(book, chapter)
  const facts = { credited: credited || (!user && device.has(k)), marked: marks.at.has(k), path }
  const waiting = !!user && endLine(facts).kind === 'open'
  const gaps = useGaps(toCredit, waiting)
  const line = endLine({ ...facts, gaps: gaps ?? undefined })
  // "before this path began" is said from what this device last heard: on the page being read, a credit made elsewhere
  // since is asked for once
  const stale = !!user && !!toCredit && line.kind === 'before-path'
  useEffect(() => { if (stale) void refreshPath() }, [stale, k])

  // the explanation goes to the top: at the foot it would sit on the line it is about
  const mark = () => { void markRead(book, chapter); void firstMark().then(first => { if (first) toast.show(END_WORDS.explained, 9000, true) }) }
  const undo = () => { void unmarkRead(book, chapter) }
  const says = line.kind === 'read' ? END_WORDS.read : line.kind === 'marked' ? END_WORDS.marked : line.kind === 'before-path' ? END_WORDS.beforePath[line.by]
    : line.toRead ? END_WORDS.toRead(line.toRead) : null
  const gapAt = line.kind === 'open' ? line.firstGap : null
  const cap = bare ? 1.1 : undefined
  const action = line.kind === 'read' ? null : line.kind === 'marked' ? { title: END_WORDS.undo, onPress: undo } : { title: END_WORDS.mark, onPress: mark }
  return (
    <View style={[styles.line, bare ? styles.bare : styles.pad]}>
      {line.kind === 'read' ? <Icon name="check" size={14} color={c.muted} /> : null}
      {says && gapAt !== null && goToVerse ? (
        <Tap onPress={() => goToVerse(gapAt)} scaleTo={0.98} crisp hitSlop={bare ? BARE_SLOP : 10} accessibilityRole="link" accessibilityLabel={t('{line}. Go to verse {v}', { line: says, v: gapAt })}>
          <T small muted maxFontSizeMultiplier={cap} style={styles.gap}>{says}</T>
        </Tap>
      ) : says ? <T small muted maxFontSizeMultiplier={cap}>{says}</T> : null}
      {says && action ? <T small muted maxFontSizeMultiplier={cap}>·</T> : null}
      {action ? (
        <Tap onPress={action.onPress} scaleTo={0.98} crisp hitSlop={bare ? BARE_SLOP : 10} accessibilityRole="button" accessibilityLabel={action.title}>
          <T small accent maxFontSizeMultiplier={cap}>{action.title}</T>
        </Tap>
      ) : null}
    </View>
  )
})

/** Android keeps a touch inside the parent's bounds, so in the page margin the row is taller than its text and only its children take touches. */
const BARE_SLOP = { top: 24, bottom: 8, left: 12, right: 12 }
const styles = StyleSheet.create({
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 },
  pad: { paddingHorizontal: 16, paddingVertical: 10 },
  bare: { height: 44, alignItems: 'flex-end', flexWrap: 'nowrap', pointerEvents: 'box-none' },
  gap: { textDecorationLine: 'underline' },
})
