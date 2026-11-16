import { useMemo } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { NOUN } from '@shared/brand'
import { t } from '@shared/i18n'
import { formatRef, refKey } from '@shared/ref'
import { applyProposal, dismissProposal, undoShown, type Shown } from '../lib/assistant'
import { changeText } from '../lib/assistantActions'
import type { Item, Proposal, ProposalRow } from '../lib/assistantOutlines'
import { MAX_DEPTH, itemRef, openParagraph, useVerseTexts, type VerseRow } from '../lib/outlines'
import { paragraphRoute, shownByWords } from '../lib/paragraphLine'
import { useReadingFont } from '../hooks/useReadingFont'
import { useInks } from '../hooks/useTheme'
import OutlineVerseText from './OutlineVerseText'
import { Button, Card, Row, SPACE, T, TYPE } from './ui'

/**
 * A write Ask would make to one of the reader's own jottings, held by the server for the reader's tap
 * (docs/ASSISTANT.md): exactly what it would add or change, each passage with its words, and Apply. Nothing is
 * written before the tap, and nothing at all on Not now.
 */
export function AskProposal({ p }: { p: Proposal }) {
  const keys = useMemo(() => [...new Set(p.rows.flatMap(r => [r.item, ...(r.was ? [r.was] : [])]).flatMap(i => { const ref = itemRef(i); return ref ? [refKey(ref)] : [] }))], [p])
  const texts = useVerseTexts(keys)
  const label = (r: ProposalRow) => {
    switch (r.mark) {
      case 'add': return t('Add as line {n}', { n: r.n })
      case 'move': return t('Move to line {n}', { n: r.n })
      case 'replace': return t('Replace line {n}', { n: r.n })
      case 'remove': return t('Remove line {n}', { n: r.n })
    }
  }
  return (
    <Card>
      <T bold>{p.kind === 'create' ? t('Ask would make this {one}', { one: NOUN.one }) : t('Ask would change “{title}”', { title: p.renamed ?? p.title })}</T>
      <T small muted>{t('Nothing is written until you tap Apply.')}</T>
      {p.kind === 'create' ? <T serif bold style={{ fontSize: TYPE.heading }}>{p.title}</T> : null}
      {p.renamed !== undefined ? <View style={{ gap: 2 }}><T small muted>{t('New title')}</T><T serif bold>{p.title}</T></View> : null}
      {p.rows.map((r, k) => (
        <View key={k} style={{ gap: 2 }}>
          {p.kind === 'edit' ? <T small muted>{label(r)}</T> : null}
          {r.was ? <Line item={r.was} verses={texts.verses} loading={texts.loading} gone /> : null}
          <Line item={r.item} verses={texts.verses} loading={texts.loading} gone={r.mark === 'remove'} />
        </View>
      ))}
      {p.kind === 'create' && p.rows.length === 0 ? <T small muted>{t('With no lines yet.')}</T> : null}
      <Row style={{ justifyContent: 'flex-end', marginTop: SPACE.xs }}>
        <Button small title={t('Not now')} onPress={dismissProposal} />
        <Button small primary title={t('Apply')} onPress={applyProposal} />
      </Row>
    </Card>
  )
}

/** One line as the jotting would show it; `gone`: a line that would be taken out, or the one a new line replaces. */
function Line({ item, verses, loading, gone = false }: { item: Item; verses: Map<string, VerseRow[]>; loading: boolean; gone?: boolean }) {
  const c = useInks()
  const { body } = useReadingFont(16)
  const indent = { marginLeft: 16 * Math.min(item.depth, MAX_DEPTH) }
  const out = gone ? { color: c.muted, textDecorationLine: 'line-through' as const } : null
  switch (item.kind) {
    case 'verse': {
      const ref = itemRef(item)
      if (!ref) return null
      return (
        <View style={[indent, { gap: 2 }]}>
          <T small style={[{ color: c.accent, fontWeight: '600' }, out]}>{formatRef(ref)}</T>
          {/* the passage's opening words, as the editor previews one: the line is its reference */}
          {gone ? null : <OutlineVerseText rows={verses.get(refKey(ref))} loading={loading} numberOfLines={6} />}
        </View>
      )
    }
    case 'note': return <T style={[indent, body, out]}>{item.text ?? ''}</T>
    case 'heading': return <T bold style={[indent, out]}>{item.text ?? ''}</T>
    case 'link': {
      // a paragraph of the library (lib/paragraphLine.ts) is shown as the link it will be in the jotting: its words
      // alone, which say where it goes and open that paragraph here, so the reader can read what a note rests on
      // before the tap on Apply. Its address is not put under them (the same long line for every such link). A link
      // the reader would have put in themselves is shown with its address, as before
      const words = shownByWords(item)
      const paragraph = words && !gone ? paragraphRoute(item.url ?? '') : null
      return (
        <View style={indent}>
          {item.text ? (paragraph
            ? <T accessibilityRole="link" style={{ color: c.accent, textDecorationLine: 'underline' }} onPress={() => openParagraph(paragraph)}>{item.text}</T>
            : <T style={out}>{item.text}</T>) : null}
          {words ? null : <T small muted style={out}>{item.url ?? ''}</T>}
        </View>
      )
    }
  }
}

/** A change Ask made: one line and its Undo on one row, the Undo at the right however long the line; undone, the row
 *  keeps its height. A jotting it made or changed opens from its line; an Undo that found the jotting changed since
 *  says so under the line, having written nothing. */
export function ChangeRow({ s, index }: { s: Extract<Shown, { kind: 'change' }>; index: number }) {
  const router = useRouter()
  const line = s.change.line
  // a jotting whose making was undone is not there to open
  const opens = line.kind === 'jotting-edited' || (line.kind === 'jotting-created' && !s.undone) ? line : null
  return (
    <View style={{ gap: SPACE.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.m, minHeight: 36 }}>
        {opens
          ? <T small accent accessibilityRole="link" accessibilityLabel={t('Open “{title}”', { title: opens.title })} style={{ flex: 1 }}
              onPress={() => router.push({ pathname: '/outlines/[id]', params: { id: String(opens.id) } })}>{changeText(line)}</T>
          : <T small muted style={{ flex: 1 }}>{changeText(line)}</T>}
        {s.undone ? <T small muted>{t('Undone')}</T>
          : s.changed || s.change.undo.kind === 'none' ? null
          : <Button small title={t('Undo')} onPress={() => void undoShown(index)} />}
      </View>
      {s.changed ? <T small muted>{t('This {one} has changed since, so nothing was undone.', { one: NOUN.one })}</T> : null}
    </View>
  )
}
