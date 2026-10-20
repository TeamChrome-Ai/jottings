import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import type { WorkContents, WorkSummary } from '@shared/ministry'
import { t } from '@shared/i18n'
import { pickerLayout, shelfItems, shortTitle, worksNoun, type PickerItem, type Shelf } from '../lib/libraryNav'
import { useReadingFont } from '../hooks/useReadingFont'
import { useColors } from '../hooks/useTheme'
import { waveStep } from '../lib/springs'
import { mix } from '../theme'
import { CONFIRM_MS, Choice, Grid, pickerStyles } from './ChapterPicker'
import { FadeSwap, PopIn, Stagger, useReduceMotion } from './motion/nav'
import { Button, RADIUS, SPACE, Sheet, Spinner, T, TYPE, Tap } from './ui'

const NUM_W = 46
const PAD = 12
/** How far the New Testament's chips lean toward the accent: the Bible picker's. */
const NT_TINT = 0.08
/** Room kept above the current section when the contents open scrolled to it. */
const ABOVE = 72

/**
 * A work's contents, styled and moving like the Bible's book and chapter picker (ChapterPicker: its cells, its fill,
 * its wave after the sheet is up): a grid of numbers where the sections are numbered, titled pieces as chips in their
 * place, or a list of titles under their parts (a volume of letters, by number and year). When the work is one of a
 * collection, "All books" (or volumes) goes up to the collection's works (so does the system back), and a work chosen there
 * opens its contents.
 * Opens at the section being read, scrolled into view.
 */
export default function ContentsPicker({ open, author, shelf, work, contents, n, load, onClose, onPick }: {
  open: boolean; author: string; shelf: Shelf | null; work: string; contents: WorkContents | null | undefined; n: number
  /** Another work's contents, for choosing inside it. */
  load: (work: string) => Promise<WorkContents | null>
  onClose: () => void; onPick: (work: string, n: number) => void
}) {
  // what the sheet shows while it slides away stays as it was; each opening starts at the work being read
  const [view, setView] = useState<{ level: 'works' | 'sections'; work: string; contents: WorkContents | null | undefined }>({ level: 'sections', work, contents })
  const [picked, setPicked] = useState<{ work?: string; n?: number }>({})
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reduce = useReduceMotion()
  const wasOpen = useRef(false)
  if (open && !wasOpen.current && (view.work !== work || view.level !== 'sections' || view.contents !== contents || picked.work || picked.n)) {
    setView({ level: 'sections', work, contents }); setPicked({})
  }
  wasOpen.current = open
  useEffect(() => { if (open && view.work === work && view.contents !== contents) setView(v => ({ ...v, contents })) }, [open, work, contents, view.work, view.contents])
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current) }, [])
  const later = (fn: () => void) => { if (pending.current) clearTimeout(pending.current); if (reduce) fn(); else pending.current = setTimeout(fn, CONFIRM_MS) }
  const close = () => { if (pending.current) clearTimeout(pending.current); onClose() }
  const works = shelf?.collection.works ?? []
  const many = works.length > 1
  const openWork = (id: string) => {
    setPicked({ work: id })
    const got = load(id)
    later(() => {
      setView({ level: 'sections', work: id, contents: undefined })
      setPicked({})
      void got.then(c => setView(v => v.work === id ? { ...v, contents: c } : v))
    })
  }
  const pick = (k: number) => { setPicked(p => ({ ...p, n: k })); later(() => onPick(view.work, k)) }
  const summary = works.find(w => w.id === view.work)
  const title = view.level === 'works' ? shelf?.collection.title ?? '' : shortTitle(view.contents?.work.title ?? summary?.title ?? '')
  return (
    <Sheet open={open} onClose={close} onBack={many && view.level === 'sections' ? () => setView(v => ({ ...v, level: 'works' })) : undefined} title={title}>
      <Body level={view.level} author={author} works={works} many={many} viewWork={view.work} contents={view.contents}
        current={view.work === work ? n : -1} currentWork={work} picked={picked}
        onUp={() => setView(v => ({ ...v, level: 'works' }))} onWork={openWork} onPick={pick} />
    </Sheet>
  )
}

function Body({ level, author, works, many, viewWork, contents, current, currentWork, picked, onUp, onWork, onPick }: {
  level: 'works' | 'sections'; author: string; works: readonly WorkSummary[]; many: boolean; viewWork: string; contents: WorkContents | null | undefined
  current: number; currentWork: string; picked: { work?: string; n?: number }
  onUp: () => void; onWork: (id: string) => void; onPick: (n: number) => void
}) {
  const scroll = useRef<ScrollView>(null)
  const content = useRef<View>(null)
  const mark = useRef<View>(null)
  // opened at the section (or work) being read: once its cell or row is laid out, the list starts with it in view
  const placed = useRef(false)
  const k = `${level}/${viewWork}/${contents ? 1 : 0}`
  const lastK = useRef(k)
  if (lastK.current !== k) { lastK.current = k; placed.current = false }
  const place = () => {
    if (placed.current || !mark.current || !content.current) return
    placed.current = true
    mark.current.measureLayout(content.current as unknown as number, (_x, y) => { if (y > ABOVE * 2) scroll.current?.scrollTo({ y: y - ABOVE, animated: false }) }, () => {})
  }
  const noun = worksNoun(works)
  return (
    <ScrollView ref={scroll} contentContainerStyle={{ padding: PAD }}>
      <View ref={content} collapsable={false}>
        <FadeSwap k={`${level}/${viewWork}`}>
          {level === 'works' ? <WorksChooser author={author} works={works} current={currentWork} picked={picked.work} markRef={mark} onLaid={place} onWork={onWork} />
            : (
              <View style={{ gap: 10 }}>
                {many ? <Button small lead="back" title={noun === 'books' ? t('All books') : noun === 'papers' ? t('All papers') : t('All volumes')} onPress={onUp} style={pickerStyles.back} /> : null}
                {contents === undefined ? <Spinner /> : contents === null ? <T small muted>{t('The contents need a connection the first time they are opened.')}</T>
                  : <SectionsList key={viewWork} contents={contents} current={current} picked={picked.n} markRef={mark} onLaid={place} onPick={onPick} />}
              </View>
            )}
        </FadeSwap>
      </View>
    </ScrollView>
  )
}

type MarkRef = React.RefObject<View | null>

/** A work's sections as the picker lays them out (pickerLayout): the grid of numbers with titled pieces as chips, or
 * the list under its parts or years. The picker's second level, and the library's contents page for a volume. */
export function SectionsList({ contents, current, picked, markRef, onLaid, onPick }: { contents: WorkContents; current: number; picked?: number; markRef?: MarkRef; onLaid?: () => void; onPick: (n: number) => void }) {
  const c = useColors()
  const layout = useMemo(() => pickerLayout(contents.work.kind, contents.sections, contents.author), [contents])
  const count = contents.sections.length
  const step = waveStep(count)
  const settle = (i: number, wait: number) => wait + i * step + 90
  const sel = picked ?? current
  return (
    <Grid>{wait => layout.mode === 'grid' ? (
      <View style={{ gap: SPACE.l }}>
        {layout.groups.map((g, gi) => (
          <View key={`${gi}:${g.label}`} style={{ gap: SPACE.s }}>
            {g.label ? <Text style={[pickerStyles.group, { color: c.muted }]}>{g.label}</Text> : null}
            <View style={[pickerStyles.wrap, { alignItems: 'center' }]}>
              {g.items.map(it => {
                const i = it.n - 1
                return (
                  <PopIn key={it.n} index={i} cap={Infinity} step={step} base={wait}>
                    <View ref={it.n === current ? markRef : undefined} collapsable={false} onLayout={it.n === current ? onLaid : undefined}>
                      <Cell item={it} selected={it.n === sel} fillDelay={picked ? 0 : settle(i, wait)} onPress={() => onPick(it.n)} />
                    </View>
                  </PopIn>
                )
              })}
            </View>
          </View>
        ))}
      </View>
    ) : (
      <View style={{ gap: SPACE.l }}>
        {layout.groups.map((g, gi) => (
          <View key={`${gi}:${g.label}`} style={{ gap: 2 }}>
            {g.label ? <Text style={[pickerStyles.group, { color: c.muted }]}>{g.label}</Text> : null}
            {g.items.map(it => {
              const i = it.n - 1
              return (
                <Stagger key={it.n} index={i} base={wait}>
                  <View ref={it.n === current ? markRef : undefined} collapsable={false} onLayout={it.n === current ? onLaid : undefined}>
                    <ListItem item={it} selected={it.n === sel} onPress={() => onPick(it.n)} />
                  </View>
                </Stagger>
              )
            })}
          </View>
        ))}
      </View>
    )}</Grid>
  )
}
/** A number (fixed width, wider for a range) or a titled piece (a chip), as the Bible picker draws them. */
function Cell({ item, selected, fillDelay, onPress }: { item: PickerItem; selected: boolean; fillDelay: number; onPress: () => void }) {
  const c = useColors()
  return <Choice label={item.cell} selected={selected} fillDelay={fillDelay} onPress={onPress} fontSize={item.numbered ? 15 : 14} bg={c.card}
    style={item.numbered ? { ...pickerStyles.num, width: undefined, minWidth: NUM_W, paddingHorizontal: 8 } : pickerStyles.chip} />
}

/** A row of the list: the title in the reading font (a letter's number before it, in the accent), its line under it. */
function ListItem({ item, selected, onPress }: { item: PickerItem; selected: boolean; onPress: () => void }) {
  const c = useColors()
  const f = useReadingFont(16, 1.3)
  return (
    <Tap onPress={onPress} scaleTo={0.985} accessibilityRole="button" accessibilityState={{ selected }} aria-selected={selected}
      style={{ flexDirection: 'row', gap: 10, minHeight: 44, paddingVertical: 8, paddingHorizontal: 10, borderRadius: RADIUS.control, backgroundColor: selected ? c.accentSoft : 'transparent' }}>
      {item.lead ? <Text style={{ color: c.accent, fontSize: TYPE.small, fontWeight: '700', minWidth: 26, paddingTop: 2, fontVariant: ['tabular-nums'] }}>{item.lead}</Text> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: selected ? c.accent : c.text, ...f.body }}>{item.title}</Text>
        {item.detail ? <Text style={{ color: c.muted, fontSize: TYPE.small }}>{item.detail}</Text> : null}
      </View>
    </Tap>
  )
}

/** A collection's works: book chips by testament (the Synopsis, the Outlines) or a list of volumes. The picker's first
 * level, and the library's page for a collection. */
export function WorksChooser({ author, works, current, picked, markRef, onLaid, onWork }: { author: string; works: readonly WorkSummary[]; current: string; picked?: string; markRef?: MarkRef; onLaid?: () => void; onWork: (id: string) => void }) {
  const c = useColors()
  const shelfed = useMemo(() => shelfItems(works, author), [works, author])
  const step = waveStep(works.length)
  const idx = works.findIndex(w => w.id === (picked ?? current))
  const ntFill = mix(c.card, c.accent, NT_TINT), ntBorder = mix(c.border, c.accent, NT_TINT * 3)
  let i = -1
  return (
    <Grid>{wait => shelfed.books ? (
      <View style={{ gap: SPACE.l }}>
        {shelfed.groups.map(g => (
          <View key={g.label || 'other'} style={{ gap: SPACE.s }}>
            {g.label ? <Text style={[pickerStyles.group, { color: c.muted }]}>{g.label}</Text> : null}
            <View style={pickerStyles.wrap}>
              {g.items.map(it => {
                i++
                const nt = it.testament === 'NT'
                return (
                  <PopIn key={it.id} index={i} cap={Infinity} step={step} base={wait}>
                    <View ref={it.id === current ? markRef : undefined} collapsable={false} onLayout={it.id === current ? onLaid : undefined}>
                      <Choice label={it.label} selected={it.id === (picked ?? current)} fillDelay={picked ? 0 : wait + idx * step + 90} onPress={() => onWork(it.id)}
                        style={pickerStyles.chip} fontSize={14} bg={nt ? ntFill : c.card} border={nt ? ntBorder : undefined} />
                    </View>
                  </PopIn>
                )
              })}
            </View>
          </View>
        ))}
      </View>
    ) : (
      <View style={{ gap: 2 }}>
        {shelfed.groups[0].items.map((it, k) => (
          <Stagger key={it.id} index={k} base={wait}>
            <View ref={it.id === current ? markRef : undefined} collapsable={false} onLayout={it.id === current ? onLaid : undefined}>
              <ListItem item={{ n: k + 1, cell: it.label, numbered: false, title: it.title, detail: it.detail }} selected={it.id === (picked ?? current)} onPress={() => onWork(it.id)} />
            </View>
          </Stagger>
        ))}
      </View>
    )}</Grid>
  )
}
