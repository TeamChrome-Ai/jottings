import { useRef, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { BOOKS } from '@shared/books'
import { chapterKey, type ReadCounts } from '@shared/paths'
import type { Badge } from '@shared/types'
import { t } from '@shared/i18n'
import { END_WORDS } from '../lib/chapterEnd'
import { firstMark, markRead, unmarkRead } from '../lib/readMarks'
import { tickOf, type ChapterTick } from '../lib/statsMarks'
import { waveStep } from '../lib/springs'
import { useMarks } from '../hooks/useMarks'
import { useInks } from '../hooks/useTheme'
import { useToast } from '../store/toast'
import { Choice, Grid, pickerStyles } from './ChapterPicker'
import { PopIn } from './motion/nav'
import { SPACE, Sheet, T } from './ui'

/** Marks the chapter, or takes the mark back, as its cell stands; answers with the badges the server gave. */
export type MarkToggle = (book: number, chapter: number, tick: ChapterTick) => Promise<Badge[]>
export const toggleMark: MarkToggle = (book, chapter, tick) => (tick === 'ticked' ? unmarkRead(book, chapter) : markRead(book, chapter))

/** What a screen reader says for a cell. */
const SAYS: Record<ChapterTick, (name: string) => string> = {
  unread: name => name,
  read: name => t('{name}, read', { name }),
  ticked: name => t('{name}, marked as read', { name }),
}

/**
 * A book's chapters to mark as read, opened from a row of Stats' Progress by book (reports #23, #37: read in a printed
 * Bible, ticked off here). The chapter picker's cells, popping in as one wave once the sheet is up: a chapter read
 * (credited, or read on this device signed out) in the read fill, the reader's own mark with a check. A tap marks the
 * chapter or takes the mark back; `counts` are drawn behind as they change. The rule is said over the cells, and the
 * badges the marks earn as the sheet closes: a toast cannot show over a sheet.
 */
export default function MarkReadSheet({ book, counts, onToggle = toggleMark, onClose }: { book: number | null; counts: ReadCounts | null; onToggle?: MarkToggle; onClose: () => void }) {
  const ink = useInks()
  const toast = useToast()
  const marks = useMarks().at
  // the book stays named while the sheet goes down
  const [shown, setShown] = useState(book)
  if (book !== null && book !== shown) setShown(book)
  const won = useRef<Badge[]>([])
  const open = useRef(false)
  open.current = book !== null
  const announce = (badges: readonly Badge[]) => { for (const b of badges) toast.show(t('Badge earned: {name}', { name: b.name })) }
  const close = () => { announce(won.current.splice(0)); onClose() }
  const meta = shown ? BOOKS[shown - 1] : null
  const tap = (chapter: number, tick: ChapterTick) => {
    if (!meta) return
    // the sentence over the cells is the one the end line says once
    if (tick !== 'ticked') void firstMark()
    void onToggle(meta.n, chapter, tick).then(badges => { if (open.current) won.current.push(...badges); else announce(badges) })
  }
  return (
    <Sheet open={book !== null} onClose={close} title={meta?.name}>
      <ScrollView contentContainerStyle={{ padding: SPACE.m, gap: 10 }}>
        {/* under the title's own gutter; the cells keep the chapter picker's */}
        <T small muted style={{ paddingHorizontal: SPACE.s }}>{END_WORDS.explained}</T>
        {meta ? <Grid>{wait => (
          <View style={pickerStyles.wrap}>
            {Array.from({ length: meta.chapters }, (_, i) => {
              const c = i + 1, tick = tickOf(counts?.[String(meta.n)]?.[i] ?? 0, marks.has(chapterKey(meta.n, c)))
              return (
                <PopIn key={c} index={i} cap={Infinity} step={waveStep(meta.chapters)} base={wait}>
                  <Choice label={String(c)} name={SAYS[tick](`${meta.name} ${c}`)} selected={false} fillDelay={0} onPress={() => tap(c, tick)} style={pickerStyles.num} fontSize={15}
                    bg={tick === 'unread' ? ink.card : ink.selected} checked={tick === 'ticked'} />
                </PopIn>
              )
            })}
          </View>
        )}</Grid> : null}
      </ScrollView>
    </Sheet>
  )
}
