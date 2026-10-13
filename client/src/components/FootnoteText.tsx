import { memo, useMemo } from 'react'
import { Text, type StyleProp, type TextStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { scanRefs, type Ref, type RefContext } from '@shared/ref'
import { usePageInks } from '../hooks/useTheme'

export interface Run { text: string; italic: boolean; /** href of an enclosing <a> (dictionary cross-references) */ link?: string }

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' }
export const unescapeHtml = (s: string) => s.replace(/&[a-z#0-9]+;/g, m => ENT[m] ?? m)
export const stripTags = (s: string) => unescapeHtml(s.replace(/<[^>]+>/g, ''))

/** Trusted fragment -> italic/plain runs. `<i>` and `<em>` carry italics, `<a href>` a link target; every other tag is dropped. */
export function inlineRuns(html: string): Run[] {
  const out: Run[] = []
  let italic = false
  let link: string | undefined
  for (const part of html.split(/(<\/?(?:i|em|a)\b[^>]*>)/)) {
    if (!part) continue
    if (/^<(i|em)\b/.test(part)) { italic = true; continue }
    if (/^<\/(i|em)\b/.test(part)) { italic = false; continue }
    if (/^<a\b/.test(part)) { link = /href="([^"]*)"/.exec(part)?.[1]; continue }
    if (/^<\/a\b/.test(part)) { link = undefined; continue }
    const text = stripTags(part)
    if (text) out.push(link ? { text, italic, link } : { text, italic })
  }
  return out
}

/** The reader route for a reference: chapter plus an optional verse to scroll to. */
export const refParams = (r: Ref) => ({ pathname: '/read/[book]/[chapter]' as const, params: { book: String(r.book), chapter: String(r.chapter), v: r.v1 ? String(r.v1) : '', v2: r.v2 && r.v1 && r.v2 > r.v1 ? String(r.v2) : '' } })

interface Props { text: string; style?: StyleProp<TextStyle>; /** Style of an italic run: from face(font, { italic: true }), so a custom italic face is named as its own family and never combined with fontStyle italic (Android then falls back to the system italic). */ italicStyle?: TextStyle; onNavigate?: (r: Ref) => void; /** The chapter the note sits in: resolves "ch. 5:25" and "ver. 15". */ context?: RefContext; /** Opens an `<a href>` run (a dictionary "See X"); without it those runs are plain text. */ onLink?: (href: string) => void }

/**
 * Footnote body: transliterations arrive as `<i>…</i>` and are set in italics, scripture references
 * ("Isa 34:11", "Gen 9:26") become links into the reader. Renders inline, so it can sit inside another Text.
 */
export default memo(function FootnoteText({ text, style, italicStyle, onNavigate, context, onLink }: Props) {
  const router = useRouter()
  const colors = usePageInks()
  const cb = context?.book, cc = context?.chapter
  // scan on the tag-free text so a tag never splits a reference; italics are re-applied per character range
  const parsed = useMemo(() => {
    const runs = inlineRuns(text)
    const plain = runs.map(r => r.text).join('')
    return { runs, plain, refs: scanRefs(plain, cb !== undefined && cc !== undefined ? { book: cb, chapter: cc } : undefined) }
  }, [text, cb, cc])
  const nodes = useMemo(() => {
    const { runs, plain, refs } = parsed
    const go = (r: Ref) => { if (onNavigate) onNavigate(r); else router.push(refParams(r)) }
    const out: React.ReactNode[] = []
    let offset = 0
    runs.forEach((run, ri) => {
      const start = offset, end = offset + run.text.length
      offset = end
      const runStyle: TextStyle = run.italic ? (italicStyle ?? { fontStyle: 'italic' }) : {}
      if (run.link && onLink) {
        const href = run.link
        out.push(<Text key={`${ri}.a`} style={[runStyle, { color: colors.accent, textDecorationLine: 'underline' }]} accessibilityRole="link" onPress={() => onLink(href)}>{run.text}</Text>)
        return
      }
      let cursor = start
      for (const ref of refs) {
        const s = Math.max(ref.start, start), e = Math.min(ref.end, end)
        if (e <= s) continue
        if (s > cursor) out.push(<Text key={`${ri}.${cursor}`} style={runStyle}>{plain.slice(cursor, s)}</Text>)
        out.push(
          <Text key={`${ri}.r${s}`} style={[runStyle, { color: colors.accent, textDecorationLine: 'underline' }]} accessibilityRole="link" onPress={() => go(ref.ref)}>
            {plain.slice(s, e)}
          </Text>,
        )
        cursor = e
      }
      if (cursor < end) out.push(<Text key={`${ri}.${cursor}`} style={runStyle}>{plain.slice(cursor, end)}</Text>)
    })
    return out
  }, [parsed, italicStyle, colors.accent, onNavigate, onLink, router])
  return <Text style={style}>{nodes}</Text>
})
