import { useCallback, useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { Stack, useFocusEffect, useRouter } from 'expo-router'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { PATH_IDS, chapterKey, pathBlurb, pathBooks, pathChapters, pathCompanion, pathLength, pathTitle, progress as progressOf, readSetSince, type PathHistoryEntry, type PathId } from '@shared/paths'
import { get } from '../src/lib/api'
import { PATH_READS_KEY, refreshPath, usePath } from '../src/lib/paths'
import { useReadTicks } from '../src/hooks/useReadTicks'
import { useEdition } from '../src/lib/edition'
import { pathOffered } from '../src/lib/editionCore'
import { countWords, paceLine, paceWords, portionTitle, thenLine } from '../src/lib/pathWords'
import { useAuth } from '../src/store/auth'
import { useInks } from '../src/hooks/useTheme'
import { face } from '../src/theme'
import { confirmAsync, plural } from '../src/lib/community'
import PathStrip from '../src/components/PathStrip'
import { CustomPathSheet, MonthPicker, PathOptions, StartPathSheet } from '../src/components/PathSheets'
import { Button, Card, Enter, ErrorText, H2, ListRow, Row, SPACE, Screen, Sheet, Spinner, T, TYPE, Tap } from '../src/components/ui'
import { FadeSwap } from '../src/components/motion/nav'

type LocalRead = [book: number, chapter: number, at: string]
const NO_READS = new Set<string>()

/**
 * Library → Paths (docs/PATHS.md "Surfaces"): the strip for the active path (or, with none, the whole Bible with what
 * has ever been read), the active path's card with its next portion, count, target or pace and pairing, then the
 * eight built-in paths and the reader's own. Nothing is ticked on this screen: the reading moves the strip, and so does
 * a chapter the reader marked read at its end (their own view; lib/readMarks.ts).
 */
export default function PathsScreen() {
  const router = useRouter()
  const c = useInks()
  const { user, ready } = useAuth()
  const path = usePath()
  const edition = useEdition()
  const [startId, setStartId] = useState<PathId | null>(null)
  const [custom, setCustom] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  // the whole-Bible strip's reads: the account's chapters ever credited, or this device's own
  const [ever, setEver] = useState<{ set: Set<string>; local: LocalRead[] } | null>(null)
  /** With the chapters the reader marked read by hand: this strip is their own view. */
  const everRead = useReadTicks(ever?.set ?? NO_READS)
  useFocusEffect(useCallback(() => {
    if (!ready) return
    let cancelled = false
    const local = AsyncStorage.getItem(PATH_READS_KEY).then((s): LocalRead[] => { try { return s ? JSON.parse(s) as LocalRead[] : [] } catch { return [] } }, () => [] as LocalRead[])
    const server = user ? get<Record<string, number[]>>('/stats/progress').then(p => Object.entries(p).flatMap(([b, cs]) => cs.map(ch => chapterKey(Number(b), ch))), () => [] as string[]) : Promise.resolve([] as string[])
    Promise.all([local, server]).then(([l, s]) => { if (!cancelled) setEver({ set: new Set([...s, ...l.map(([b, ch]) => chapterKey(b, ch))]), local: l }) })
    void refreshPath()
    return () => { cancelled = true }
  }, [ready, user?.id]))

  const state = path.state
  const chapters = useMemo(() => state ? pathChapters(state) : null, [state])
  const route = useMemo(() => state ? pathBooks(state) : null, [state])
  const openChapter = (book: number, chapter: number) => router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(book), chapter: String(chapter) } })
  /** A tap on a route book: its first unread chapter on the path, else its first. */
  const openBook = (book: number) => {
    const onBook = chapters?.filter(([b]) => b === book) ?? []
    const first = onBook.find(([b, ch]) => !path.readSet.has(chapterKey(b, ch))) ?? onBook[0]
    if (first) openChapter(first[0], first[1])
  }
  const stop = async () => {
    if (!state) return
    if (!(await confirmAsync(`Stop ${pathTitle(state)}?`, 'The path and its history go; what you have read stays read.', 'Stop'))) return
    await path.stop()
  }
  const resumes = (id: PathId) => path.history.some(h => h.id === id)
  const historyCount = (h: PathHistoryEntry): string => {
    // signed out the device's own reads since that start are the truth; signed in the server keeps only the active path's
    if (user || !ever) return ''
    const pr = progressOf(h, readSetSince(ever.local, h.started_at))
    return `, ${pr.done} of ${pr.total}`
  }
  const busy = !ready || path.loading || (!state && !ever)

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Paths' }} />
      {busy ? <Spinner /> : (
        <>
          <Enter>
            <FadeSwap k={state ? `${state.id}:${state.started_at}` : 'bible'}>
              <Card style={{ gap: SPACE.m }}>
                {state && chapters && path.progress ? (
                  <PathStrip route={route} routeChapters={chapters} readSet={path.readSet} place={path.next?.portion ?? null} onBook={openBook} delay={120}
                    accessibilityLabel={`${pathTitle(state)}: ${path.progress.done} of ${plural(path.progress.total, 'chapter')} read`} />
                ) : (
                  <>
                    <PathStrip route={null} readSet={ever ? everRead : null} delay={120} accessibilityLabel={`The Bible: ${plural(ever ? everRead.size : 0, 'chapter')} read`} />
                    <T small muted>{ever && everRead.size ? `What you have read so far: ${everRead.size} of 1,189 chapters. ` : ''}No path at the moment. A path is an order of chapters, never a calendar; set a date only if you want one.</T>
                  </>
                )}
              </Card>
            </FadeSwap>
          </Enter>

          {state && path.progress ? (
            <Enter delay={80}>
              <Card style={{ gap: SPACE.m }}>
                <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T bold style={{ fontSize: TYPE.heading }}>{pathTitle(state)}</T>
                    {path.next ? (
                      <>
                        <T small muted style={{ marginTop: 6 }}>Next on your path</T>
                        <Text style={{ color: c.text, fontSize: 22, ...face('serif', { bold: true }) }}>{portionTitle(path.next.portion)}</Text>
                        {thenLine(path.next.portion) ? <T small muted>{thenLine(path.next.portion)}</T> : null}
                      </>
                    ) : <T style={{ marginTop: 6 }}>You have read it all.</T>}
                  </View>
                  <T bold style={{ fontSize: 20, fontVariant: ['tabular-nums'] }}>{countWords(path.progress)}</T>
                </Row>
                {paceLine(path.paceNeeded, path.standing, state.target_date) ? <T small muted>{paceLine(path.paceNeeded, path.standing, state.target_date)}</T>
                  : paceWords(state.pace_per_week) ? <T small muted>{paceWords(state.pace_per_week)}, by your own reckoning</T> : null}
                {path.next ? <Button title={`Open ${portionTitle(path.next.portion)}`} primary onPress={() => openChapter(path.next!.portion.book, path.next!.portion.chapter)} style={{ alignSelf: 'flex-start' }} /> : null}
                <PathOptions value={{ target_date: state.target_date, pace_per_week: state.pace_per_week, with_ministry: state.with_ministry }} companion={pathCompanion(state)} onPickDate={() => setDateOpen(true)}
                  onChange={p => { if (p.target_date !== undefined) void path.setTargetDate(p.target_date); if (p.pace_per_week !== undefined) void path.setPace(p.pace_per_week); if (p.with_ministry !== undefined) void path.setWithMinistry(p.with_ministry) }} />
                <Row>
                  {state.id === 'custom' ? <Button title="Change the books" small onPress={() => setCustom(true)} /> : null}
                  <Button title="Stop this path" small danger onPress={stop} />
                </Row>
                {path.error ? <ErrorText>{path.error}</ErrorText> : null}
              </Card>
            </Enter>
          ) : path.error ? <ErrorText>{path.error}</ErrorText> : null}

          <Enter delay={160} style={{ gap: SPACE.m }}>
            <H2 hint="Reading plans, no dates unless you set one">Paths</H2>
            <Card style={{ gap: 0, paddingVertical: 8 }}>
              {PATH_IDS.filter(id => pathOffered(id, edition)).map(id => (
                <ListRow key={id} label={pathTitle(id)} icon={state?.id === id ? 'check' : undefined} detail={`${pathBlurb(id)} ${pathLength(id).toLocaleString('en')} chapters.`} onPress={() => setStartId(id)} />
              ))}
              <ListRow label="Your own" icon={state?.id === 'custom' ? 'check' : undefined} detail={state?.id === 'custom' ? `${pathTitle(state)}: ${pathBlurb(state)}` : 'Any books, in the order you choose'} onPress={() => setCustom(true)} />
            </Card>
            {path.history.length ? (
              <View style={{ gap: 4 }}>
                {path.history.map(h => (
                  <Tap key={`${h.id}:${h.started_at}`} onPress={() => void path.start(h.id, h.id === 'custom' && h.custom ? { custom: h.custom } : undefined)} accessibilityRole="button" accessibilityLabel={`Resume ${pathTitle(h)}`} scaleTo={0.99} style={{ paddingHorizontal: 4 }}>
                    <T small muted>Also started: {pathTitle(h)}{historyCount(h)} · <T small accent bold>Resume</T></T>
                  </Tap>
                ))}
              </View>
            ) : null}
          </Enter>
        </>
      )}

      <StartPathSheet id={startId} open={startId !== null} onClose={() => setStartId(null)} active={state} resumes={startId ? resumes(startId) : false} onStart={(id, opts) => path.start(id, opts)} />
      <CustomPathSheet open={custom} onClose={() => setCustom(false)} initial={state?.id === 'custom' ? state.custom : null} onStart={cu => state?.id === 'custom' ? path.setCustom(cu) : path.start('custom', { custom: cu })} />
      <Sheet open={dateOpen} onClose={() => setDateOpen(false)} title="Finish by">
        <View style={{ paddingHorizontal: SPACE.l, paddingBottom: SPACE.s }}>
          {dateOpen ? <MonthPicker value={state?.target_date ?? null} onPick={d => { setDateOpen(false); void path.setTargetDate(d) }} /> : null}
        </View>
      </Sheet>
    </Screen>
  )
}
