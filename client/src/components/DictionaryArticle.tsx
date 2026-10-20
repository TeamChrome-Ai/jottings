import { useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { articleWords, paragraphs, type CbdEntry } from '@shared/cbd'
import type { Ref } from '@shared/ref'
import { t, tn } from '@shared/i18n'
import { useDictionaryIndex } from '../hooks/useDictionaryIndex'
import { useReadingFont } from '../hooks/useReadingFont'
import { useInks } from '../hooks/useTheme'
import { face } from '../theme'
import FootnoteText from './FootnoteText'
import { easeNextLayout, useReduceMotion } from './motion/nav'
import { Button, Chip, Enter, T, TYPE } from './ui'

/**
 * One Concise Bible Dictionary article in the reader's font (Settings → Text). Scripture references link into the reader and "See X"
 * cross-references call `onLink` with the target id, both through FootnoteText. `collapsed` shows the first paragraph
 * with "Read more" when there is more; the rest opens in place.
 */
export default function DictionaryArticle({ entry, collapsed = false, onLink, onNavigate, size = TYPE.body }: { entry: CbdEntry; collapsed?: boolean; onLink: (id: string) => void; onNavigate?: (r: Ref) => void; size?: number }) {
  const c = useInks()
  const reduce = useReduceMotion()
  const paras = useMemo(() => paragraphs(entry.text), [entry.text])
  const [open, setOpen] = useState(!collapsed)
  const shown = open ? paras : paras.slice(0, 1)
  const f = useReadingFont(size)
  const body = useMemo(() => ({ color: c.text, ...f.body }), [c.text, f.body])
  const italic = f.italic
  return (
    <View style={{ gap: 10 }}>
      {shown.map((p, i) => {
        const text = <FootnoteText key={i} english text={p} style={body} italicStyle={italic} onLink={onLink} onNavigate={onNavigate} />
        // paragraphs opened by "Read more" answer the tap; the first one is content and is simply there
        return i > 0 && collapsed ? <Enter key={i}>{text}</Enter> : text
      })}
      {!open && paras.length > 1 ? (
        <Button small soft title={tn(paras.length - 1, 'Read more ({n} more paragraph)', 'Read more ({n} more paragraphs)')} onPress={() => { easeNextLayout(reduce); setOpen(true) }} style={{ alignSelf: 'flex-start' }} />
      ) : null}
      {!collapsed && entry.aliases?.length ? <Text style={{ color: c.muted, fontSize: TYPE.small }}>{t('Also entered as {aliases}', { aliases: entry.aliases.join(', ') })}</Text> : null}
    </View>
  )
}

/** Headword in the reader's font, bold, with a pronunciation after it when the entry has one. */
export function Headword({ entry, size = 20 }: { entry: Pick<CbdEntry, 'headword' | 'pron'>; size?: number }) {
  const c = useInks()
  const f = useReadingFont(size, 1.25)
  return (
    <Text accessibilityRole="header" style={{ color: c.text, ...f.body, ...f.bold }}>
      {entry.headword}
      {entry.pron ? <Text style={{ color: c.muted, fontSize: Math.round(size * 0.7), ...face(f.font, { italic: true }) }}>{'  '}{entry.pron}</Text> : null}
    </Text>
  )
}

/**
 * The Greek and Hebrew words an article discusses, as chips: each opens that word's Strong's number (`onWord`). Nothing
 * when the article names none, or none Strong spells the same way.
 */
export function ArticleWords({ id, onWord }: { id: string; onWord: (code: string, lemma: string) => void }) {
  const index = useDictionaryIndex()
  const words = articleWords(index?.byId.get(id))
  if (!words.length) return null
  const greek = words.some(w => w[0].startsWith('G')), hebrew = words.some(w => w[0].startsWith('H'))
  return (
    <View style={{ gap: 8 }}>
      <T small muted>{greek && hebrew ? t('Greek and Hebrew words in this article') : greek ? t('Greek words in this article') : t('Hebrew words in this article')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {words.map(([code, lemma]) => <Chip key={code} label={lemma} detail={code} accessibilityLabel={t('{lemma}, Strong’s {code}', { lemma, code })} onPress={() => onWord(code, lemma)} />)}
      </View>
    </View>
  )
}
