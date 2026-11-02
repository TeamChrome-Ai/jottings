import { Fragment, useState } from 'react'
import { Text, View } from 'react-native'
import { footnoteWord } from '@shared/footnotes'
import { t, tn } from '@shared/i18n'
import { formatRef, type Ref } from '@shared/ref'
import { useWordFootnotes } from '../lib/footnotes'
import { useReadingFont } from '../hooks/useReadingFont'
import { useInks } from '../hooks/useTheme'
import { face } from '../theme'
import FootnoteText from './FootnoteText'
import { Button, Card, Enter, Row, T, TYPE } from './ui'

const PAGE = 20
const SANS_BOLD = face('sans', { bold: true })

export default function WordFootnotes({ word, rows, scope, onOpen, onAll }: { word: string; rows: number; scope?: string; onOpen: (r: Ref) => void; onAll?: (word: string) => void }) {
  const c = useInks()
  const f = useReadingFont(15, 22 / 15)
  const [upTo, setUpTo] = useState(rows)
  const [of, setOf] = useState(word)
  if (of !== word) { setOf(word); setUpTo(rows) }
  const found = useWordFootnotes(word, upTo, scope)
  if (!found || (!found.groups.length && !found.unread)) return null
  const all = onAll && footnoteWord(word)
  return (
    <View testID="word-footnotes"><Enter style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <T small muted>{t('Footnotes on this word')}</T>
        <T small muted>{found.notes.toLocaleString()}</T>
      </Row>
      {found.groups.length ? (
        <Card style={{ gap: 0, paddingVertical: 6 }}>
          {found.groups.map((g, i) => (
            <View key={g.text} style={{ gap: 4, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
              <FootnoteText text={g.text} context={g.places[0]} onNavigate={onOpen} style={{ color: c.text, ...f.body }} italicStyle={f.italic} />
              <Text style={{ color: c.muted, fontSize: TYPE.small, lineHeight: 20 }}>
                {g.places.map((r, k) => (
                  <Fragment key={k}>
                    {k ? ' · ' : ''}
                    <Text accessibilityRole="link" accessibilityLabel={t('Read {ref}', { ref: formatRef(r) })} onPress={() => onOpen(r)} style={{ color: c.accent, ...SANS_BOLD }}>{formatRef(r).replace(/ /g, '\u00a0')}</Text>
                  </Fragment>
                ))}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
      {found.unread ? <T small muted>{t('Some of these footnotes need a connection.')}</T> : null}
      {found.more > 0 ? (
        onAll && all
          ? <Button small title={tn(found.notes, 'All {n} footnote', 'All {n} footnotes', { n: found.notes.toLocaleString() })} onPress={() => onAll(all)} style={{ alignSelf: 'flex-start' }} />
          : <Button small title={tn(found.more, '{n} more', '{n} more', { n: found.more.toLocaleString() })} onPress={() => setUpTo(u => u + PAGE)} style={{ alignSelf: 'flex-start' }} />
      ) : null}
    </Enter></View>
  )
}
