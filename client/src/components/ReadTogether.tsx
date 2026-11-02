import { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { BOOKS } from '@shared/books'
import { chapterKey, chaptersRead } from '@shared/paths'
import { nextChapterAfter } from '@shared/reading'
import { formatRef } from '@shared/ref'
import { t, tn } from '@shared/i18n'
import { displayName, fmtWhen, type GroupDetail, type GroupTogether } from '../lib/community'
import { biblePercentWords } from '../lib/pathWords'
import { loadPosition } from '../hooks/usePosition'
import { setReadingWith } from '../store/readingWith'
import PathStrip from './PathStrip'
import { Button, Card, H2, Row, SPACE, T } from './ui'

const readerRoute = (p: { book: number; chapter: number }) => ({ pathname: '/read/[book]/[chapter]' as const, params: { book: String(p.book), chapter: String(p.chapter) } })

/**
 * What a group has read together (report #33: a household reading to a child from either phone): the whole-Bible strip
 * with those chapters filled, how many and what share of the Bible they are, the last one and who read it, and
 * "Continue" into the chapter after it with reading-with turned on for this group. A group that has never read
 * together gets one quiet way to start, opening the reader where the reader last was.
 */
export default function ReadTogether({ group }: { group: GroupDetail }) {
  const router = useRouter()
  const together = group.together ?? null
  const readSet = useMemo(() => {
    const s = new Set<string>()
    for (const b of BOOKS) together?.reads[String(b.n)]?.forEach((n, i) => { if (n > 0 && i < b.chapters) s.add(chapterKey(b.n, i + 1)) })
    return s
  }, [together])
  const start = (p: { book: number; chapter: number }) => { setReadingWith({ groupId: group.id, name: group.name, slug: group.slug }); router.push(readerRoute(p)) }
  if (!together) return <Button title={t('Read with this group')} small onPress={() => { void loadPosition(true).then(start) }} style={{ alignSelf: 'flex-start' }} />
  const chapters = chaptersRead(together.reads)
  const next = nextChapterAfter(together.last.book, together.last.chapter)
  return (
    <>
      <H2>{t('Read together')}</H2>
      <Card style={{ gap: SPACE.m }}>
        <PathStrip route={null} readSet={readSet} delay={120} accessibilityLabel={tn(chapters, '{n} chapter read together', '{n} chapters read together')} />
        <View style={{ gap: 2 }}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <T bold>{tn(chapters, '{n} chapter read together', '{n} chapters read together')}</T>
            <T small muted style={{ fontVariant: ['tabular-nums'] }}>{biblePercentWords(chapters)}</T>
          </Row>
          <T small muted>{lastLine(together)}</T>
        </View>
        <Button title={t('Continue: {ref}', { ref: formatRef(next) })} primary onPress={() => start(next)} style={{ alignSelf: 'flex-start' }} />
      </Card>
    </>
  )
}

function lastLine(tg: GroupTogether): string {
  const ref = formatRef({ book: tg.last.book, chapter: tg.last.chapter }), when = fmtWhen(tg.last.at)
  return tg.last.user ? t('Last: {ref}, {when}, {name}', { ref, when, name: displayName(tg.last.user) }) : t('Last: {ref}, {when}', { ref, when })
}
