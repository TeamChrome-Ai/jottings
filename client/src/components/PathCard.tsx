import { useMemo } from 'react'
import { Text, View } from 'react-native'
import { pathBooks, pathChapters, pathTitle } from '@shared/paths'
import { useInks } from '../hooks/useTheme'
import { face } from '../theme'
import type { PathView } from '../lib/paths'
import { countWords, paceLine, portionTitle, thenLine } from '../lib/pathWords'
import PathStrip from './PathStrip'
import { FadeSwap } from './motion/nav'
import { Card, T } from './ui'

/**
 * Home's one card while a path is on (docs/PATHS.md "Surfaces"): the compact strip, "Next on your path" over the
 * portion, the count at the right, and with a target one exact line ("3 a day to finish by 31 Dec · 2 ahead"). A tap
 * opens the next portion; a finished path offers another. The whole card is the button (no nested buttons on web).
 */
export default function PathCard({ path, delay = 0, onOpen, onPaths }: { path: PathView; delay?: number; onOpen: (r: { book: number; chapter: number }) => void; onPaths: () => void }) {
  const c = useInks()
  const state = path.state!
  const pr = path.progress!
  const chapters = useMemo(() => pathChapters(state), [state])
  const route = useMemo(() => pathBooks(state), [state])
  const next = path.next
  const title = pathTitle(state)
  const pace = paceLine(path.paceNeeded, path.standing, state.target_date)
  const label = next ? `Next on your path, ${portionTitle(next.portion)}, ${title}, ${countWords(pr)}${pace ? `. ${pace}` : ''}. Open the chapter` : `You have read ${title}. Start another`
  return (
    <Card onPress={next ? () => onOpen(next.portion) : onPaths} accessibilityLabel={label} style={{ gap: 12, paddingVertical: 16, paddingHorizontal: 20 }}>
      <PathStrip compact route={route} routeChapters={chapters} readSet={path.readSet} place={next?.portion ?? null} delay={delay} />
      {/* a credit landing swaps the portion in place rather than jumping */}
      <FadeSwap k={next ? `${next.portion.book}.${next.portion.chapter}` : 'done'}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ flex: 1, gap: 2 }}>
            {next ? (
              <>
                <T small muted>Next on your path</T>
                <Text numberOfLines={1} style={{ color: c.text, fontSize: 22, ...face('serif', { bold: true }) }}>{portionTitle(next.portion)} <Text style={{ color: c.muted, fontSize: 16, ...face('serif') }}>· {title}</Text></Text>
                {thenLine(next.portion) ? <T small muted numberOfLines={1}>{thenLine(next.portion)}</T> : null}
              </>
            ) : (
              <>
                <T small muted>Your path</T>
                <Text numberOfLines={2} style={{ color: c.text, fontSize: 20, ...face('serif', { bold: true }) }}>You have read {title}</Text>
                <T small accent bold>Start another</T>
              </>
            )}
          </View>
          <T bold style={{ fontSize: 20, fontVariant: ['tabular-nums'], color: next ? c.accent : c.muted }}>{countWords(pr)}</T>
        </View>
      </FadeSwap>
      {pace ? <T small muted>{pace}</T> : null}
    </Card>
  )
}
