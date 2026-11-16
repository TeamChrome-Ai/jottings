import { useEffect, useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Expansion, Suggestion } from '@shared/ministry'
import { formatRef } from '@shared/ref'
import { t, tn } from '@shared/i18n'
import { loadExpansion, shouldExpand } from '../lib/expandCore'
import { Chip, Enter, SPACE, T } from './ui'

/** How long a question stands, once the words search has answered it, before it is put to the model: typing on is not
 *  asking, and every new question costs. */
const ASK_WAIT_MS = 1000

/**
 * Other wordings for a plain question the words search found little for (expandCore.ts): phrases in the writers' own
 * words and related subjects in one row, as a tap on either searches for it (`onSearch`), then the verses the writers
 * expound on it, each of which opens Ministry on that verse. Every chip says how many paragraphs it finds. Nothing shows while the model is asked, when the
 * server asks none or is busy, or when nothing it suggested finds a paragraph.
 */
export default function SearchExpansion({ query, found, onSearch }: { query: string; /** the words search's paragraphs for `query`, null until it answers */ found: number | null; onSearch: (words: string) => void }) {
  const router = useRouter()
  const ask = shouldExpand(query, found)
  const [shown, setShown] = useState<{ query: string; expansion: Expansion } | null>(null)
  useEffect(() => {
    if (!ask) return
    let on = true
    const wait = setTimeout(() => { void loadExpansion(query).then(expansion => { if (on && expansion) setShown({ query, expansion }) }) }, ASK_WAIT_MS)
    return () => { on = false; clearTimeout(wait) }
  }, [ask, query])
  if (!ask || shown?.query !== query) return null
  const { verses, phrases, related } = shown.expansion
  // a wording the model gave both as a phrase and as a subject is one chip
  const wordings = [...phrases, ...related].filter((s, i, all) => all.findIndex(x => x.text === s.text) === i)
  const searchChip = (s: Suggestion) => (
    <Chip key={s.text} label={s.text} detail={s.total.toLocaleString()} onPress={() => onSearch(s.text)}
      accessibilityLabel={tn(s.total, 'Search for “{words}”: {n} paragraph', 'Search for “{words}”: {n} paragraphs', { words: s.text, n: s.total.toLocaleString() })} />
  )
  return (
    <Enter style={{ gap: SPACE.m }}>
      <T small muted accessibilityRole="header">{t('Other wordings')}</T>
      <Group>{wordings.map(searchChip)}</Group>
      <Group title={t('Verses')}>
        {verses.map(v => {
          const ref = formatRef({ book: v.book, chapter: v.chapter, v1: v.verse })
          return (
            <Chip key={ref} label={ref} detail={v.total.toLocaleString()}
              accessibilityLabel={tn(v.total, 'Ministry on {ref}: {n} paragraph', 'Ministry on {ref}: {n} paragraphs', { ref, n: v.total.toLocaleString() })}
              onPress={() => router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(v.book), chapter: String(v.chapter), v: String(v.verse), ministry: '1' } })} />
          )
        })}
      </Group>
      <T small muted>{t('An AI model suggested these wordings. Every result is from the library.')}</T>
    </Enter>
  )
}

function Group({ title, children }: { title?: string; children: ReactNode[] }) {
  if (!children.length) return null
  return (
    <View style={{ gap: SPACE.s }}>
      {title ? <T small muted bold>{title}</T> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACE.s }}>{children}</View>
    </View>
  )
}
