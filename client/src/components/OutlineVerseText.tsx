import { memo } from 'react'
import { Text, type StyleProp, type TextStyle } from 'react-native'
import { t } from '@shared/i18n'
import { tokenize } from '../lib/bible'
import type { VerseRow } from '../lib/outlines'
import { face } from '../theme'
import { useReadingFont } from '../hooks/useReadingFont'
import { useColors } from '../hooks/useTheme'

/**
 * Verse rows in the reader's font: superscript numbers when the range spans more than one verse, italics
 * from the `h` variant via the same tokenizer ChapterView uses. Renders a single Text so it nests inline.
 */
export default memo(function OutlineVerseText({ rows, loading, fontSize = 16, style, numberOfLines }: { rows: VerseRow[] | undefined; loading: boolean; fontSize?: number; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const c = useColors()
  const f = useReadingFont(fontSize)
  if (!rows) return <Text style={[{ color: c.muted, fontSize: 13 }, style]}>{loading ? t('Loading…') : ''}</Text>
  if (rows.length === 0) return <Text style={[{ color: c.muted, fontSize: 13 }, style]}>{t('No text found for this reference.')}</Text>
  return (
    <Text numberOfLines={numberOfLines} style={[{ color: c.text, ...f.body }, style]}>
      {rows.map(r => (
        <Text key={r.v}>
          {rows.length > 1 ? <Text style={{ color: c.accent, fontSize: fontSize * 0.62, ...SANS_BOLD }}>{r.v} </Text> : null}
          {r.t === ''
            ? <Text style={{ color: c.muted, ...f.italic }}>{t('[omitted]')}</Text>
            : tokenize(r).map((t, i) => <Text key={i} style={t.italic ? f.italic : undefined}>{t.tok}</Text>)}
          {' '}
        </Text>
      ))}
    </Text>
  )
})

const SANS_BOLD = face('sans', { bold: true })
