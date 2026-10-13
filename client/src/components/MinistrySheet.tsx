import { useEffect, useRef, useState } from 'react'
import { ScrollView, Text, useWindowDimensions, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { isWholeChapter, paragraphAnchors, paragraphFor, paragraphsOf, sectionForVerse, workLine, type AuthorId, type ChapterText } from '@shared/companion'
import { MINISTRY_AUTHORS, type MinistryGroup, type MinistryItem } from '@shared/ministry'
import { formatVerseRuns } from '@shared/ref'
import { loadCompanionChapter } from '../lib/companion'
import { loadMinistryRefs, ministryUnavailable } from '../lib/ministry'
import { book as bookMeta } from '../lib/bible'
import { TURN_DX } from '../lib/motionTiming'
import { useReadingFont } from '../hooks/useReadingFont'
import { useInks } from '../hooks/useTheme'
import { FadeSwap, Stagger } from './motion/nav'
import Pager from './Pager'
import { Card, ErrorText, Segmented, Sheet, Spinner, T, Tap, TYPE, useSheetWait } from './ui'
import { tourRef } from '../store/tour'

/**
 * What the sheet is on: the verses selected (the index of every author's writings: GET /api/ministry/refs), or the
 * chapter (the sections that go through it: Darby's Synopsis, Coates's Outlines and addresses), opened at the paragraph
 * for `verse`, the one selected or at the top of the screen.
 */
export type MinistryScope =
  | { kind: 'verse'; book: number; chapter: number; verses: readonly number[] }
  | { kind: 'chapter'; book: number; chapter: number; verse: number; text?: ChapterText['verses']; authors: readonly AuthorId[] }

/** The sheet stands at its full 80% from the first frame, so a list arriving (or another author's) never resizes it:
 * the window's share less the grab bar and title above it, the authors' segments when there are two, the inset and
 * margin below. */
const SHEET_SHARE = 0.8, HEADER_PX = 60, SEGMENTS_PX = 56, FOOT_PX = 12
/** The author last chosen, for this launch: a reader who turns to Coates finds Coates next time. */
let lastAuthor: string | null = null

/** A chapter's sections as items: the paragraph for the verse, its opening lines as the snippet. */
async function chapterGroups(s: Extract<MinistryScope, { kind: 'chapter' }>): Promise<MinistryGroup[] | null> {
  const loaded = await Promise.all(s.authors.map(a => loadCompanionChapter(a, s.book, s.chapter)))
  if (loaded.every(r => r === null)) return null
  return s.authors.flatMap((a, k) => {
    const readings = loaded[k]
    if (!readings?.length) return []
    const meta = MINISTRY_AUTHORS.find(x => x.id === a)!
    // the reading for the verse first, the rest in their order
    const first = sectionForVerse(readings, s.book, s.chapter, s.verse)
    const ordered = first > 0 ? [readings[first], ...readings.filter((_, i) => i !== first)] : readings
    const items: MinistryItem[] = ordered.map(r => {
      const paras = paragraphsOf(r.section.text)
      const anchors = paragraphAnchors(paras.map(p => p.lines.join(' ')), r.section.passages, s.text ? { chapter: s.chapter, verses: s.text } : undefined)
      const para = paragraphFor(anchors, s.chapter, s.verse)
      // the words shown are the first prose from there: a sub-heading (a paragraph wholly in italics) says too little
      const heading = (k: number) => /^<i>[^]*<\/i>$/.test(paras[k].lines.join(' ').trim()) && !/<\/i>.*<i>/.test(paras[k].lines.join(' '))
      let shown = para
      while (shown < paras.length - 1 && heading(shown)) shown++
      const plain = (paras[shown]?.lines.join(' ') ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      return {
        work: { id: r.work.id, title: workLine(r), collection: '' }, n: r.n, para, mention: 'verse',
        // a section that is exactly this chapter repeats the sheet's title: its work line says enough
        section: isWholeChapter(r.section.passages, s.book, s.chapter) ? '' : r.section.title,
        snippet: lead(plain), hl: [0, 0],
      }
    })
    return [{ author: a, name: meta.name, short: meta.short, source: meta.source, total: items.length, page: 1, pages: 1, items }]
  })
}
/** About 200 characters from the start, cut between words. */
function lead(text: string, size = 200): string {
  if (text.length <= size) return text
  const cut = text.lastIndexOf(' ', size)
  return `${text.slice(0, cut > 0 ? cut : size).replace(/[\s,;:—–-]+$/, '')}…`
}

/**
 * Ministry on the text: one sheet, two scopes. From the selection bar, what every author wrote on the verses selected,
 * best first (the index's order), a page at a time; from the reader's More, the sections going through the chapter.
 * The authors are quiet segments, Darby first. Each item names its work and section and shows the words around the
 * reference; a tap opens it in the library's reader at that paragraph, with the way back to the verse.
 */
export default function MinistrySheet({ open, scope, onClose }: { open: boolean; scope: MinistryScope | null; onClose: () => void }) {
  // the sheet keeps showing what it showed while it slides away; each opening starts afresh
  const shown = useRef<{ scope: MinistryScope | null; n: number }>({ scope, n: 0 })
  const wasOpen = useRef(false)
  if (open && !wasOpen.current && scope) shown.current = { scope, n: shown.current.n + 1 }
  wasOpen.current = open
  const s = shown.current.scope
  const title = !s ? '' : s.kind === 'verse' ? formatVerseRuns(s.book, s.chapter, s.verses) : `${bookMeta(s.book).name} ${s.chapter}`
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {s && shown.current.n ? <Lists key={shown.current.n} scope={s} onClose={onClose} /> : null}
    </Sheet>
  )
}

function Lists({ scope, onClose }: { scope: MinistryScope; onClose: () => void }) {
  const router = useRouter()
  const { height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  // rows mount when their list lands: they wait for the sheet only while it is still rising
  const wait = useSheetWait()
  const scroll = useRef<ScrollView>(null)
  /** Every author's first page (undefined while loading, null when it cannot be had), then each author's page as turned. */
  const [groups, setGroups] = useState<MinistryGroup[] | null | undefined>(undefined)
  const [author, setAuthor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 0 until the reader turns something: the first list enters once the sheet is up, later ones lead in from their side
  const [dir, setDir] = useState(0)
  useEffect(() => {
    let on = true
    const load = scope.kind === 'verse' ? loadMinistryRefs(scope.book, scope.chapter, scope.verses).then(r => r?.groups ?? null) : chapterGroups(scope)
    void load.then(g => {
      if (!on) return
      setGroups(g)
      if (g?.length) setAuthor(lastAuthor && g.some(x => x.author === lastAuthor) ? lastAuthor : g[0].author)
    })
    return () => { on = false }
  }, [scope])
  const group = groups?.find(g => g.author === author)
  const pick = (a: string) => {
    if (!groups || a === author) return
    setDir(groups.findIndex(g => g.author === a) > groups.findIndex(g => g.author === author) ? 1 : -1)
    lastAuthor = a
    setAuthor(a)
    scroll.current?.scrollTo({ y: 0, animated: false })
  }
  const turn = async (page: number) => {
    if (!group || scope.kind !== 'verse' || busy) return
    setBusy(true)
    const r = await loadMinistryRefs(scope.book, scope.chapter, scope.verses, group.author, page)
    setBusy(false)
    const next = r?.groups[0]
    if (!next) return
    setDir(page > group.page ? 1 : -1)
    setGroups(gs => gs?.map(g => g.author === next.author ? next : g))
    scroll.current?.scrollTo({ y: 0, animated: false })
  }
  const from = scope.kind === 'verse'
    ? `${scope.book}.${scope.chapter}.${scope.verses[0]}${scope.verses.length > 1 ? `-${scope.verses[scope.verses.length - 1]}` : ''}`
    : `${scope.book}.${scope.chapter}.${scope.verse}`
  const openItem = (g: MinistryGroup, item: MinistryItem) => {
    onClose()
    router.push({ pathname: '/companion', params: { author: g.author, work: item.work.id, n: String(item.n), p: String(item.para), from } })
  }
  const two = !!groups && groups.length > 1
  const body = groups === undefined ? <Spinner /> : groups === null ? <ErrorText>{ministryUnavailable}</ErrorText>
    : !group ? <T muted>{scope.kind === 'verse' ? 'Nothing on this verse yet.' : 'Nothing on this chapter yet.'}</T> : (
      <>
        <FadeSwap k={`${group.author}#${group.page}`} dx={dir * TURN_DX}>
          <Card style={{ gap: 0, paddingVertical: 4 }}>
            {group.items.map((item, i) => (
              <Stagger key={`${item.work.id}/${item.n}/${item.para}/${item.note ?? 0}`} index={i} base={dir ? 0 : wait()}>
                <Item item={item} divided={i > 0} onPress={() => openItem(group, item)} />
              </Stagger>
            ))}
          </Card>
        </FadeSwap>
        {group.pages > 1 ? <Pager page={group.page} pages={group.pages} busy={busy} onPage={p => void turn(p)} /> : null}
        <T small muted>{group.source}</T>
      </>
    )
  return (
    // the full tour points at the whole of it: the authors and their list
    <View ref={tourRef('ministry-sheet')}>
      {/* the authors stay in view above the list, however far it has scrolled */}
      {two ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, height: SEGMENTS_PX }}>
          <Segmented value={author ?? groups[0].author} options={groups.map(g => ({ value: g.author, label: g.short }))} onChange={pick} />
        </View>
      ) : null}
      <ScrollView ref={scroll} style={{ height: Math.round(height * SHEET_SHARE) - HEADER_PX - (two ? SEGMENTS_PX : 0) - FOOT_PX - insets.bottom }} contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 14 }}>
        {body}
      </ScrollView>
    </View>
  )
}

/** One paragraph on the verse: where it is (work, section), then its words around the reference, the reference in the accent. */
function Item({ item, divided, onPress }: { item: MinistryItem; divided: boolean; onPress: () => void }) {
  const c = useInks()
  const f = useReadingFont(17, 1.3)
  const q = useReadingFont(16, 1.5)
  const [a, b] = item.hl
  // the Synopsis's works are its books: "Synopsis · John", as the companion names them
  const work = item.work.collection === 'synopsis' ? `Synopsis · ${item.work.title}` : item.work.title
  const label = [work, item.section].filter(Boolean).join(', ')
  return (
    <Tap onPress={onPress} scaleTo={0.985} accessibilityRole="link" accessibilityLabel={`${label}: ${item.snippet}`}
      style={{ paddingVertical: 12, gap: 4, borderTopWidth: divided ? 1 : 0, borderTopColor: c.border }}>
      <Text numberOfLines={1} style={{ color: c.muted, fontSize: TYPE.small }}>{work}</Text>
      {item.section ? <Text numberOfLines={2} style={{ color: c.text, ...f.body, ...f.bold }}>{item.section}</Text> : null}
      <Text style={{ color: c.text, ...q.body }}>
        {item.snippet.slice(0, a)}
        {b > a ? <Text style={{ color: c.accent, ...q.bold }}>{item.snippet.slice(a, b)}</Text> : null}
        {item.snippet.slice(b)}
      </Text>
    </Tap>
  )
}

