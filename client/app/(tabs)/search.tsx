import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { BOOKS, findBookFuzzy } from '@shared/books'
import { strongsCode } from '@shared/concordance'
import { bareBook, formatRef, parseRef } from '@shared/ref'
import type { SearchHit, SearchOrder, SearchResponse } from '@shared/types'
import { get, isNetworkError } from '../../src/lib/api'
import { offlineKeys, readLocalChapter } from '../../src/lib/bible'
import { searchLocal, warmLocalSearch } from '../../src/lib/localSearch'
import { useInks } from '../../src/hooks/useTheme'
import { useReadingFont } from '../../src/hooks/useReadingFont'
import { Button, Card, Chip, Enter, ErrorText, H, ListRow, Row, Screen, Segmented, T, Tap, TYPE } from '../../src/components/ui'
import { FadeSwap, FocusInput, Stagger, useReduceMotion } from '../../src/components/motion/nav'
import { SWAP_MS } from '../../src/lib/motionTiming'
import SubjectLinks from '../../src/components/SubjectLinks'
import BookGroupCard from '../../src/components/BookGroupCard'
import OwnOutlineMatches from '../../src/components/OwnOutlineMatches'
import RecentSearches from '../../src/components/RecentSearches'
import Icon from '../../src/components/Icon'
import { dropRecent, loadRecent, pushRecent, saveRecent } from '../../src/lib/recentSearches'
import { inScopeRanges, splitScope } from '@shared/bookGroups'
import { tourRef } from '../../src/store/tour'
import WordSheet, { type WordTarget } from '../../src/components/WordSheet'

type Scope = 'all' | 'OT' | 'NT'
const MAX_OFFLINE_HITS = 200
/** "Searching…" shows only for a search that is still running after this; a quick one goes straight to its results. */
const SLOW_MS = 180
/** The order the reader last picked, kept until the app is closed; null leaves each search to the default for its query. */
let pickedOrder: SearchOrder | null = null
type Shown = { hits: SearchHit[]; total: number; offline: boolean; took: number; /** the words searched */ query: string; /** what was typed ("love in the gospels") */ asked: string; /** the books the words were searched in, when the query named them */ within: { label: string; words: string } | null; order: SearchOrder | null; /** the query is also this book's name: offered above the hits */ book: number | null; /** the first `exact` hits hold the word itself, the rest a longer word it begins (0: one group) */ exact: number }

/**
 * A Strong's number ("G1320", "h430") opens that word in the word sheet. A reference with a chapter or verse resolves
 * locally. A book's name alone ("song", "mark") is searched as a word and the book is offered in a row above the hits;
 * only a name the text never uses ("jn") opens the book. Text queries run on the device when the whole text is here (native, or web with
 * every chapter stored), else go to the API, or scan the stored chapters when it is unreachable. Word results come in
 * Bible order for one word or a quoted phrase and best match first for several words (shared/search.ts defaultOrder);
 * the order control under the scope shows which and lets the reader pick, for the session.
 */
export default function Search() {
  const router = useRouter()
  const c = useInks()
  const params = useLocalSearchParams<{ q?: string; scope?: string }>()
  const [q, setQ] = useState(typeof params.q === 'string' ? params.q : '')
  const [scope, setScope] = useState<Scope>('all')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [res, setRes] = useState<Shown & { gen: number; first: boolean } | null>(null)
  const [slow, setSlow] = useState(false)
  const reduce = useReduceMotion()
  /**
   * Each result set gets a generation and the list is keyed by it. The first set after an empty screen staggers in; a
   * set replacing one on screen is up in the same frame and fades in as one block (the old one stays until then), so
   * search after search never blanks the list or replays a cascade.
   */
  const gen = useRef(0)
  const shown = useRef(false)
  const listOut = useRef(new Animated.Value(1)).current
  const showRes = (r: Shown) => {
    const first = !shown.current || !r.hits.length
    shown.current = r.hits.length > 0
    setRes({ ...r, gen: ++gen.current, first })
  }
  // before paint: the new list must never show a frame at full opacity, nor the old one a frame at none
  useLayoutEffect(() => {
    if (!res) return
    listOut.stopAnimation()
    if (res.first || reduce) { listOut.setValue(1); return }
    listOut.setValue(0)
    Animated.timing(listOut, { toValue: 1, duration: SWAP_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    // per result set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res?.gen])
  const dropRes = () => { shown.current = false; setRes(null) }
  /** Clearing the field sweeps the results away quickly instead of blinking them out. */
  const clearResults = () => {
    setErr('')
    if (!res) return
    if (reduce) { dropRes(); return }
    Animated.timing(listOut, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(({ finished }) => { if (finished) dropRes() })
  }
  const onChange = (t: string) => { setQ(t); if (!t.trim()) clearResults() }
  /** The ✕ in the field: the last search gone in one tap, ready for the next. */
  const field = useRef<TextInput>(null)
  const clearField = () => { setQ(''); setSuggest(null); clearResults(); field.current?.focus() }
  // the last searches, on this device only
  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => { void loadRecent().then(setRecent) }, [])
  const remember = (query: string) => setRecent(r => { const next = pushRecent(r, query); void saveRecent(next); return next })
  const forget = (query: string) => setRecent(r => { const next = dropRecent(r, query); void saveRecent(next); return next })

  const openRef = (book: number, chapter: number, verse?: number, end?: number) => router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(book), chapter: String(chapter), v: verse ? String(verse) : '', v2: end && verse && end > verse ? String(end) : '' } })

  const [suggest, setSuggest] = useState<string | null>(null)
  const [word, setWord] = useState<WordTarget | null>(null)
  const runRef = useRef<(query?: string) => void>(() => {})
  useEffect(() => { const t = setTimeout(warmLocalSearch, 300); return () => clearTimeout(t) }, [])
  useEffect(() => {
    const pq = typeof params.q === 'string' ? params.q : ''
    if (pq) { setQ(pq); setTimeout(() => runRef.current(pq), 0) }
  }, [params.q])
  const run = async (override?: string) => {
    const query = (override ?? q).trim()
    if (!query) return
    remember(query)
    const code = strongsCode(query)
    if (code) { setWord({ code, word: '', label: code }); return }
    // "jn 3:16", "1 cor 13" open; a book's name alone ("song", "1 kings") is searched as a word below
    const ref = parseRef(query)
    const bookOnly = bareBook(query)
    if (ref && !bookOnly) { openRef(ref.book, ref.chapter, ref.v1, ref.v2); return }
    // "Jhon 3:16": a reference with a misspelt book still opens; a bare misspelt name ("Pslams") is offered, not assumed
    setSuggest(null)
    if (bookOnly) { /* a real name: nothing to guess */ }
    else if (/\d/.test(query)) { const near = parseRef(query, { fuzzy: true }); if (near) { openRef(near.book, near.chapter, near.v1, near.v2); return } }
    else { const near = findBookFuzzy(query); if (near) setSuggest(near.name) }
    // "love in the gospels", "comfort in Isaiah": the words, searched in those books only
    const within = splitScope(query)
    const words = within?.query ?? query
    const where = within?.scope ?? scope
    const w = within ? { label: within.label, words } : null
    setBusy(true); setErr('')
    const t0 = Date.now()
    const slowTimer = setTimeout(() => setSlow(true), SLOW_MS)
    try {
      const order = pickedOrder ?? undefined
      const local = await searchLocal(words, where, 100, order).catch(() => null)
      const r = local ?? await get<SearchResponse>(`/search?q=${encodeURIComponent(words)}&scope=${encodeURIComponent(where)}&limit=100${order ? `&order=${order}` : ''}`)
      if (r.kind === 'ref' && r.ref) { openRef(r.ref.book, r.ref.chapter, r.ref.v1); return }
      showRes({ hits: r.hits, total: r.total, offline: false, took: local ? Date.now() - t0 : r.took_ms, query: words, asked: query, within: w, order: r.order ?? null, book: r.book?.book ?? null, exact: r.exact ?? 0 })
    } catch (e) {
      if (!isNetworkError(e)) { dropRes(); setErr((e as Error).message); return }
      try {
        const hits = await offlineScan(words, where)
        if (!hits.length && bookOnly) { openRef(bookOnly.n, 1); return }
        showRes({ hits, total: hits.length, offline: true, took: Date.now() - t0, query: words, asked: query, within: w, order: null, book: bookOnly?.n ?? null, exact: 0 })
      } catch (e2) { dropRes(); setErr((e2 as Error).message) }
    } finally { clearTimeout(slowTimer); setSlow(false); setBusy(false) }
  }

  runRef.current = (query?: string) => { run(query) }
  // a testament picked after a search re-runs that search in the new scope (the first render has nothing to re-run)
  const shownQuery = res?.asked
  const scopeSeen = useRef(scope)
  useEffect(() => {
    if (scopeSeen.current === scope) return
    scopeSeen.current = scope
    if (shownQuery) runRef.current(shownQuery)
  }, [scope, shownQuery])
  // the order picked re-runs the shown search too, and stands for the searches after it
  const pickOrder = (o: SearchOrder) => {
    if (o === res?.order) return
    pickedOrder = o
    if (shownQuery) runRef.current(shownQuery)
  }
  // every keystroke re-renders this screen; the (up to 100) result cards only change with a new result set
  const listY = useMemo(() => listOut.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }), [listOut])
  const list = useMemo(() => res && res.hits.length > 0 && (
    <Animated.View key={res.gen} style={{ gap: 10, opacity: listOut, transform: [{ translateY: listY }] }}>
      {res.book ? <Card style={{ paddingVertical: 6 }}><ListRow icon="book" label={BOOKS[res.book - 1].name} detail="Open the book" onPress={() => openRef(res.book!, 1)} /></Card> : null}
      {res.hits.map((h, i) => {
        const card = (
          <Tap onPress={() => openRef(h.book, h.chapter, h.verse)} scaleTo={0.98} accessibilityRole="link">
            <Card style={{ gap: 4 }}>
              <T small style={{ color: c.accent, fontWeight: '600' }}>{formatRef({ book: h.book, chapter: h.chapter, v1: h.verse })}</T>
              <Snippet html={h.snippet || h.text} />
            </Card>
          </Tap>
        )
        const key = `${h.book}.${h.chapter}.${h.verse}`
        // one word looked up: the verses with the word itself come first, then the longer words it begins
        const body = res.exact > 0 && i === res.exact ? <View style={{ gap: 10 }}><T small muted style={{ paddingTop: 8, paddingHorizontal: 4 }}>Longer words beginning “{res.query}”</T>{card}</View> : card
        return res.first ? <Stagger key={key} index={i}>{body}</Stagger> : <View key={key}>{body}</View>
      })}
    </Animated.View>
    // openRef only closes over the router
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [res, listOut, listY, c, router])
  // a quick search keeps the last status line until its own result replaces it
  const status = busy && slow ? 'Searching…'
    : res ? (res.total === 0 ? `No verses match “${res.query}”${res.offline ? ' in the stored chapters' : ''}` : `${res.total.toLocaleString()} verse${res.total === 1 ? '' : 's'} · ${res.took} ms${res.offline ? ' · offline: stored chapters only' : ''}`)
    : ''
  return (
    <Screen safeTop>
      <H>Search</H>
      <Row ref={tourRef('search-field')}>
        <View style={{ flex: 1 }}>
          <FocusInput inputRef={field} placeholder="jn 3:16, words, or G1320" value={q} onChangeText={onChange} onSubmitEditing={() => run()} returnKeyType="search" autoCapitalize="none" autoCorrect={false} style={{ paddingRight: q ? 44 : 14 }} />
          {q ? (
            <Tap onPress={clearField} hitSlop={8} scaleTo={0.86} accessibilityRole="button" accessibilityLabel="Clear the search" style={{ position: 'absolute', right: 6, top: 0, bottom: 0, width: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="x" size={18} color={c.muted} />
            </Tap>
          ) : null}
        </View>
        <Button primary title="Go" onPress={() => run()} disabled={busy} />
      </Row>
      <View ref={tourRef('search-scope')}><Segmented value={scope} onChange={setScope} options={[{ value: 'all', label: 'All' }, { value: 'OT', label: 'Old Testament' }, { value: 'NT', label: 'New Testament' }]} /></View>
      {res?.order && res.hits.length > 0 ? (
        <Enter rise={4}><Segmented value={res.order} onChange={pickOrder} options={[{ value: 'bible', label: 'Bible order' }, { value: 'match', label: 'Best match' }]} /></Enter>
      ) : null}
      {!q.trim() && !res && !busy ? <RecentSearches items={recent} onPick={x => { setQ(x); run(x) }} onRemove={forget} /> : null}
      {err ? <ErrorText>{err}</ErrorText> : null}
      {suggest ? <Row><T small muted>Did you mean</T><Button small title={suggest} onPress={() => { setSuggest(null); setQ(suggest); run(suggest) }} /></Row> : null}
      <FadeSwap k={status}>{status ? <T small muted>{status}</T> : null}</FadeSwap>
      {res?.within ? (
        <Row><Chip label={`In ${res.within.label.replace(/^The /, 'the ')}  ✕`} accessibilityLabel={`Searching ${res.within.label} only. Search every book`} on onPress={() => { const words = res.within!.words; setQ(words); run(words) }} /></Row>
      ) : null}
      {res && !busy ? <BookGroupCard query={res.asked} /> : null}
      {res && !busy ? <SubjectLinks query={res.query} /> : null}
      {res && !busy ? <OwnOutlineMatches query={res.query} /> : null}
      {list}
      <View style={{ height: 24 }} />
      <WordSheet target={word} onClose={() => setWord(null)} />
    </Screen>
  )
}

/** Search snippets carry <mark> tags; render them as bold runs. */
/** A matching verse in the reader's font, the matched words in bold on the selection tint. */
function Snippet({ html }: { html: string }) {
  const c = useInks()
  const f = useReadingFont(TYPE.body, 22 / TYPE.body)
  const parts = html.split(/(<mark>|<\/mark>)/)
  let on = false
  return (
    <Text style={{ color: c.text, ...f.body }}>
      {parts.map((p, i) => {
        if (p === '<mark>') { on = true; return null }
        if (p === '</mark>') { on = false; return null }
        const text = p.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        return <Text key={i} style={on ? { ...f.bold, backgroundColor: c.selected } : undefined}>{text}</Text>
      })}
    </Text>
  )
}

async function offlineScan(query: string, scope: string): Promise<SearchHit[]> {
  const needle = query.toLowerCase()
  const keys = (await offlineKeys()).map(k => k.split('.').map(Number) as [number, number]).filter(([b]) => inScopeRanges(b, scope)).sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const hits: SearchHit[] = []
  for (const [b, ch] of keys) {
    const data = await readLocalChapter(b, ch)
    if (!data) continue
    for (const v of data.verses) {
      const i = v.t.toLowerCase().indexOf(needle)
      if (i < 0) continue
      const snippet = v.t.slice(0, i) + '<mark>' + v.t.slice(i, i + query.length) + '</mark>' + v.t.slice(i + query.length)
      hits.push({ book: b, chapter: ch, verse: v.v, text: v.t, snippet, rank: 0 })
      if (hits.length >= MAX_OFFLINE_HITS) return hits
    }
  }
  return hits
}
