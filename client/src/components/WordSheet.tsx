import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { articlesFor, matchWord, paragraphs, sheetParts, type CbdEntry, type CbdMatch, type SheetPart } from '@shared/cbd'
import { bookPage, concordanceLine, groupByBook, OCCURRENCE_PAGE, renderingKey, type StrongsInfo, type StrongsOccurrence } from '@shared/concordance'
import type { Ref } from '@shared/ref'
import { get, isNetworkError } from '../lib/api'
import { book as bookMeta } from '../lib/bible'
import { glossaryTerm, type GlossarySource } from '@shared/glossary'
import { dictionaryOffline, loadDictionaryEntry, loadDictionaryIndex } from '../lib/dictionary'
import { darbyGlossary } from '../lib/glossary'
import { loadContents } from '../lib/ministryLibrary'
import { TURN_DX } from '../lib/motionTiming'
import { useDictionaryIndex } from '../hooks/useDictionaryIndex'
import { useReadingFont } from '../hooks/useReadingFont'
import { useInks } from '../hooks/useTheme'
import { face } from '../theme'
import DictionaryArticle, { ArticleWords, Headword } from './DictionaryArticle'
import Disclosure from './Disclosure'
import { refParams } from './FootnoteText'
import { FadeSwap, Stagger, STAGGER_CAP, useFreshList, useReduceMotion } from './motion/nav'
import Pager, { CountChip } from './Pager'
import { Button, Card, Chip, Enter, ErrorText, H2, Row, Segmented, Sheet, SPACE, Spinner, T, Tap, TYPE, useSheetWait } from './ui'
import { tourRef } from '../store/tour'

/** Per verse number: `[word, strongsCode]` in tokenizer word order (`""` when a word carries no tag). */
export type WordTags = Map<number, [string, string][]>

const tagCache = new Map<string, WordTags>()
/** Strong's tags are not in the offline chapter files; this is the only reader call that needs the API. */
export async function fetchWordTags(book: number, chapter: number): Promise<WordTags> {
  const k = `${book}.${chapter}`
  const hit = tagCache.get(k)
  if (hit) return hit
  const r = await get<{ verses: { v: number; words?: [string, string][] }[] }>(`/bible/${book}/${chapter}?words=1`)
  const m: WordTags = new Map()
  for (const v of r.verses) if (v.words?.length) m.set(v.v, v.words)
  tagCache.set(k, m)
  return m
}

/**
 * What the sheet opens on: a tapped word and its Strong's number (`code` "" when it carries none), or a number alone
 * (`word` "": a chip in a Dictionary article, `label` its Greek or Hebrew).
 */
export interface WordTarget { code: string; word: string; label?: string; /** Darby's own term the word matched (shared/glossary.ts): shown first */ term?: string }

/** A place inside the sheet: where it opened, a number's word study, an article. `label` names it on the way back. */
type Place = { kind: 'tap'; code: string; word: string; label: string; term?: string } | { kind: 'word'; code: string; label: string } | { kind: 'subject'; id: string; label: string }
interface Nav {
  push: (p: Place) => void
  /** leave the sheet for a verse */
  read: (r: Ref) => void
  search: (q: string) => void
  /** leave the sheet for a section of the ministry */
  ministry: (s: GlossarySource) => void
  /** scroll the place to `y` in its content (the occurrences' page turns) */
  scrollTo: (y: number) => void
  /** the numbers whose occurrences are open */
  opened: Set<string>
}

const WORD_HINT = (code: string) => `The ${code.startsWith('H') ? 'Hebrew' : 'Greek'} behind the English, and where it occurs`
const SUBJECT_HINT = 'What it is: a person, place, thing or teaching'

/**
 * The sheet for a word. Two parts, never mixed: the word (Strong's number: the Hebrew or Greek, how the King James
 * renders it, then every place Darby's text has it) and the subject (Morrish's article by English headword). A tagged
 * word opens on the word, the subject one tap away on the segmented pair at the top; any other word has the subject
 * alone (`sheetParts`). The
 * Greek and Hebrew in an article open their word study, and a word study lists the articles that discuss it: each
 * opens in place, with Back to return, one sheet throughout.
 */
export default function WordSheet({ target, onClose }: { target: WordTarget | null; onClose: () => void }) {
  const router = useRouter()
  // the sheet keeps showing what it showed while it slides away
  const last = useRef<WordTarget>({ code: '', word: '' })
  if (target) last.current = target
  const shown = last.current
  /** Scroll offsets of the places behind the current one, and the numbers whose occurrences are open, kept for the way back. */
  const ys = useRef<number[]>([])
  const opened = useRef(new Set<string>())
  // a new opening starts over at what was tapped
  const [opening, setOpening] = useState<WordTarget | null>(null)
  const [trail, setTrail] = useState<Place[]>([])
  const [dir, setDir] = useState(0)
  /** Which of the tapped word's two parts shows: the first `sheetParts` gives until the reader picks the other. */
  const [part, setPart] = useState<SheetPart>('word')
  if (target && target !== opening) { setOpening(target); setTrail([]); setDir(0); opened.current = new Set(); setPart(sheetParts(target.code, target.word)[0] ?? 'word') }
  const scroll = useRef<ScrollView>(null)
  const reduce = useReduceMotion()
  const root: Place = { kind: 'tap', code: shown.code, word: shown.word, label: shown.word || shown.label || shown.code, term: shown.term }
  const place = trail[trail.length - 1] ?? root
  const depth = trail.length
  const back = depth ? () => { setDir(-1); setTrail(t => t.slice(0, -1)) } : undefined
  const nav: Nav = {
    push: p => { ys.current = ys.current.slice(0, depth + 1); setDir(1); setTrail(t => [...t, p]) },
    read: r => { onClose(); router.push(refParams(r)) },
    search: q => { onClose(); router.push({ pathname: '/dictionary', params: { q } }) },
    ministry: s => { onClose(); router.push({ pathname: '/companion', params: { author: s.author, work: s.work, n: String(s.n) } }) },
    scrollTo: y => scroll.current?.scrollTo({ y: Math.max(0, y - SPACE.s), animated: !reduce }),
    opened: opened.current,
  }
  const parts = place.kind === 'tap' ? sheetParts(place.code, place.word) : []
  const showing: SheetPart = place.kind === 'tap' ? (parts.includes(part) ? part : parts[0] ?? 'word') : place.kind
  const pick = (p: SheetPart) => { if (p === showing) return; setDir(p === 'subject' ? 1 : -1); setPart(p) }
  const key = `${depth}:${place.kind === 'tap' ? `t:${place.code}:${place.word}:${showing}` : place.kind === 'word' ? `w:${place.code}` : `s:${place.id}`}`
  // set once per place: back at an earlier one, its content lays out again, then it returns to where it was left (as
  // far as the content reaches within a moment of arriving; never later, under a reader who has moved on)
  const restore = useRef({ key: '', y: 0, until: 0 })
  if (restore.current.key !== key) restore.current = { key, y: dir < 0 ? ys.current[depth] ?? 0 : 0, until: Date.now() + 1500 }
  return (
    <Sheet open={target !== null} onClose={onClose} onBack={back} title={shown.word || undefined}>
      {/* the pair stays put above the swap: its thumb slides while the part beneath turns like a page; the tour's
          spotlight holds both, the pair and the part */}
      <View ref={tourWord} style={{ flexShrink: 1 }}>
      {parts.length > 1 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Segmented<SheetPart> value={showing} onChange={pick} options={[{ value: 'word', label: 'Concordance' }, { value: 'subject', label: 'The subject' }]} />
        </View>
      ) : null}
      <FadeSwap k={key} dx={dir * TURN_DX} style={{ flexShrink: 1 }}>
        <ScrollView key={key} ref={el => { scroll.current = el }} style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 16, paddingTop: shown.word ? 8 : 16, gap: 10 }} scrollEventThrottle={100}
          onScroll={e => { ys.current[depth] = e.nativeEvent.contentOffset.y }}
          onContentSizeChange={(_, h) => { const r = restore.current; if (r.y && h > r.y && Date.now() < r.until) { scroll.current?.scrollTo({ y: r.y, animated: false }); r.y = 0 } }}>
          {/* back to the tapped word, which the sheet's title already names: plain "Back" */}
          {back ? <Button small lead="back" title={depth === 1 && shown.word ? 'Back' : (trail[depth - 2] ?? root).label} accessibilityLabel={`Back to ${(trail[depth - 2] ?? root).label}`} onPress={back} style={{ alignSelf: 'flex-start' }} /> : null}
          {place.kind === 'tap' && place.term ? <DarbyUsage term={place.term} nav={nav} /> : null}
          {place.kind === 'tap'
            ? showing === 'word' ? <WordPart code={place.code} paired={parts.length > 1} nav={nav} /> : <SubjectPart word={place.word} paired={parts.length > 1} nav={nav} />
            : place.kind === 'word' ? <WordPart code={place.code} nav={nav} />
            : <SubjectPart id={place.id} nav={nav} />}
        </ScrollView>
      </FadeSwap>
      </View>
    </Sheet>
  )
}

/** The full tour points at the sheet's contents: the word, and the subject beneath it. */
const tourWord = tourRef('word-sheet')

/**
 * Darby's usage, first in the sheet when the tapped word is one of his own terms (data/glossary/darby.json): the term
 * and a sentence on his sense of it, the sentence of his it rests on, and that sentence's place in the ministry as a
 * link into the library reader. The place is named once the work's contents are in (its title and the section's).
 */
function DarbyUsage({ term, nav }: { term: string; nav: Nav }) {
  const c = useInks()
  const f = useReadingFont(TYPE.body, 1.45)
  const entry = glossaryTerm(darbyGlossary(), term)
  const source = entry?.source
  const [place, setPlace] = useState('')
  useEffect(() => {
    if (!source) return
    let on = true
    void loadContents(source.author, source.work).then(cts => {
      if (!on || !cts) return
      const section = cts.sections[source.n - 1]?.title
      setPlace(section && section !== cts.work.title ? `${cts.work.title} · ${section}` : cts.work.title)
    })
    return () => { on = false }
  }, [source])
  if (!entry || !source) return null
  return (
    <View testID="darby-usage"><Enter style={{ gap: 6 }}>
      <T small muted>Darby’s usage</T>
      <Text style={{ color: c.text, ...f.body }}><Text style={f.bold}>{entry.term}</Text>{' — '}{entry.short}</Text>
      <Text style={{ color: c.muted, fontSize: TYPE.small, lineHeight: 21, ...f.italic }}>“{source.quote}”</Text>
      <Text accessibilityRole="link" accessibilityLabel={`Read it in the ministry: ${place || source.work}`} onPress={() => nav.ministry(source)} style={{ color: c.accent, fontSize: TYPE.small, lineHeight: 20 }}>
        {place || 'Read it in the ministry'} →
      </Text>
    </Enter></View>
  )
}

const strongsUrl = (code: string, page: number) => `/strongs/${encodeURIComponent(code)}?limit=${OCCURRENCE_PAGE}&offset=${(page - 1) * OCCURRENCE_PAGE}`
/** First pages by number: coming back to a word study shows it at once. */
const infoCache = new Map<string, StrongsInfo>()

/**
 * The word: what Strong gives for the number (the word, transliteration and pronunciation, the KJV renderings), the
 * articles that discuss it, then the occurrences in Darby's text by book, 30 verses a page. Everything lands together
 * once the entry and the dictionary's index are both in, so nothing is pushed down after it shows.
 */
function WordPart({ code, paired = false, nav }: { code: string; /** under the segmented pair, which names it */ paired?: boolean; nav: Nav }) {
  const index = useDictionaryIndex()
  const [info, setInfo] = useState<StrongsInfo | null>(() => infoCache.get(code) ?? null)
  const [err, setErr] = useState('')
  /** Pages of verses fetched so far, by page number; the first comes with the entry. */
  const [pages, setPages] = useState<Map<number, StrongsOccurrence[]>>(() => new Map(info ? [[1, info.page]] : []))
  const [page, setPage] = useState(1)
  const [dir, setDir] = useState(0)
  const [fetching, setFetching] = useState(false)
  const [pageErr, setPageErr] = useState('')
  const partY = useRef(0)
  const listY = useRef(0)
  useEffect(() => {
    if (infoCache.has(code)) return
    let cancelled = false
    get<StrongsInfo>(strongsUrl(code, 1)).then(i => {
      infoCache.set(code, i)
      if (!cancelled) { setInfo(i); setPages(new Map([[1, i.page]])) }
    }).catch(e => { if (!cancelled) setErr(isNetworkError(e) ? 'Strong’s entries need a connection; the dictionary works offline' : (e as Error).message || 'Could not load the entry') })
    return () => { cancelled = true }
  }, [code])
  const turn = async (to: number) => {
    if (to === page || fetching) return
    setPageErr('')
    // the pager sits under the list: bring the new page's first verse into view
    const show = () => { setDir(to > page ? 1 : -1); setPage(to); nav.scrollTo(partY.current + listY.current) }
    if (pages.has(to)) { show(); return }
    setFetching(true)
    try {
      const r = await get<StrongsInfo>(strongsUrl(code, to))
      setPages(m => new Map(m).set(to, r.page))
      show()
    } catch (e) { setPageErr((e as Error).message || 'Could not load the page') } finally { setFetching(false) }
  }
  const discussed = useMemo(() => index ? articlesFor(index, code) : [], [index, code])
  return (
    <View style={{ gap: 10 }} onLayout={e => { partY.current = e.nativeEvent.layout.y }}>
      {paired ? <T small muted>{WORD_HINT(code)}</T> : <H2 hint={WORD_HINT(code)}>The word</H2>}
      {err ? <ErrorText>{err}</ErrorText> : !info || index === undefined ? <Spinner /> : (
        <>
          <Enter><Identity info={info} /></Enter>
          {discussed.length ? (
            <Enter delay={40} style={{ gap: 8 }}>
              <T small muted>Discussed in the dictionary</T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {discussed.map(a => <Chip key={a.id} label={a.headword} onPress={() => nav.push({ kind: 'subject', id: a.id, label: a.headword })} />)}
              </View>
            </Enter>
          ) : null}
          <Enter delay={80} onLayout={e => { listY.current = e.nativeEvent.layout.y }}>
            <Occurrences info={info} page={page} verses={pages.get(page) ?? []} dir={dir} fetching={fetching} error={pageErr} onPage={p => { void turn(p) }} onOpen={o => nav.read({ book: o.book, chapter: o.chapter, v1: o.verse })}
              open={nav.opened.has(code)} onToggle={o => { if (o) nav.opened.add(code); else nav.opened.delete(code) }} />
          </Enter>
        </>
      )}
    </View>
  )
}

const SANS_BOLD = face('sans', { bold: true })

/** What Strong gives for the number: the word and its number, its transliteration and pronunciation, and its KJV renderings. */
function Identity({ info }: { info: StrongsInfo }) {
  const c = useInks()
  const f = useReadingFont(TYPE.body, 1.45)
  const key = renderingKey(info.kjv)
  if (!info.lemma) return <T muted>Strong’s concordance has no entry numbered {info.code}.</T>
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        {/* the word shrink-wrapped at the start: a Hebrew word alone would otherwise sit at the right, as right-to-left text does */}
        <Row style={{ gap: 10, flexWrap: 'nowrap' }}>
          <Text style={{ color: c.text, fontSize: 28, lineHeight: 38, flexShrink: 1 }}>{info.lemma}</Text>
          <View style={{ backgroundColor: c.accentSoft, borderRadius: 13, height: 26, paddingHorizontal: 10, justifyContent: 'center' }}>
            <Text style={{ color: c.accent, fontSize: TYPE.caption, ...SANS_BOLD }} accessibilityLabel={`Strong’s number ${info.code}`}>{info.code}</Text>
          </View>
        </Row>
        {info.translit || info.pron ? (
          <Text style={{ color: c.text, ...f.body }}>
            {info.translit ? <Text style={f.italic}>{info.translit}</Text> : null}
            {info.translit && info.pron ? ', ' : null}
            {info.pron ? <Text style={{ color: c.muted }} accessibilityLabel={`pronounced ${info.pron}`}>{info.pron}</Text> : null}
          </Text>
        ) : null}
      </View>
      {info.kjv ? (
        <View style={{ gap: 4 }}>
          <T small muted>Rendered in the King James Version</T>
          <Text style={{ color: c.text, ...f.body }}>{info.kjv}</Text>
          {key ? <Text style={{ color: c.muted, fontSize: TYPE.caption }}>{key}</Text> : null}
        </View>
      ) : null}
    </View>
  )
}

/** Darby's renderings shown before "and N more". */
const RENDERINGS = 8

/**
 * The concordance of Darby's text, folded to one line of totals that opens in place: how Darby renders the word, then
 * one page of verses cut into books (each with its count), the tagged word set apart in each; chips jump to a book
 * when the list runs to several pages.
 */
function Occurrences({ info, page, verses, dir, fetching, error, onPage, onOpen, open, onToggle }: {
  info: StrongsInfo; page: number; verses: StrongsOccurrence[]; dir: number; fetching: boolean; error: string
  onPage: (p: number) => void; onOpen: (o: StrongsOccurrence) => void; open: boolean; onToggle: (open: boolean) => void
}) {
  const c = useInks()
  const f = useReadingFont(15, 22 / 15)
  const pages = Math.max(1, Math.ceil(info.verses / OCCURRENCE_PAGE))
  const offset = (page - 1) * OCCURRENCE_PAGE
  const groups = useMemo(() => groupByBook(verses, info.books, offset), [verses, info.books, offset])
  const hebrew = info.code.startsWith('H')
  const count = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`
  const summary = !info.occurrences ? 'Not tagged anywhere in Darby’s text'
    : info.occurrences === info.verses ? count(info.occurrences, 'occurrence', 'occurrences')
    : `${count(info.occurrences, 'occurrence', 'occurrences')} in ${count(info.verses, 'verse', 'verses')}`
  const more = info.renderings.length - RENDERINGS
  // each page (once its verses are in) arrives with the house stagger, down its book headings and verses in turn
  const fresh = useFreshList(`${page}:${verses.length ? 1 : 0}`)
  const cap = fresh ? STAGGER_CAP : 0
  const wait = useSheetWait()
  const starts = groups.reduce<number[]>((a, g, i) => [...a, i ? a[i - 1] + 1 + groups[i - 1].items.length : 0], [])
  if (!info.occurrences) return <T small muted style={{ marginTop: 6 }}>{summary}</T>
  return (
    <Disclosure label={summary} defaultOpen={open} onToggle={onToggle}>
      {info.renderings.length ? (
        <Text style={{ color: c.muted, fontSize: TYPE.small, lineHeight: 20 }}>
          {'Darby renders it '}
          {info.renderings.slice(0, RENDERINGS).map(([w, n], i) => (
            <Text key={w}>{i ? ', ' : ''}<Text style={{ color: c.text, ...f.italic }}>{w}</Text>{` ${n.toLocaleString()}`}</Text>
          ))}
          {more > 0 ? `, and ${count(more, 'other way', 'other ways')}` : ''}
        </Text>
      ) : null}
      {pages > 1 && info.books.length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessibilityRole="tablist" accessibilityLabel="Books">
          {info.books.map(b => (
            <CountChip key={b.book} label={bookMeta(b.book).abbr} accessibilityLabel={bookMeta(b.book).name} count={b.occurrences} noun={['occurrence', 'occurrences']}
              on={groups[0]?.book === b.book} onPress={() => onPage(bookPage(info.books, b.book))} />
          ))}
        </View>
      ) : null}
      <FadeSwap k={page} dx={dir * TURN_DX}>
        <View style={{ gap: 12 }}>
          {groups.map((g, gi) => (
            <View key={g.book} style={{ gap: 6 }}>
              <Stagger index={starts[gi]} cap={cap} base={wait()}>
                <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                  <T small bold style={{ flexShrink: 1 }}>{bookMeta(g.book).name}{g.continued ? ', continued' : ''}</T>
                  <T small muted>{g.occurrences.toLocaleString()}</T>
                </Row>
              </Stagger>
              <Card style={{ gap: 0, paddingVertical: 6 }}>
                {g.items.map((o, i) => (
                  <Stagger key={`${o.chapter}.${o.verse}`} index={starts[gi] + 1 + i} cap={cap} base={wait()}>
                    <Tap onPress={() => onOpen(o)} scaleTo={0.985} accessibilityRole="link" accessibilityLabel={`Read ${bookMeta(o.book).name} ${o.chapter}:${o.verse}`}
                      style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
                      <Text style={{ color: c.text, ...f.body }}>
                        <Text style={{ color: c.accent, fontSize: TYPE.small, ...SANS_BOLD }}>{o.chapter}:{o.verse}</Text>
                        {'  '}
                        {concordanceLine(o.text, o.w).map((p, k) => p.hit ? <Text key={k} style={f.bold}>{p.text}</Text> : p.text)}
                      </Text>
                    </Tap>
                  </Stagger>
                ))}
              </Card>
            </View>
          ))}
        </View>
      </FadeSwap>
      {error ? <ErrorText>{error}</ErrorText> : null}
      {pages > 1 ? <Pager page={page} pages={pages} onPage={onPage} busy={fetching} /> : null}
      {hebrew ? <T small muted>Old Testament tags are aligned by machine, so this list can miss places the word occurs.</T> : null}
    </Disclosure>
  )
}

/** An article this long opens at its first paragraph, so the rest of the sheet stays in reach. */
const LONG_PARAS = 3, LONG_CHARS = 1400

type Subject = { entry: CbdEntry; matches: CbdMatch[] } | 'loading' | 'none' | 'unavailable'

/**
 * The subject: an article, `id`'s or the one headed by the tapped `word` (the other candidates follow as chips).
 * `paired`: under the segmented pair, which names it.
 */
function SubjectPart({ word = '', id, paired = false, nav }: { word?: string; id?: string; paired?: boolean; nav: Nav }) {
  const index = useDictionaryIndex()
  const [state, setState] = useState<Subject>('loading')
  const head = paired ? <T small muted>{SUBJECT_HINT}</T> : <H2 hint={SUBJECT_HINT}>The subject</H2>
  useEffect(() => {
    let cancelled = false
    setState('loading')
    void (async () => {
      if (id) { const entry = await loadDictionaryEntry(id); if (!cancelled) setState(entry ? { entry, matches: [] } : 'unavailable'); return }
      const loaded = await loadDictionaryIndex()
      if (cancelled) return
      if (!loaded) { setState('unavailable'); return }
      const matches = matchWord(loaded, word)
      if (!matches.length) { setState('none'); return }
      const entry = await loadDictionaryEntry(matches[0].id)
      if (!cancelled) setState(entry ? { matches, entry } : 'unavailable')
    })()
    return () => { cancelled = true }
  }, [word, id])
  if (typeof state !== 'object') {
    return (
      <View style={{ gap: 10 }}>
        {head}
        {state === 'loading' ? <Spinner />
          : state === 'unavailable' ? <ErrorText>{dictionaryOffline ? 'The dictionary is missing from this build.' : 'The dictionary needs a connection to the server.'}</ErrorText>
          : (
            <Enter style={{ gap: 10 }}>
              <T muted>No article is headed “{word}”.</T>
              <Button small title="Search the dictionary" onPress={() => nav.search(word)} style={{ alignSelf: 'flex-start' }} />
            </Enter>
          )}
      </View>
    )
  }
  const { entry, matches } = state
  const via = matches.find(m => m.id === entry.id)?.via
  const others = matches.filter(m => m.id !== entry.id)
  const long = paragraphs(entry.text).length > LONG_PARAS || entry.text.length > LONG_CHARS
  const follow = (to: string) => nav.push({ kind: 'subject', id: to, label: index?.byId.get(to)?.[1] ?? to })
  const body = (
    <Enter key={entry.id} style={{ gap: 10 }}>
      <Headword entry={entry} size={22} />
      {via ? <T small muted>The entry “{via}” refers here</T> : null}
      <DictionaryArticle key={`a.${entry.id}`} entry={entry} collapsed={long} onLink={follow} onNavigate={nav.read} />
      <ArticleWords id={entry.id} onWord={(code, lemma) => nav.push({ kind: 'word', code, label: lemma })} />
      {others.length ? (
        <View style={{ gap: 8 }}>
          <T small muted>Other articles for “{word}”</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {others.map(m => <Chip key={m.id} label={m.headword} onPress={() => follow(m.id)} />)}
          </View>
        </View>
      ) : null}
    </Enter>
  )
  return (
    <View style={{ gap: 10 }}>
      {head}
      {body}
    </View>
  )
}
