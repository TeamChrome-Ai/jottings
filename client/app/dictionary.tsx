import { useEffect, useMemo, useRef, useState } from 'react'
import { Text, View, type ScrollView } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { groupOf, letterOf, nameKey, paginate, searchHeadwords, twoLetterGroups, type CbdEntry, type CbdIndexRow } from '@shared/cbd'
import { bareTerm, glossaryList } from '@shared/glossary'
import { darbyGlossary } from '../src/lib/glossary'
import { dictionaryOffline, loadDictionaryEntry } from '../src/lib/dictionary'
import { useDictionaryIndex } from '../src/hooks/useDictionaryIndex'
import DictionaryArticle, { ArticleWords, Headword } from '../src/components/DictionaryArticle'
import WordSheet, { type WordTarget } from '../src/components/WordSheet'
import Pager, { CountChip } from '../src/components/Pager'
import { FadeSwap, Stagger, STAGGER_CAP, useFreshList } from '../src/components/motion/nav'
import { useReduceMotion } from '../src/store/prefs'
import { plural } from '../src/lib/community'
import { TURN_DX } from '../src/lib/motionTiming'
import { useReadingFont } from '../src/hooks/useReadingFont'
import { useColors } from '../src/hooks/useTheme'
import { face } from '../src/theme'
import { Button, Card, Enter, ErrorText, H, Input, ListRow, Screen, SPACE, Spinner, T, Tap, TYPE } from '../src/components/ui'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
// the appendix: its introduction plus 48 studies, ids syn-…
const SYNONYMS = 'syn'
// Darby's own terms (data/glossary/darby.json): a section of its own, not headwords
const DARBY = 'darby'
/** Headwords per page: two phone screens of rows. S alone has 531, its Sh group 213. */
const PAGE = 30
/** The letter a headword is filed under; the synonyms appendix is a section of its own. */
const sectionOf = (r: CbdIndexRow) => r[0].startsWith('syn-') ? SYNONYMS : letterOf(r[1])
const SOURCE = 'Text from Bible Truth Publishers’ online edition of George Morrish’s A New and Concise Bible Dictionary (1897), public domain.'
const UNAVAILABLE = dictionaryOffline ? 'The dictionary is missing from this build.' : 'The dictionary needs a connection to the server.'

/**
 * `/dictionary` is Morrish's dictionary of subjects: search, A to Z with each letter's two-letter groups (Aa, Ab, …),
 * the synonyms appendix, every list paged. `/dictionary?q=word` opens on a search, `/dictionary?id=aaron` one article,
 * whose Greek and Hebrew words open their Strong's word study in the word sheet. "Darby's terms" lists his glossary; a
 * term opens the word sheet on it (his usage first, then Morrish's article when there is one). `from=index` marks an article opened from
 * the index itself (A to Z or a search there): the header's back returns to it, so the article's own "A to Z" is left out.
 */
export default function Dictionary() {
  const { id, q, from } = useLocalSearchParams<{ id?: string; q?: string; from?: string }>()
  return id ? <Article id={id} fromIndex={from === 'index'} /> : <IndexView initialQuery={q ?? ''} />
}

function Article({ id, fromIndex }: { id: string; fromIndex: boolean }) {
  const router = useRouter()
  const [entry, setEntry] = useState<CbdEntry | null | undefined>(undefined)
  useEffect(() => {
    let on = true
    setEntry(undefined)
    void loadDictionaryEntry(id).then(e => { if (on) setEntry(e) })
    return () => { on = false }
  }, [id])
  const follow = (to: string) => router.push({ pathname: '/dictionary', params: { id: to } })
  const [word, setWord] = useState<WordTarget | null>(null)
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: 'Dictionary' }} />
      {entry === undefined ? <Spinner /> : entry === null ? <ErrorText>{`No article “${id}”. ${UNAVAILABLE}`}</ErrorText> : (
        <>
          <Enter><Headword entry={entry} size={TYPE.title} /></Enter>
          <Enter delay={70}><DictionaryArticle entry={entry} onLink={follow} size={17} /></Enter>
          <Enter delay={110}><ArticleWords id={entry.id} onWord={(code, lemma) => setWord({ code, word: '', label: lemma })} /></Enter>
        </>
      )}
      <T small muted>{SOURCE}</T>
      {fromIndex ? null : <Button title="A to Z" onPress={() => router.push('/dictionary')} style={{ alignSelf: 'flex-start' }} />}
      <WordSheet target={word} onClose={() => setWord(null)} />
    </Screen>
  )
}

function IndexView({ initialQuery }: { initialQuery: string }) {
  const router = useRouter()
  const c = useColors()
  const reduce = useReduceMotion()
  const index = useDictionaryIndex()
  const f = useReadingFont(17, 1.3)
  const [q, setQ] = useState(initialQuery)
  const [letter, setLetter] = useState('A')
  const [group, setGroup] = useState('')   // '' = the whole letter
  /** The page each list was left on (a letter, a group, a search), kept while the screen is open. */
  const [pages, setPages] = useState<Record<string, number>>({})
  const scroll = useRef<ScrollView>(null)
  const listY = useRef(0)
  const query = q.trim()
  const terms = useMemo(() => glossaryList(darbyGlossary()), [])
  const [word, setWord] = useState<WordTarget | null>(null)
  const showTerms = !query && letter === DARBY
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of index?.rows ?? []) { const k = sectionOf(r); m.set(k, (m.get(k) ?? 0) + 1) }
    return m
  }, [index])
  const letterRows = useMemo(() => index ? index.rows.filter(r => sectionOf(r) === letter) : [], [index, letter])
  const groups = useMemo(() => letter === SYNONYMS || letter === DARBY ? [] : twoLetterGroups(letterRows), [letter, letterRows])
  const rows: CbdIndexRow[] = useMemo(() => {
    if (!index) return []
    if (query) return searchHeadwords(index, query, Infinity)
    return group ? letterRows.filter(r => groupOf(r[1]) === group) : letterRows
  }, [index, query, group, letterRows])
  const listKey = query ? `q:${nameKey(query)}` : `${letter}:${group}`
  const paged = paginate(rows, pages[listKey] ?? 1, PAGE)
  const termsPaged = paginate(showTerms ? terms : [], pages[listKey] ?? 1, PAGE)
  const shown = showTerms ? termsPaged : paged
  /** Which way the last change went: a page turn leads in from its side, a new letter or group straight up. */
  const [dir, setDir] = useState(0)
  const pick = (l: string) => { setDir(0); setLetter(l); setGroup(''); setQ('') }
  const turn = (page: number) => {
    setDir(page > shown.page ? 1 : -1)
    setPages(p => ({ ...p, [listKey]: page }))
    // the pager sits under the list: bring the new page's first headword into view
    scroll.current?.scrollTo({ y: Math.max(0, listY.current - SPACE.s), animated: !reduce })
  }
  const open = (id: string) => router.push({ pathname: '/dictionary', params: { id, from: 'index' } })
  // a new letter, group, search or page staggers in; typing within a search narrows it still
  const fresh = useFreshList(`${index ? 1 : 0}:${query ? 'q' : listKey}#${shown.page}`)
  const title = query ? `${rows.length.toLocaleString()} ${rows.length === 1 ? 'headword matches' : 'headwords match'} “${query}”`
    : showTerms ? `Darby’s terms · ${terms.length} terms`
    : `${letter === SYNONYMS ? 'New Testament synonyms' : group || letter} · ${rows.length.toLocaleString()} ${rows.length === 1 ? 'headword' : 'headwords'}`

  return (
    <Screen animate={false} scrollRef={scroll}>
      <Stack.Screen options={{ title: 'Dictionary and concordance' }} />
      <Enter><H>Dictionary and concordance</H></Enter>
      <Enter delay={70}><T muted>The Bible’s people, places, things and teaching, from Morrish. Strong’s concordance is one tap away in the reader: turn on Word lookup and tap a word, or search a number such as G1320.</T></Enter>
      {index === undefined ? <Spinner /> : index === null ? <ErrorText>{UNAVAILABLE}</ErrorText> : (
        <>
          <Input value={q} onChangeText={t => { setDir(0); setQ(t) }} placeholder={`Search ${index.rows.length.toLocaleString()} articles`} autoCorrect={false} autoCapitalize="none" returnKeyType="search" accessibilityLabel="Search the dictionary" />
          {!query ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessibilityRole="tablist">
              {LETTERS.map(l => {
                const on = l === letter, n = counts.get(l) ?? 0
                return (
                  <Tap key={l} disabled={!n} onPress={() => pick(l)} scaleTo={0.9} accessibilityRole="tab" accessibilityState={{ selected: on, disabled: !n }} accessibilityLabel={`${l}, ${plural(n, 'article')}`}
                    style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.accentSoft : c.card, opacity: n ? 1 : 0.4 }}>
                    <Text style={{ color: on ? c.accent : c.text, fontSize: TYPE.body, ...face('serif', { bold: on }) }}>{l}</Text>
                  </Tap>
                )
              })}
            </View>
          ) : null}
          {/* the letter's two-letter groups, only those with headwords, each with its count */}
          {!query && groups.length > 1 ? (
            <FadeSwap k={letter}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessibilityRole="tablist" accessibilityLabel={`Groups under ${letter}`}>
                {[{ group: '', count: letterRows.length }, ...groups].map(g => (
                  <CountChip key={g.group || 'all'} label={g.group || `All ${letter}`} count={g.count} noun={['headword', 'headwords']} on={g.group === group} onPress={() => { setDir(0); setGroup(g.group) }} />
                ))}
              </View>
            </FadeSwap>
          ) : null}
          {!query ? (
            <Card style={{ gap: 0, paddingVertical: 8 }}>
              {letter !== SYNONYMS ? <ListRow icon="dictionary" label="New Testament synonyms" detail={`${Math.max(0, (counts.get(SYNONYMS) ?? 0) - 1)} studies of Greek words that share an English rendering`} onPress={() => pick(SYNONYMS)} /> : null}
              {letter !== DARBY ? <ListRow icon="companion" label="Darby’s terms" detail={`${terms.length} words J. N. Darby uses in his own sense, each with a sentence of his`} onPress={() => pick(DARBY)} /> : null}
            </Card>
          ) : null}
          <View style={{ gap: SPACE.m }} onLayout={e => { listY.current = e.nativeEvent.layout.y }}>
            <T small muted>{title}</T>
            {/* typing a search updates its list live; only a new list (letter, group, the search itself) or a page turn swaps */}
            <FadeSwap k={`${query ? 'q' : listKey}#${shown.page}`} dx={dir * TURN_DX}>
              {showTerms ? (
                <Card style={{ gap: 0, paddingVertical: 6 }}>
                  {termsPaged.items.map((e, i) => (
                    <Stagger key={e.term} index={i} cap={fresh ? STAGGER_CAP : 0}>
                      <Tap onPress={() => setWord({ code: '', word: bareTerm(e.term), term: e.term })} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={`${e.term}, Darby’s usage`} style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 8, gap: 2, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
                        <Text style={{ color: c.text, ...f.body }}>{e.term}</Text>
                        <Text style={{ color: c.muted, fontSize: TYPE.small, lineHeight: 19 }} numberOfLines={2}>{e.short}</Text>
                      </Tap>
                    </Stagger>
                  ))}
                </Card>
              ) : paged.items.length ? (
                <Card style={{ gap: 0, paddingVertical: 6 }}>
                  {paged.items.map((r, i) => {
                    const see = r[5] ? index.byId.get(r[5]) : undefined
                    return (
                      <Stagger key={r[0]} index={i} cap={fresh ? STAGGER_CAP : 0}>
                        <Tap onPress={() => open(r[0])} scaleTo={0.985} accessibilityRole="link" style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 6, borderTopWidth: i ? 1 : 0, borderTopColor: c.border }}>
                          <Text style={{ color: c.text, ...f.body }}>
                            {r[1]}
                            {see ? <Text style={{ color: c.muted, fontSize: TYPE.small, ...f.italic }}>{'  '}see {see[1]}</Text> : null}
                          </Text>
                        </Tap>
                      </Stagger>
                    )
                  })}
                </Card>
              ) : <T muted>No headword matches “{query}”.</T>}
            </FadeSwap>
            {shown.pages > 1 ? <Pager page={shown.page} pages={shown.pages} onPage={turn} /> : null}
          </View>
        </>
      )}
      <T small muted>{SOURCE}</T>
      <WordSheet target={word} onClose={() => setWord(null)} />
    </Screen>
  )
}
