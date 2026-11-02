import { useEffect, useRef, useState } from 'react'
import { Platform, ScrollView, Text, useWindowDimensions, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BOOKS } from '@shared/books'
import { isWholeChapter, paragraphAnchors, paragraphFor, paragraphsOf, sectionForVerse, workLine, type AuthorId, type ChapterText } from '@shared/companion'
import { MINISTRY_AUTHORS, type MinistryGroup, type MinistryItem, type Near } from '@shared/ministry'
import { formatRef, formatVerseRuns, type Ref } from '@shared/ref'
import type { Verse } from '@shared/types'
import { t, tc, tn } from '@shared/i18n'
import { fetchChapter, peekChapter, tokenize, type ChapterData } from '../lib/bible'
import { loadCompanionChapter } from '../lib/companion'
import { peekEdition } from '../lib/editionCore'
import { loadMinistryRefs, ministryUnavailable } from '../lib/ministry'
import { askable, pickedPhrase, pickedSpan, pickWords, type WordPick } from '../lib/ministryShared'
import { TURN_DX } from '../lib/motionTiming'
import { face } from '../theme'
import { useReadingFont } from '../hooks/useReadingFont'
import { useInks } from '../hooks/useTheme'
import { FadeSwap, Stagger } from './motion/nav'
import Pager from './Pager'
import { Button, Card, Enter, ErrorText, Segmented, Sheet, Spinner, T, Tap, tick, TYPE, useSheetWait } from './ui'
import type { WordAt } from './WordSheet'
import { tourRef } from '../store/tour'

/**
 * What the sheet is on: the verses selected (the index of every author's writings: GET /api/ministry/refs), or the
 * chapter (the sections that go through it: Darby's Synopsis, Coates's Outlines and addresses), opened at the paragraph
 * for `verse`, the one selected or at the top of the screen. `pick`: words of the verses already picked (the word sheet's
 * way on, at the word tapped).
 */
export type MinistryScope =
  | { kind: 'verse'; book: number; chapter: number; verses: readonly number[]; author?: string; pick?: WordPick }
  | { kind: 'chapter'; book: number; chapter: number; verse: number; text?: ChapterText['verses']; authors: readonly AuthorId[]; author?: string }

/**
 * What the sheet stands over. Over the Bible reader an item opens the ministry with the way back to the verse. Over the
 * ministry reader (a reference in its text) an item opens another reading on top of it, Back returning to this one,
 * and `read` takes the verses to the Bible, as the reference did before.
 */
export type MinistryOrigin = { kind: 'bible' } | { kind: 'ministry'; read: (r: Ref) => void }
const OVER_BIBLE: MinistryOrigin = { kind: 'bible' }

/** The sheet stands at its full 80% from the first frame, so a list arriving (or another author's) never resizes it:
 * the window's share less the grab bar and title above it, the authors' segments when there are two, the inset and
 * margin below. */
const SHEET_SHARE = 0.8, HEADER_PX = 60, SEGMENTS_PX = 56, FOOT_PX = 12
/** The author last chosen, for this launch: a reader who turns to Coates finds Coates next time. */
let lastAuthor: string | null = null
/** The verses' words are shown to pick from for a selection of up to this many: a whole chapter (a jotting's "JND on
 *  John 3") would push the list off the sheet. */
const WORD_VERSES = 5
/** The verses' words, in the reading font. */
const WORDS_PX = 18

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
/** Where an item opens: the library's reader at its paragraph, with `from` the verse its Back returns to. */
const reading = (author: string, item: MinistryItem, from?: string) => ({ pathname: '/companion' as const, params: { author, work: item.work.id, n: String(item.n), p: String(item.para), ...(from ? { from } : null) } })
/** About 200 characters from the start, cut between words. */
function lead(text: string, size = 200): string {
  if (text.length <= size) return text
  const cut = text.lastIndexOf(' ', size)
  return `${text.slice(0, cut > 0 ? cut : size).replace(/[\s,;:—–-]+$/, '')}…`
}

/**
 * Ministry on the text: one sheet, two scopes. From the selection bar (or a reference in the ministry), what every
 * author wrote on the verses selected, best first (the index's order), a page at a time, under the verses' own words:
 * a word or a run of them picked there turns the list into the paragraphs that have those words, nearest the verses
 * first. From the reader's More, the sections going through the chapter. The authors are quiet segments, Darby first.
 * Each item names its work and section and shows the words around the reference (or the words picked); a tap opens it
 * in the library's reader at that paragraph (see MinistryOrigin for the way back).
 */
export default function MinistrySheet({ open, scope, origin = OVER_BIBLE, onClose }: { open: boolean; scope: MinistryScope | null; origin?: MinistryOrigin; onClose: () => void }) {
  // the sheet keeps showing what it showed while it slides away; each opening starts afresh
  const shown = useRef<{ scope: MinistryScope | null; n: number }>({ scope, n: 0 })
  const wasOpen = useRef(false)
  if (open && !wasOpen.current && scope) shown.current = { scope, n: shown.current.n + 1 }
  wasOpen.current = open
  const s = shown.current.scope
  const title = !s ? '' : s.kind === 'verse' ? formatVerseRuns(s.book, s.chapter, s.verses) : formatRef({ book: s.book, chapter: s.chapter })
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {s && shown.current.n ? <Lists key={shown.current.n} scope={s} origin={origin} onClose={onClose} /> : null}
    </Sheet>
  )
}

function Lists({ scope, origin, onClose }: { scope: MinistryScope; origin: MinistryOrigin; onClose: () => void }) {
  const router = useRouter()
  const { height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  // rows mount when their list lands: they wait for the sheet only while it is still rising
  const wait = useSheetWait()
  const scroll = useRef<ScrollView>(null)
  const verses = useVerseWords(scope)
  const [picked, setPicked] = useState<WordPick | null>(scope.kind === 'verse' ? scope.pick ?? null : null)
  const q = picked && verses ? pickedText(verses, picked) : ''
  /** The list for the words it was asked with ('' the verses' own): every author's first page (null when it cannot be
   *  had), then each author's page as turned. While another pick's list is on its way the spinner shows. */
  const [loaded, setLoaded] = useState<{ q: string; groups: MinistryGroup[] | null } | null>(null)
  const groups = loaded && loaded.q === q ? loaded.groups : undefined
  // the authors' segments stay as they were while the next list is on its way, so the list does not jump under them
  const authors = groups ?? loaded?.groups
  const [author, setAuthor] = useState<string | null>(null)
  /** The author the reader turned to in this sheet: words one of them never uses show another, Clear brings it back. */
  const chosen = useRef<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Counts the picks: a page turned for the words before one lands nowhere. */
  const picks = useRef(0)
  // 0 until the reader turns something: the first list enters once the sheet is up, later ones lead in from their side
  const [dir, setDir] = useState(0)
  // the authors' segments take a second row when they do not fit one (six authors on a phone); the list gives way
  const [segmentsPx, setSegmentsPx] = useState(SEGMENTS_PX)
  useEffect(() => {
    let on = true
    const load = scope.kind === 'verse' ? loadMinistryRefs(scope.book, scope.chapter, scope.verses, { q }).then(r => r?.groups ?? null) : chapterGroups(scope)
    void load.then(g => {
      if (!on) return
      setLoaded({ q, groups: g })
      // the one turned to, else the author asked for (a jotting's "JND on John 3"), else the one last chosen, else the first
      const want = [chosen.current, scope.author, lastAuthor].find(a => a && g?.some(x => x.author === a))
      if (g?.length) setAuthor(want ?? g[0].author)
    })
    return () => { on = false }
  }, [scope, q])
  const group = groups?.find(g => g.author === author)
  const pick = (a: string) => {
    if (!groups || a === author) return
    setDir(groups.findIndex(g => g.author === a) > groups.findIndex(g => g.author === author) ? 1 : -1)
    lastAuthor = chosen.current = a
    setAuthor(a)
    scroll.current?.scrollTo({ y: 0, animated: false })
  }
  const setWords = (next: WordPick | null) => {
    picks.current++
    setBusy(false)
    setDir(0)
    setPicked(next)
  }
  const pickWord = (verse: number, wi: number, word: string) => {
    const next = pickWords(picked, verse, wi, word)
    if (next === picked) return
    tick()
    setWords(next)
  }
  const turn = async (page: number) => {
    if (!group || scope.kind !== 'verse' || busy) return
    const at = picks.current
    setBusy(true)
    const r = await loadMinistryRefs(scope.book, scope.chapter, scope.verses, { author: group.author, page, q })
    if (picks.current !== at) return
    setBusy(false)
    const next = r?.groups[0]
    if (!next) return
    setDir(page > group.page ? 1 : -1)
    setLoaded(l => l && { q: l.q, groups: l.groups?.map(g => g.author === next.author ? next : g) ?? null })
    scroll.current?.scrollTo({ y: 0, animated: false })
  }
  const from = scope.kind === 'verse'
    ? `${scope.book}.${scope.chapter}.${scope.verses[0]}${scope.verses.length > 1 ? `-${scope.verses[scope.verses.length - 1]}` : ''}`
    : `${scope.book}.${scope.chapter}.${scope.verse}`
  const openItem = (g: MinistryGroup, item: MinistryItem) => {
    onClose()
    router.push(reading(g.author, item, origin.kind === 'bible' ? from : undefined))
  }
  const two = !!authors && authors.length > 1
  const body = groups === undefined ? <Spinner />
    : groups === null ? <ErrorText>{q ? t('Finding words in the ministry needs a connection to the server.') : t(ministryUnavailable)}</ErrorText>
    : !group ? <T muted>{q ? t('Nothing in the ministry has these words.') : scope.kind === 'verse' ? t('Nothing on this verse yet.') : t('Nothing on this chapter yet.')}</T> : (
      <>
        <FadeSwap k={`${q}|${group.author}#${group.page}`} dx={dir * TURN_DX} style={{ gap: 14 }}>
          {runsByNear(group.items).map(run => (
            <View key={`${run.near ?? ''}${run.at}`} style={{ gap: 8 }}>
              {run.near && scope.kind === 'verse' ? <T small muted bold accessibilityRole="header" style={{ paddingHorizontal: 4 }}>{nearHeading(scope, run.near)}</T> : null}
              <Card style={{ gap: 0, paddingVertical: 4 }}>
                {run.items.map((item, i) => (
                  <Stagger key={`${item.work.id}/${item.n}/${item.para}/${item.note ?? 0}`} index={run.at + i} base={dir ? 0 : wait()}>
                    <Item item={item} divided={i > 0} onPress={() => openItem(group, item)} />
                  </Stagger>
                ))}
              </Card>
            </View>
          ))}
        </FadeSwap>
        {group.pages > 1 ? <Pager page={group.page} pages={group.pages} busy={busy} onPage={p => void turn(p)} /> : null}
        <T small muted>{group.source}</T>
      </>
    )
  const read = origin.kind === 'ministry' && scope.kind === 'verse' ? {
    label: t('Read {passage}', { passage: formatVerseRuns(scope.book, scope.chapter, scope.verses) }),
    go: () => {
      const [v1, v2] = [Math.min(...scope.verses), Math.max(...scope.verses)]
      onClose()
      origin.read({ book: scope.book, chapter: scope.chapter, v1, v2: v2 > v1 ? v2 : undefined })
    },
  } : null
  const words = verses?.length ? verses : null
  return (
    // the full tour points at the whole of it: the authors and their list
    <View ref={tourRef('ministry-sheet')}>
      {/* the authors stay in view above the list, however far it has scrolled */}
      {two ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, minHeight: SEGMENTS_PX }} onLayout={e => setSegmentsPx(Math.max(SEGMENTS_PX, Math.round(e.nativeEvent.layout.height)))}>
          <Segmented value={author ?? authors[0].author} options={authors.map(g => ({ value: g.author, label: g.short }))} onChange={pick} />
        </View>
      ) : null}
      <ScrollView ref={scroll} style={{ height: Math.round(height * SHEET_SHARE) - HEADER_PX - (two ? segmentsPx : 0) - FOOT_PX - insets.bottom }} contentContainerStyle={{ padding: 16, paddingTop: 8, gap: 14 }}>
        {words || read ? (
          <Stagger index={0} base={wait()} style={{ gap: 10 }}>
            {words ? <VerseWords verses={words} picked={picked} onWord={pickWord} /> : null}
            {/* as high as the Clear it gains, so a pick does not move the list */}
            {words ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 36 }}>
                <T small muted style={{ flex: 1 }}>{q ? t('Paragraphs with “{words}”', { words: q }) : t('Tap a word to find it in the ministry; tap another for a phrase')}</T>
                {q ? <Button small lead="x" title={tc('verb', 'Clear')} accessibilityLabel={t('Clear the search')} onPress={() => setWords(null)} /> : null}
              </View>
            ) : null}
            {read ? <Button small lead="book" title={read.label} onPress={read.go} style={{ alignSelf: 'flex-start' }} /> : null}
          </Stagger>
        ) : null}
        {body}
      </ScrollView>
    </View>
  )
}

/** How many of the first author's paragraphs the word sheet shows. */
const WORD_ITEMS = 3

/**
 * The word sheet's part at a word tapped in the Bible: where the ministry uses the word, as Ministry on the verse lists
 * it with the word picked (the first author's first paragraphs, nearest the verse first), how many paragraphs and
 * authors have it, and the way on to that sheet (`onMore`). Quiet while it loads and when nothing has the word (or it
 * is a small word, never asked alone); words are found only by the server, so with no connection one line says so.
 */
export function WordInMinistry({ word, at, onClose, onMore }: { word: string; at: WordAt; onClose: () => void; onMore?: (scope: MinistryScope) => void }) {
  const router = useRouter()
  const { book, chapter, verse } = at
  const asked = `${book}.${chapter}.${verse}|${word}`
  /** The authors with the word, by what was asked (null when it cannot be had): an answer for another word never shows. */
  const [found, setFound] = useState<{ asked: string; groups: MinistryGroup[] | null } | null>(null)
  useEffect(() => {
    if (!askable(word)) return
    let on = true
    void loadMinistryRefs(book, chapter, [verse], { q: word }).then(r => { if (on) setFound({ asked, groups: r?.groups ?? null }) })
    return () => { on = false }
  }, [book, chapter, verse, word, asked])
  const groups = askable(word) && found?.asked === asked ? found.groups : undefined
  if (groups === undefined) return null
  if (groups === null) return <View testID="word-ministry"><Enter><T small muted>{t('Finding words in the ministry needs a connection to the server.')}</T></Enter></View>
  const g = groups[0]
  if (!g) return null
  const scope = { kind: 'verse' as const, book, chapter, verses: [verse], author: g.author, pick: { verse, from: at.wi, to: at.wi } }
  const others = groups.length - 1
  const uses = tn(g.total, '{author} uses it in {n} paragraph.', '{author} uses it in {n} paragraphs.', { author: g.short, n: g.total.toLocaleString() })
  return (
    <View testID="word-ministry"><Enter style={{ gap: 8 }}>
      <T small muted>{t('In the ministry')}</T>
      <View style={{ gap: 14 }}>
        {runsByNear(g.items.slice(0, WORD_ITEMS)).map(run => (
          <View key={`${run.near ?? ''}${run.at}`} style={{ gap: 8 }}>
            {run.near ? <T small muted bold accessibilityRole="header" style={{ paddingHorizontal: 4 }}>{nearHeading(scope, run.near)}</T> : null}
            <Card style={{ gap: 0, paddingVertical: 4 }}>
              {run.items.map((item, i) => (
                <Item key={`${item.work.id}/${item.n}/${item.para}/${item.note ?? 0}`} item={item} divided={i > 0}
                  onPress={() => { onClose(); router.push(reading(g.author, item, `${book}.${chapter}.${verse}`)) }} />
              ))}
            </Card>
          </View>
        ))}
      </View>
      <T small muted>{others ? `${uses} ${tn(others, '{n} other author uses it too.', '{n} other authors use it too.', { n: others.toLocaleString() })}` : uses}</T>
      {onMore ? <Button small lead="companion" title={t('Ministry on {ref}', { ref: formatVerseRuns(book, chapter, [verse]) })} onPress={() => onMore(scope)} style={{ alignSelf: 'flex-start' }} /> : null}
    </Enter></View>
  )
}

/** The selected verses as the reader reads them (the edition shown; the ministry is English, so not another language's
 *  Bible): the chapter as held, else as stored or fetched. Null until it is had, when it cannot be, and for a chapter or
 *  a selection longer than WORD_VERSES. */
function useVerseWords(scope: MinistryScope): readonly Verse[] | null {
  const inScope = (c: ChapterData | undefined) => scope.kind === 'verse' && scope.verses.length <= WORD_VERSES && c ? c.verses.filter(v => scope.verses.includes(v.v)) : null
  const [verses, setVerses] = useState(() => inScope(peekChapter(scope.book, scope.chapter, peekEdition())))
  const had = !!verses
  useEffect(() => {
    if (had || scope.kind !== 'verse' || scope.verses.length > WORD_VERSES) return
    let on = true
    void fetchChapter(scope.book, scope.chapter, peekEdition()).then(c => { if (on) setVerses(inScope(c)) }, () => {})
    return () => { on = false }
  }, [scope, had])  // eslint-disable-line react-hooks/exhaustive-deps
  return verses
}

/** The words picked in the verse they are in, as asked for (`pickedPhrase`: a word split at a ligature asked whole). */
const pickedText = (verses: readonly Verse[], p: WordPick) => {
  const v = verses.find(x => x.v === p.verse)
  return v ? pickedPhrase(tokenize(v), p) : ''
}

/** A page's items in runs of one `near`, each run to go under its heading (the first item of a page starts one). In a
 *  list that is not of words, the paragraphs on the whole chapter, which come after every one on the verses, are a run
 *  under the chapter's heading, the rest one run with none. `at`: the run's first item's place on the page. */
function runsByNear(items: readonly MinistryItem[]): { near?: Near; at: number; items: MinistryItem[] }[] {
  const runs: { near?: Near; at: number; items: MinistryItem[] }[] = []
  items.forEach((item, i) => {
    const near = item.near ?? (item.mention === 'chapter' ? 'chapter' : undefined)
    const last = runs[runs.length - 1]
    if (last && last.near === near) last.items.push(item)
    else runs.push({ near, at: i, items: [item] })
  })
  return runs
}
/** "On Genesis 6:2", "On Genesis 6", "On Genesis", "Elsewhere": how near the paragraphs under it stand to the verses. */
function nearHeading(s: Extract<MinistryScope, { kind: 'verse' }>, near: Near): string {
  switch (near) {
    case 'verse': return t('On {ref}', { ref: formatVerseRuns(s.book, s.chapter, s.verses) })
    case 'chapter': return t('On {ref}', { ref: formatRef({ book: s.book, chapter: s.chapter }) })
    case 'book': return t('On {ref}', { ref: BOOKS[s.book - 1].refName })
    case 'elsewhere': return t('Elsewhere')
  }
}

/** The verses' words, each a tap (a number before each verse when there are several); the words picked, what lies
 *  between them and the letters a word split at a ligature is joined by, in the accent: what is asked for
 *  (`pickedSpan`). A single Text, as the reader's verses are, so the words wrap as prose. */
function VerseWords({ verses, picked, onWord }: { verses: readonly Verse[]; picked: WordPick | null; onWord: (verse: number, wi: number, word: string) => void }) {
  const c = useInks()
  const f = useReadingFont(WORDS_PX, 1.5)
  const accent = { color: c.accent }
  return (
    <Text style={{ color: c.text, ...f.body }}>
      {verses.map((v, k) => {
        const toks = tokenize(v)
        const span = picked?.verse === v.v ? pickedSpan(toks, picked) : null
        let end = 0
        return (
          <Text key={v.v}>
            {verses.length > 1 ? <Text style={{ color: c.accent, ...NUMBER }}>{k ? ' ' : ''}{v.v} </Text> : null}
            {toks.map((tk, i) => {
              const from = end
              end += tk.tok.length
              // the token's part in the span: all of a word; of what lies between words, all or the letters joined to one
              const a = span ? Math.max(span.start - from, 0) : 0, b = span ? Math.min(span.end - from, tk.tok.length) : 0
              const italic = tk.italic ? f.italic : null
              // what lies between words stays a plain string unless it is painted, as in the reader (ChapterView)
              return tk.word
                ? <Text key={i} style={[italic, b > a ? accent : null]} onPress={() => onWord(v.v, tk.wi, tk.tok)}>{tk.tok}</Text>
                : b > a ? <Text key={i} style={italic}>{tk.tok.slice(0, a)}<Text style={accent}>{tk.tok.slice(a, b)}</Text>{tk.tok.slice(b)}</Text>
                : tk.italic ? <Text key={i} style={italic}>{tk.tok}</Text> : tk.tok
            })}
          </Text>
        )
      })}
    </Text>
  )
}
/** A verse number as the reader sets it: sans bold at 0.58 em; on the web its own line height, so its line does not open
 *  up (ChapterView's inlineMark). */
const NUMBER_PX = WORDS_PX * 0.58
const NUMBER = { fontSize: NUMBER_PX, ...face('sans', { bold: true }), ...(Platform.OS === 'web' ? { lineHeight: Math.round(NUMBER_PX) } : null) }

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

