import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Text, View, type ScrollView } from 'react-native'
import { Stack, useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { AUTHORS, authorOf, formatPassages, searchCompanion, titleIsPassage, workLine, type CompanionIndex, type Place } from '@shared/companion'
import type { CollectionSummary, Library, LibraryAuthor, SectionHit, WorkContents, WorkSummary } from '@shared/ministry'
import { paginate } from '@shared/cbd'
import { loadContents, loadLibrary, peekContents, peekLibrary, libraryUnavailable, searchSections, unavailableFor } from '../src/lib/ministryLibrary'
import { collectionDetail, collectionOfKind, contentsHeading, countOf, newSectionHits, opensToContents, positionKey, readerLink, searchWorks, sectionHitDetail, shelfOf, shortTitle, type WorkHit } from '../src/lib/libraryNav'
import { lastRead, loadPositions } from '../src/lib/libraryPosition'
import { useCompanionIndexes } from '../src/hooks/useCompanion'
import { useEdition } from '../src/lib/edition'
import LibraryReader from '../src/components/LibraryReader'
import { SectionsList, WorksChooser } from '../src/components/ContentsPicker'
import { CONFIRM_MS } from '../src/components/ChapterPicker'
import { FadeSwap, Stagger, STAGGER_CAP, useFreshList } from '../src/components/motion/nav'
import Pager from '../src/components/Pager'
import { useReduceMotion } from '../src/store/prefs'
import { TURN_DX } from '../src/lib/motionTiming'
import { useReadingFont } from '../src/hooks/useReadingFont'
import { useColors } from '../src/hooks/useTheme'
import { Card, ErrorText, H2, Input, ListRow, Screen, SPACE, Spinner, T, Tap, TYPE } from '../src/components/ui'

/** Rows per page of search results: the dictionary's. */
const ROWS = 30
/** The server's title search waits this long after the last keystroke (the library's own searches answer at once). */
const SEARCH_WAIT_MS = 250

/**
 * The ministry library. `/companion` lists the authors with their collections, with one search by passage or title;
 * `?author=darby&collection=cw` a collection's works; `?author=…&work=…&view=contents` a work's sections (a volume of
 * papers or letters lists them before it is read; a book of the Bible opens at once); `?author=…&work=…` reads a work
 * (LibraryReader), at `n` and `p` when given (the deep link, with `from` the verse it came from), else where it was
 * left. Older links still land: `?author=darby` is the author's collections, `&kind=outline` the collection of that kind.
 */
/** Another edition (docs/EDITION.md) remounts the library: its lists are asked again, an author it leaves out is gone. */
export default function Companion() {
  const edition = useEdition()
  return <CompanionPage key={edition} />
}

function CompanionPage() {
  const p = useLocalSearchParams<{ author?: string; collection?: string; kind?: string; work?: string; view?: string; n?: string; p?: string; from?: string; q?: string }>()
  if (p.author && p.work && p.view === 'contents') return <ContentsView key={`${p.author}/${p.work}`} author={p.author} work={p.work} />
  if (p.author && p.work) return <LibraryReader key={p.author} author={p.author} work={p.work} link={readerLink(p)} />
  if (p.author) return <AuthorView key={`${p.author}/${p.collection ?? ''}/${p.kind ?? ''}`} author={p.author} collection={p.collection} kind={p.kind} />
  return <IndexView initialQuery={p.q ?? ''} />
}

/** The library's list, as it arrives (the companion's own works first when the server's is not there yet). */
function useLibrary(): Library | null | undefined {
  const [library, setLibrary] = useState<Library | null | undefined>(peekLibrary() ?? undefined)
  useEffect(() => { let on = true; void loadLibrary().then(l => { if (on) setLibrary(l) }, () => { if (on) setLibrary(null) }); return () => { on = false } }, [])
  return library
}

const openWork = (author: string, work: string, n?: number) => ({ pathname: '/companion' as const, params: n ? { author, work, n: String(n) } : { author, work } })
/** A work chosen among its fellows: its contents where the library lists them, else the reader. */
const goWork = (author: string, works: readonly WorkSummary[], work: WorkSummary) => opensToContents(works, work) ? { pathname: '/companion' as const, params: { author, work: work.id, view: 'contents' } } : openWork(author, work.id)
/** A collection's row opens: its works, or, for a collection of one work, that work. */
const goCollection = (author: string, c: CollectionSummary) => c.works.length === 1 ? goWork(author, c.works, c.works[0]) : { pathname: '/companion' as const, params: { author, collection: c.id } }

function IndexView({ initialQuery }: { initialQuery: string }) {
  const router = useRouter()
  const scroll = useRef<ScrollView>(null)
  const library = useLibrary()
  const indexes = useCompanionIndexes()
  const [q, setQ] = useState(initialQuery)
  const query = q.trim()
  // Back with a search up clears the search (build 29: it left the page for Home); the next Back leaves
  const navigation = useNavigation()
  const searching = useRef(false); searching.current = !!query
  useEffect(() => navigation.addListener('beforeRemove', e => { if (!searching.current) return; e.preventDefault(); setQ('') }), [navigation])
  const loaded = AUTHORS.map(a => indexes[a.id]).filter((i): i is CompanionIndex => !!i)
  const places = useMemo(() => searchCompanion(loaded, query), [loaded.length, query])  // eslint-disable-line react-hooks/exhaustive-deps
  const works = useMemo(() => searchWorks(library, query), [library, query])
  // the server's title search (every section of every work: the papers of a volume, the readings, the letters), a beat
  // after typing stops; the last answer stays up while the next is pending, so narrowing does not blink
  const [found, setFound] = useState<{ query: string; hits: readonly SectionHit[] }>({ query: '', hits: [] })
  useEffect(() => {
    if (!query) return
    let on = true
    const t = setTimeout(() => { void searchSections(query).then(hits => { if (on) setFound({ query, hits }) }) }, SEARCH_WAIT_MS)
    return () => { on = false; clearTimeout(t) }
  }, [query])
  const hits = useMemo(() => newSectionHits(found.hits, places), [found.hits, places])
  const last = useLastRead()
  return (
    <Screen animate={false} scrollRef={scroll}>
      <Stack.Screen options={{ title: 'Ministry' }} />
      <Input value={q} onChangeText={setQ} placeholder="Search by passage or title" autoCorrect={false} autoCapitalize="none" returnKeyType="search" accessibilityLabel="Search the ministry by passage or title" />
      {query ? <Results works={works} hits={hits} pending={found.query !== query} places={places} library={library} query={query} scroll={scroll} /> : library === undefined ? <Spinner /> : !library?.authors.length ? <ErrorText>{libraryUnavailable}</ErrorText> : (
        <>
          {last ? (
            <Stagger index={0}>
              <Card style={{ gap: 0, paddingVertical: 8 }}>
                <ListRow icon="book" label="Continue reading" detail={[library.authors.find(a => a.id === last.author)?.short, last.detail].filter(Boolean).join(' · ')} onPress={() => router.push(openWork(last.author, last.work))} />
              </Card>
            </Stagger>
          ) : null}
          {/* one house stagger down the page: each author's heading, then its rows */}
          {library.authors.map((a, i) => {
            const at = (last ? 1 : 0) + library.authors.slice(0, i).reduce((n, x) => n + 1 + x.collections.length, 0)
            return (
              <View key={a.id} style={{ gap: SPACE.m }}>
                <Stagger index={at}><H2>{a.name}</H2></Stagger>
                <Card style={{ gap: 0, paddingVertical: 8 }}>
                  {/* a collection of one work is named by the work */}
                  {a.collections.map((c, j) => <Stagger key={c.id} index={at + 1 + j}><ListRow label={c.works.length === 1 ? c.works[0].title : c.title} detail={collectionDetail(c, a.id)} onPress={() => router.push(goCollection(a.id, c))} /></Stagger>)}
                </Card>
              </View>
            )
          })}
        </>
      )}
    </Screen>
  )
}

/** Where the library was last read, named: "The Believer Established · Devotedness". */
function useLastRead() {
  const [last, setLast] = useState<{ author: string; work: string; detail: string } | null>(null)
  // read again whenever the library comes back into view: the reader it returns from has just noted its place
  useFocusEffect(useCallback(() => {
    let on = true
    void lastRead().then(l => {
      if (!on || !l) return
      const title = l.pos.title ? shortTitle(l.pos.title) : ''
      setLast({ author: l.author, work: l.work, detail: [title, l.pos.section].filter(Boolean).join(' · ') })
    })
    return () => { on = false }
  }, []))
  return last
}

/**
 * Search: works whose title matches, then the server's sections by title (the papers, readings and letters inside every
 * work), then sections by passage or title from the companion's own index (the Synopsis and Coates). "Nothing for …"
 * only once all three are empty and the server has answered; "Searching…" while it has not.
 */
function Results({ works, hits, pending, places, library, query, scroll }: { works: readonly WorkHit[]; hits: readonly SectionHit[]; pending: boolean; places: readonly Place[]; library: Library | null | undefined; query: string; scroll: RefObject<ScrollView | null> }) {
  const router = useRouter()
  // results arrive with the house stagger when they first show; narrowing them by typing does not replay it
  const fresh = useFreshList('results')
  const none = !works.length && !hits.length && !places.length
  return (
    <View style={{ gap: SPACE.l }}>
      {works.length ? (
        <Card style={{ gap: 0, paddingVertical: 8 }}>
          {works.map((h, i) => <Stagger key={`${h.author.id}/${h.work.id}`} index={i} cap={fresh ? STAGGER_CAP : 0}><ListRow label={h.work.title} detail={`${h.author.short} · ${h.collection.title === h.work.title ? countOf(h.work.kind, h.work.count, h.author.id) : h.collection.title}`} onPress={() => router.push(goWork(h.author.id, h.collection.works, h.work))} /></Stagger>)}
        </Card>
      ) : null}
      <Rows items={hits} listKey={`t:${query}`} entrance="results" scroll={scroll} empty=""
        title={hits.length ? `${hits.length} ${hits.length === 1 ? 'title' : 'titles'}` : ''}
        row={h => ({ key: `${h.author}/${h.work.id}/${h.n}`, title: h.title, detail: sectionHitDetail(h, library), onPress: () => router.push(openWork(h.author, h.work.id, h.n)) })} />
      <Rows items={places} listKey={`q:${query}`} entrance="results" scroll={scroll} empty=""
        title={places.length ? `${places.length} ${places.length === 1 ? 'section' : 'sections'}` : ''} row={p => {
          const passage = p.section.passages.length && !titleIsPassage(p.section.title) ? formatPassages(p.section.passages) : ''
          return { key: `${p.author}/${p.work.id}/${p.n}`, title: p.section.title, detail: [`${authorOf(p.author)!.short} · ${workLine(p)}`, passage].filter(Boolean).join(' · '), onPress: () => router.push(openWork(p.author, p.work.id, p.n)) }
        }} />
      {none ? <T muted>{pending ? 'Searching…' : `Nothing for “${query}”.`}</T> : null}
    </View>
  )
}

/** A paged list of rows: a title in the reading font and a muted detail line; a page turn leads in from its side. */
function Rows<I>({ items, listKey, entrance, title, empty, scroll, row }: { items: readonly I[]; listKey: string; /** what counts as a new list for the entrance (default: the list and page) */ entrance?: string; title: string; empty: string; scroll?: RefObject<ScrollView | null>; row: (item: I) => { key: string; title: string; detail: string; onPress: () => void } }) {
  const c = useColors()
  const reduce = useReduceMotion()
  const f = useReadingFont(17, 1.3)
  const [pages, setPages] = useState<Record<string, number>>({})
  const [dir, setDir] = useState(0)
  const listY = useRef(0)
  const paged = paginate(items, pages[listKey] ?? 1, ROWS)
  // a page turn is a new list; with `entrance`, the list typing narrows is not
  const fresh = useFreshList(`${entrance ?? listKey}#${paged.page}`)
  const turn = (page: number) => {
    setDir(page > paged.page ? 1 : -1)
    setPages(p => ({ ...p, [listKey]: page }))
    scroll?.current?.scrollTo({ y: Math.max(0, listY.current - SPACE.s), animated: !reduce })
  }
  useEffect(() => { setDir(0) }, [listKey])
  if (!items.length) return empty ? <T muted>{empty}</T> : null
  return (
    <View style={{ gap: SPACE.m }} onLayout={e => { listY.current = e.nativeEvent.layout.y }}>
      {title ? <T small muted>{title}</T> : null}
      <FadeSwap k={`${listKey}#${paged.page}`} dx={dir * TURN_DX}>
        <Card style={{ gap: 0, paddingVertical: 6 }}>
          {paged.items.map((item, i) => {
            const r = row(item)
            return (
              <Stagger key={r.key} index={i} cap={fresh ? STAGGER_CAP : 0}>
                <Tap onPress={r.onPress} scaleTo={0.985} accessibilityRole="link"
                  style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 8, gap: 2, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
                  <Text style={{ color: c.text, ...f.body }}>{r.title}</Text>
                  {r.detail ? <Text style={{ color: c.muted, fontSize: TYPE.small }}>{r.detail}</Text> : null}
                </Tap>
              </Stagger>
            )
          })}
        </Card>
      </FadeSwap>
      {paged.pages > 1 ? <Pager page={paged.page} pages={paged.pages} onPage={turn} /> : null}
    </View>
  )
}

/** An author's collections, or one collection's works: book chips like the Bible picker's, or a list of volumes. */
function AuthorView({ author, collection, kind }: { author: string; collection?: string; kind?: string }) {
  const router = useRouter()
  const reduce = useReduceMotion()
  const library = useLibrary()
  const a = library?.authors.find(x => x.id === author)
  const c = a ? (collection ? a.collections.find(x => x.id === collection) : kind ? collectionOfKind(a, kind) : undefined) : undefined
  // the work last read in this collection is the one marked
  const [current, setCurrent] = useState('')
  useEffect(() => {
    if (!c) return
    let on = true
    void loadPositions().then(ps => {
      let best = '', t = -1
      for (const w of c.works) { const pos = ps[`${author}/${w.id}`]; if (pos && pos.t > t) { t = pos.t; best = w.id } }
      if (on) setCurrent(best)
    })
    return () => { on = false }
  }, [c, author])
  const [picked, setPicked] = useState<string | undefined>()
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current) }, [])
  const pick = (w: string) => {
    setPicked(w)
    if (pending.current) clearTimeout(pending.current)
    const go = () => { router.push(c ? goWork(author, c.works, c.works.find(x => x.id === w)!) : openWork(author, w)); setPicked(undefined) }
    if (reduce) go(); else pending.current = setTimeout(go, CONFIRM_MS)
  }
  const name = a?.name ?? authorOf(author)?.name ?? ''
  if (library === undefined) return <Screen><Stack.Screen options={{ title: name || 'Ministry' }} /><Spinner /></Screen>
  if (!a) return <Screen><Stack.Screen options={{ title: 'Ministry' }} /><ErrorText>{`No author “${author}”.`}</ErrorText></Screen>
  if (!c) {
    return (
      <Screen animate={false}>
        <Stack.Screen options={{ title: a.name }} />
        {collection ? <ErrorText>{`No collection “${collection}” by ${a.name}.`}</ErrorText> : null}
        <Card style={{ gap: 0, paddingVertical: 8 }}>
          {a.collections.map((x, i) => <Stagger key={x.id} index={i}><ListRow label={x.works.length === 1 ? x.works[0].title : x.title} detail={collectionDetail(x, a.id)}
            onPress={() => router.push(goCollection(a.id, x))} /></Stagger>)}
        </Card>
        <T small muted>{a.source}</T>
      </Screen>
    )
  }
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: c.title }} />
      <T small muted>{`${a.name} · ${collectionDetail(c, a.id)}`}</T>
      <WorksChooser author={a.id} works={c.works} current={current} picked={picked} onWork={pick} />
      <T small muted>{a.source}</T>
    </Screen>
  )
}


/** A work's contents as a page of the library, before the reader: the volume's papers (or readings, letters) as the
 * picker lays them out, the one last read marked; a tap opens the reader there, and its Back returns here. */
function ContentsView({ author, work }: { author: string; work: string }) {
  const router = useRouter()
  const reduce = useReduceMotion()
  const library = useLibrary()
  const shelf = useMemo(() => shelfOf(library, author, work), [library, author, work])
  const summary = shelf?.collection.works[shelf.at]
  const [contents, setContents] = useState<WorkContents | null | undefined>(peekContents(author, work))
  useEffect(() => { let on = true; if (!contents) void loadContents(author, work).then(c => { if (on) setContents(c) }); return () => { on = false } }, [author, work])  // eslint-disable-line react-hooks/exhaustive-deps
  // the section last read in this work is the one marked; read again on return, the reader has just noted its place
  const [current, setCurrent] = useState(-1)
  useFocusEffect(useCallback(() => {
    let on = true
    void loadPositions().then(ps => { if (on) setCurrent(ps[positionKey(author, work)]?.n ?? -1) })
    return () => { on = false }
  }, [author, work]))
  const [picked, setPicked] = useState<number | undefined>()
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current) }, [])
  const pick = (n: number) => {
    setPicked(n)
    if (pending.current) clearTimeout(pending.current)
    const go = () => { router.push(openWork(author, work, n)); setPicked(undefined) }
    if (reduce) go(); else pending.current = setTimeout(go, CONFIRM_MS)
  }
  const meta = contents?.work ?? summary
  const heading = meta ? contentsHeading(shelf, { title: meta.title, kind: meta.kind, count: contents?.sections.length ?? summary?.count ?? 0 }, author) : null
  if (library === undefined && !contents) return <Screen><Stack.Screen options={{ title: 'Ministry' }} /><Spinner /></Screen>
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: heading?.title || 'Ministry' }} />
      {heading?.line ? <T small muted>{heading.line}</T> : null}
      {contents === undefined ? <Spinner /> : contents === null ? <ErrorText>{unavailableFor(author)}</ErrorText>
        : <SectionsList key={work} contents={contents} current={current} picked={picked} onPick={pick} />}
      {shelf ? <T small muted>{shelf.author.source}</T> : null}
    </Screen>
  )
}
