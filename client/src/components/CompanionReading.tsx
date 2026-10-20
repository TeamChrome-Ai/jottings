import { Fragment, memo, useCallback, useMemo, useState, type ReactNode } from 'react'
import { Platform, Text, View, type TextStyle } from 'react-native'
import { formatPassages, paragraphsOf, passageStart, titleIsPassage, workLine, type Place, type Section } from '@shared/companion'
import type { MinistrySectionMeta } from '@shared/ministry'
import { formatRef, type Ref, type RefHome } from '@shared/ref'
import { isLookupWord } from '@shared/cbd'
import { t } from '@shared/i18n'
import { proseWords, wordTapAt, type WordTap } from '@shared/wordTap'
import { wordAtPoint } from '../lib/wordAtPoint'
import { inlineSpans, superscript, type Span } from '../lib/intro'
import { quoteLinks, type QuoteLink } from '../lib/quoteLinks'
import { useReadingFont } from '../hooks/useReadingFont'
import { usePageInks } from '../hooks/useTheme'
import InkText from './InkText'
import { face } from '../theme'
import type { Font } from '../store/prefs'
import { PulseOnce } from './motion/community'
import { easeNextLayout, useReduceMotion } from './motion/nav'
import { Enter, RADIUS, T, TYPE } from './ui'

/** The size the companion is read at, in the reader's sheet and in the library: the dictionary article's. */
export const READING_SIZE = 17

/**
 * Where a section sits: its work (and part) in small type, its title in the reading font (unless `title` is false: it
 * would repeat the sheet's), a letter's recipient and date and its topics, then the passage it treats. `line` replaces
 * the small line (a library work that is not one of the companion's); `onPassage` makes the passage a link into the
 * reader, to its first verse.
 */
export function CompanionHeading({ place, size = 22, title = true, line, onPassage }: {
  place: { author: string; work: Place['work']; section: MinistrySectionMeta }; size?: number; title?: boolean; line?: string; onPassage?: (r: Ref) => void
}) {
  const c = usePageInks()
  const f = useReadingFont(size, 1.25)
  const { section } = place
  const passages = section.passages.length && !titleIsPassage(section.title) ? formatPassages(section.passages) : ''
  const to = section.to?.trim() ? (/^to\b/i.test(section.to.trim()) ? section.to.trim() : `To ${section.to.trim()}`) : ''
  // a letter titled by its recipient and date already says them
  const line2 = [to, section.date?.trim()].filter(Boolean).join(' · ')
  const sent = line2 && !section.title.includes(section.date?.trim() || to) ? line2 : ''
  return (
    <View style={{ gap: 2 }}>
      <T small muted>{line ?? workLine(place as Place)}</T>
      {title ? <Text accessibilityRole="header" style={{ color: c.text, ...f.body, ...f.bold }}>{section.title}</Text> : null}
      {sent ? <T small muted>{sent}</T> : null}
      {section.subtitle ? <Text style={{ color: c.muted, fontSize: TYPE.small, lineHeight: 20, ...f.italic }}>{section.subtitle}</Text> : null}
      {passages ? onPassage
        ? <Text accessibilityRole="link" accessibilityLabel={t('Read {passage}', { passage: passages })} onPress={() => onPassage(passageStart(section.passages[0]))} style={{ color: c.accent, fontSize: TYPE.small, alignSelf: 'flex-start' }}>{passages}</Text>
        : <T small muted>{passages}</T> : null}
    </View>
  )
}

interface Ink { italic: TextStyle; onRef: (r: Ref) => void; onNote: (id: string) => void }

const LINK: TextStyle = { textDecorationLine: 'underline' }
/** Inline spans: italics, references linked into the reader, footnote callers as superior figures in the accent. Their
 *  colours are leaves (InkText): a theme change never walks a section's paragraphs. With `onWord` on the phone, every
 *  word that could name an article is its own Text (the Bible reader's pattern under its switch): the cost of a node
 *  per word is paid only by a reader who turned Word lookup on. The web finds the word from the click point instead
 *  (Paragraph), so its spans stay whole. `links`: the line's quotations of Scripture (lib/quoteLinks.ts), set in the
 *  accent without the reference's underline; a tap opens the verse quoted, ahead of Word lookup, as a reference does. */
function Spans({ spans, ink, onWord, links }: { spans: Span[]; ink: Ink; onWord?: (t: WordTap) => void; links?: readonly QuoteLink[] }) {
  const words = onWord && Platform.OS !== 'web' ? lineWords(spans) : null
  let at = 0
  return spans.map((s, i) => {
    const style = s.italic ? ink.italic : undefined
    const start = at
    at += s.text.length
    if (s.note !== undefined) {
      const id = s.note
      return <InkText key={i} ink="accent" accessibilityRole="button" accessibilityLabel={t('Footnote {marker}', { marker: id })} onPress={() => ink.onNote(id)} style={style}>{s.text}</InkText>
    }
    if (s.ref) {
      const ref = s.ref
      return <InkText key={i} ink="accent" accessibilityRole="link" onPress={() => ink.onRef(ref)} style={[style, LINK]}>{s.text}</InkText>
    }
    const prose = (from: number, to: number) => { const t = s.text.slice(from - start, to - start); return words ? tappable(t, from, words, onWord!) : t }
    const end = at
    const quoted = links?.filter(l => l.a < end && start < l.b)
    if (!quoted?.length) return <Text key={i} style={style}>{prose(start, end)}</Text>
    const parts: ReactNode[] = []
    let pos = start
    quoted.forEach((l, k) => {
      const a = Math.max(l.a, start), b = Math.min(l.b, end)
      if (a > pos) parts.push(<Fragment key={`p${k}`}>{prose(pos, a)}</Fragment>)
      parts.push(<InkText key={`q${k}`} ink="accent" accessibilityRole="link" accessibilityHint={t('Opens {ref}', { ref: formatRef(l.ref) })} onPress={() => ink.onRef(l.ref)}>{s.text.slice(a - start, b - start)}</InkText>)
      pos = b
    })
    if (pos < end) parts.push(<Fragment key="p">{prose(pos, end)}</Fragment>)
    return <Text key={i} style={style}>{parts}</Text>
  })
}

interface LineWords { at: { word: string; at: number }[]; names: string[] }
/** The words of one line across its spans, so a two-word term split by italics ("the <i>old</i> man") still reads whole. */
function lineWords(spans: Span[]): LineWords {
  const at = proseWords(spans.map(s => s.text).join(''))
  return { at, names: at.map(w => w.word) }
}
/** A span's text with each lookup word (whole within the span) answering a tap; the rest stays plain string. */
function tappable(text: string, start: number, words: LineWords, onWord: (t: WordTap) => void): ReactNode[] {
  const out: ReactNode[] = []
  const end = start + text.length
  let pos = 0
  words.at.forEach((w, k) => {
    if (w.at < start || w.at + w.word.length > end) return
    const local = w.at - start
    if (local > pos) out.push(text.slice(pos, local))
    out.push(isLookupWord(w.word) ? <Text key={k} onPress={() => onWord(wordTapAt(words.names, k))}>{w.word}</Text> : w.word)
    pos = local + w.word.length
  })
  if (pos < text.length) out.push(text.slice(pos))
  return out
}

interface ParagraphProps {
  i: number; lines: Span[][]; quote: boolean; f: ReturnType<typeof useReadingFont>; q: ReturnType<typeof useReadingFont>; ink: Ink
  /** the footnote open under this paragraph */
  open: string | null; noteText: (id: string) => string
  onPara?: (i: number, y: number) => void; washed: boolean; washDelay: number; size: number; home?: RefHome
  onWord?: (t: WordTap) => void
  /** its quotations of Scripture, by line */
  links: readonly QuoteLink[]
}
/** One paragraph, memoised: a footnote opening under another, or a theme change, lays out none of the others again. */
const Paragraph = memo(function Paragraph({ i, lines, quote, f, q, ink, open, noteText, onPara, washed, washDelay, size, home, onWord, links }: ParagraphProps) {
  // web: one click handler on the paragraph; the word comes from the caret at the point (no node per word)
  const onClick = onWord && Platform.OS === 'web'
    ? (e: { currentTarget: unknown; target: unknown; clientX: number; clientY: number }) => { const t = wordAtPoint(e.currentTarget as Element, e.target as EventTarget, e.clientX, e.clientY); if (t) onWord(t) }
    : undefined
  return (
    <View testID={`para-${i}`} onLayout={onPara ? e => onPara(i, e.nativeEvent.layout.y) : undefined}>
      {washed ? <View pointerEvents="none" style={{ position: 'absolute', left: -10, right: -10, top: -6, bottom: -6 }}><PulseOnce delay={washDelay} radius={RADIUS.control} strength={0.16} /></View> : null}
      <InkText ink="text" style={[quote ? q.body : f.body, quote ? QUOTE : null]} {...(onClick ? { onClick } as object : null)}>
        {lines.map((l, j) => <Text key={j}>{j ? '\n' : ''}<Spans spans={l} ink={ink} onWord={onWord} links={links.length ? links.filter(x => x.line === j) : undefined} /></Text>)}
      </InkText>
      {open ? <SectionNote marker={open} text={noteText(open)} size={size} font={f.font} home={home} ink={ink} /> : null}
    </View>
  )
})

const NO_NOTES: string[] = []
const NO_LINKS: QuoteLink[] = []
/**
 * A section's text, typeset like the About notices: paragraphs in the reader's font, block quotations (hymns, a long
 * verse) set in from the left with their lines kept, scripture references linked through `onRef` (`home`, the book the
 * section is on, gives "chapter 9" and "verse 4" their book), footnote callers that open their note under the
 * paragraph. `from`/`to` show a page of the paragraphs; `onPara` reports where each one lands
 * (for opening at the verse in view); `wash` is the paragraph that was opened at, washed once in the accent. `size` and
 * `line` set the reading size and line height (the library reads at the reader's own; the sheet at READING_SIZE).
 * `onWord`: Word lookup is on; a tap on a word of the prose reports it with its neighbours (references stay links).
 * The section's quotations of Scripture (`section.quotes`, from the ministry's verse index) are links to the verse
 * they quote, through `onRef` like a reference: from the companion sheet that is back to the chapter being read.
 */
export const CompanionText = memo(function CompanionText({ section, home, from = 0, to, onRef, onPara, wash = -1, washDelay = 0, size = READING_SIZE, line = 1.6, onWord }: {
  section: Section; home?: RefHome; from?: number; to?: number; onRef: (r: Ref) => void
  onPara?: (i: number, y: number) => void; wash?: number; washDelay?: number; size?: number; line?: number; onWord?: (t: WordTap) => void
}) {
  const reduce = useReduceMotion()
  const f = useReadingFont(size, line)
  const q = useReadingFont(size - 1, Math.max(1.2, line - 0.05))
  const notes = section.notes ?? NO_NOTES
  const paras = useMemo(() => paragraphsOf(section.text), [section.text])
  const spans = useMemo(() => paras.map(p => p.lines.map(l => inlineSpans(l, notes.length > 0, home))), [paras, notes.length, home?.book, home?.chapter])  // eslint-disable-line react-hooks/exhaustive-deps
  const links = useMemo(() => {
    const quoted = new Map<number, { verse: number; words: string }[]>()
    for (const [i, verse, words] of section.quotes ?? []) quoted.set(i, [...(quoted.get(i) ?? []), { verse, words }])
    return spans.map((lines, i) => { const qs = quoted.get(i); return qs ? quoteLinks(lines.map(l => l.map(s => s.text).join('')), qs) : NO_LINKS })
  }, [spans, section.quotes])
  const [openNote, setOpenNote] = useState<string | null>(null)
  const onNote = useCallback((id: string) => { easeNextLayout(reduce); setOpenNote(o => o === id ? null : id) }, [reduce])
  const ink = useMemo<Ink>(() => ({ italic: f.italic, onRef, onNote }), [f.italic, onRef, onNote])
  const noteText = useCallback((id: string) => notes[+id - 1] ?? '', [notes])
  return (
    <View style={{ gap: Math.round(size * line * 0.55) }}>
      {paras.slice(from, to).map((p, k) => {
        const i = from + k
        const lines = spans[i]
        const open = openNote !== null && lines.some(l => l.some(s => s.note === openNote)) ? openNote : null
        return <Paragraph key={i} i={i} lines={lines} quote={p.quote} f={f} q={q} ink={ink} open={open} noteText={noteText} onPara={onPara} washed={wash === i} washDelay={washDelay} size={size} home={home} onWord={onWord} links={links[i]} />
      })}
    </View>
  )
})

const QUOTE: TextStyle = { paddingLeft: 18 }
/** A footnote opened under its paragraph. */
function SectionNote({ marker, text, size, font, home, ink }: { marker: string; text: string; size: number; font: Font; home?: RefHome; ink: Ink }) {
  const c = usePageInks()
  return (
    <Enter style={{ marginTop: 8, backgroundColor: c.card, borderRadius: RADIUS.control, paddingHorizontal: 14, paddingVertical: 12 }}>
      <Text style={{ color: c.muted, fontSize: Math.max(TYPE.small, Math.round(size * 0.82)), lineHeight: Math.round(Math.max(TYPE.small, size * 0.82) * 1.5), ...face(font) }}><Text style={{ color: c.accent }}>{superscript(marker)} </Text>
        {/* a note of several paragraphs keeps them apart */}
        {text.split(/\n{2,}/).map((para, k) => <Text key={k}>{k ? '\n\n' : ''}<Spans spans={inlineSpans(para, false, home)} ink={ink} /></Text>)}
      </Text>
    </Enter>
  )
}
