import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { BOOKS } from '@shared/books'
import { dayOf, defaultWithMinistry, pathBlurb, pathCompanion, pathLength, pathTitle, type CustomPath, type PathId, type PathState } from '@shared/paths'
import type { AuthorId } from '@shared/companion'
import { t, tc, tn } from '@shared/i18n'
import { useInks } from '../hooks/useTheme'
import { useReduceMotion } from '../store/prefs'
import { MONTH_NAMES, WEEKDAY_LETTERS, addMonths, endOfYear, fmtTargetDay, monthGrid, paceWords } from '../lib/pathWords'
import type { StartOptions } from '../lib/paths'
import { CONFIRM_MS, Choice, Grid, pickerStyles } from './ChapterPicker'
import { FadeSwap, PopIn } from './motion/nav'
import { Button, Chip, Input, ListRow, Row, SPACE, Segmented, Sheet, SwitchRow, T, TYPE } from './ui'

/**
 * The Paths screen's sheets and the controls they share with the active path's card (docs/PATHS.md "Library → Paths"):
 * a target day from a calm month grid (no native picker: the chapter picker's cells, the Lord's day first, three
 * presets), a pace when there is no target, the ministry pairing for the two companion paths; Start for a built-in
 * path and for the reader's own books. One sheet holds its month view in place of its options (Back returns), so no
 * sheet ever opens over another.
 */

// ---------------- the calendar ----------------

/** A month of days as cells, `value` filled, days before today faded and dead; presets under it. Picks call `onPick` (null: no date). */
export function MonthPicker({ value, onPick, today = dayOf() }: { value: string | null; onPick: (day: string | null) => void; today?: string }) {
  const c = useInks()
  const reduce = useReduceMotion()
  const start = value && value > today ? value : today
  const [ym, setYm] = useState(() => ({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) }))
  const [picked, setPicked] = useState<string | null>(null)
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (pending.current) clearTimeout(pending.current) }, [])
  const rows = useMemo(() => monthGrid(ym.y, ym.m, today), [ym, today])
  const move = (n: number) => { const t = ym.y * 12 + (ym.m - 1) + n; setYm({ y: Math.floor(t / 12), m: t % 12 + 1 }) }
  const atFirst = ym.y === Number(today.slice(0, 4)) && ym.m === Number(today.slice(5, 7))
  // the tapped day shows its fill for a beat before the sheet moves on, as the chapter picker does
  const pick = (day: string | null) => { setPicked(day); if (pending.current) clearTimeout(pending.current); if (reduce) onPick(day); else pending.current = setTimeout(() => onPick(day), CONFIRM_MS) }
  const inMonth = addMonths(today, 1), eoy = endOfYear(today)
  const sel = picked ?? value
  return (
    <View style={{ gap: SPACE.m }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
        <Button iconName="prev" title={t('Previous month')} small onPress={() => move(-1)} disabled={atFirst} />
        <T bold>{MONTH_NAMES[ym.m - 1]} {ym.y}</T>
        <Button iconName="next" title={t('Next month')} small onPress={() => move(1)} />
      </Row>
      <FadeSwap k={`${ym.y}-${ym.m}`}>
        <Grid>{wait => (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {WEEKDAY_LETTERS.map((l, i) => <T key={i} small muted style={{ flex: 1, textAlign: 'center', fontSize: TYPE.caption }}>{l}</T>)}
            </View>
            {rows.map((row, r) => (
              <View key={r} style={{ flexDirection: 'row', gap: 6 }}>
                {row.map((cell, i) => cell.day ? (
                  <PopIn key={cell.day} index={r * 7 + i} cap={42} step={6} base={wait} style={{ flex: 1, opacity: cell.past ? 0.35 : 1 }}>
                    <View pointerEvents={cell.past ? 'none' : 'auto'}>
                      <Choice label={String(cell.n)} name={cell.today ? t('{day} {month}, today', { day: cell.n, month: MONTH_NAMES[ym.m - 1] }) : t('{day} {month}', { day: cell.n, month: MONTH_NAMES[ym.m - 1] })} selected={cell.day === sel} fillDelay={0} onPress={() => pick(cell.day)}
                        style={month.cell} fontSize={15} bg={cell.today ? c.selected : c.card} />
                    </View>
                  </PopIn>
                ) : <View key={`b${i}`} style={{ flex: 1 }} />)}
              </View>
            ))}
          </View>
        )}</Grid>
      </FadeSwap>
      <Row>
        <Chip label={t('In a month')} detail={fmtTargetDay(inMonth, today)} on={sel === inMonth} onPress={() => pick(inMonth)} tab />
        <Chip label={t('By the end of the year')} on={sel === eoy} onPress={() => pick(eoy)} tab />
        <Chip label={t('No date')} on={sel === null} onPress={() => pick(null)} tab />
      </Row>
    </View>
  )
}
const month = StyleSheet.create({ cell: { flex: 1, height: 40, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' } })

// ---------------- the options a path carries ----------------

type PaceChoice = 'none' | '3' | '5' | '7' | 'other'
const paceOptions = (): { value: PaceChoice; label: string }[] => [{ value: 'none', label: tc('pace', 'None') }, { value: '3', label: t('3 a week') }, { value: '5', label: '5' }, { value: '7', label: '7' }, { value: 'other', label: t('Other') }]
const paceChoice = (p: number | null): PaceChoice => p == null ? 'none' : p === 3 || p === 5 || p === 7 ? String(p) as PaceChoice : 'other'

export interface Options { target_date: string | null; pace_per_week: number | null; with_ministry: boolean }
/**
 * "Finish by" (opens the month view), the pace while there is no target (a target makes the pace exact by itself), and
 * for the two companion paths the pairing switch. `companion` names the path's author, undefined for the rest.
 */
export function PathOptions({ value, onChange, onPickDate, companion }: { value: Options; onChange: (patch: Partial<Options>) => void; onPickDate: () => void; companion: AuthorId | undefined }) {
  const [other, setOther] = useState(value.pace_per_week != null && paceChoice(value.pace_per_week) === 'other' ? String(value.pace_per_week) : '')
  const choice = paceChoice(value.pace_per_week)
  const [otherOpen, setOtherOpen] = useState(choice === 'other')
  const setChoice = (v: PaceChoice) => {
    if (v === 'other') { setOtherOpen(true); return }
    setOtherOpen(false)
    onChange({ pace_per_week: v === 'none' ? null : Number(v) })
  }
  const commitOther = () => { const n = Math.round(Number(other)); if (n >= 1 && n <= 200) onChange({ pace_per_week: n }) }
  return (
    <View style={{ gap: 4 }}>
      <ListRow label={t('Finish by')} detail={value.target_date ? t('{day} · the app says exactly how many a day', { day: fmtTargetDay(value.target_date) }) : t('No date · a path is an order, not a calendar')} onPress={onPickDate} />
      {!value.target_date ? (
        <View style={{ gap: 8, paddingVertical: 6 }}>
          <T>{t('Pace')} <T muted>{paceWords(value.pace_per_week) ? `· ${paceWords(value.pace_per_week)}` : ''}</T></T>
          <Segmented value={otherOpen ? 'other' : choice} options={paceOptions()} onChange={setChoice} />
          {otherOpen ? (
            <Row style={{ flexWrap: 'nowrap' }}>
              <Input value={other} onChangeText={setOther} placeholder={t('Chapters a week')} keyboardType="number-pad" inputMode="numeric" maxLength={3} style={{ flex: 1, minWidth: 0 }} onSubmitEditing={commitOther} onBlur={commitOther} />
              <Button title={tc('verb', 'Set')} small onPress={commitOther} disabled={!(Number(other) >= 1)} />
            </Row>
          ) : null}
        </View>
      ) : null}
      {companion ? (
        <SwitchRow label={companion === 'darby' ? t('With Darby’s Synopsis') : t('With Coates’s Outlines')} hint={value.with_ministry ? t('Each chapter, then the section on it') : t('The chapters alone, in the same order')} value={value.with_ministry} onChange={v => onChange({ with_ministry: v })} />
      ) : null}
    </View>
  )
}

/** A sheet with two views, its options and the month grid, swapped in place; Back (and the header's own) returns. */
function TwoViewSheet({ open, onClose, title, view, setView, options, month: monthView }: { open: boolean; onClose: () => void; title: string; view: 'options' | 'date'; setView: (v: 'options' | 'date') => void; options: ReactNode; month: ReactNode }) {
  return (
    <Sheet open={open} onClose={onClose} onBack={view === 'date' ? () => setView('options') : undefined} title={view === 'date' ? t('Finish by') : title} maxHeight="88%">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: SPACE.l, paddingBottom: SPACE.s, gap: SPACE.m }}>
        <FadeSwap k={view}>{view === 'date' ? monthView : options}</FadeSwap>
      </ScrollView>
    </Sheet>
  )
}

// ---------------- start a built-in path ----------------

/**
 * Start (or Resume / Switch to) a built-in path with its target or pace and its pairing chosen first. `active` is the
 * reader's current path, `resumes` whether `id` waits in history.
 */
export function StartPathSheet({ id, open, onClose, active, resumes, onStart }: { id: PathId | null; open: boolean; onClose: () => void; active: PathState | null | undefined; resumes: boolean; onStart: (id: PathId, opts: StartOptions) => Promise<void> }) {
  const [view, setView] = useState<'options' | 'date'>('options')
  const [opts, setOpts] = useState<Options>({ target_date: null, pace_per_week: null, with_ministry: id ? defaultWithMinistry(id) : false })
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setView('options'); setOpts({ target_date: null, pace_per_week: null, with_ministry: id ? defaultWithMinistry(id) : false }) } }, [open, id])
  if (!id) return null
  const isActive = active?.id === id
  const verb = isActive ? t('Keep going') : resumes ? t('Resume') : active ? t('Switch to it') : t('Start')
  const go = async () => {
    setBusy(true)
    try { await onStart(id, opts); onClose() } finally { setBusy(false) }
  }
  return (
    <TwoViewSheet open={open} onClose={onClose} title={pathTitle(id)} view={view} setView={setView}
      month={<MonthPicker value={opts.target_date} onPick={d => { setOpts(o => ({ ...o, target_date: d })); setView('options') }} />}
      options={(
        <View style={{ gap: SPACE.m }}>
          <T muted>{pathBlurb(id)} <T muted bold>{tn(pathLength(id), '{n} chapter.', '{n} chapters.')}</T></T>
          {!isActive ? <PathOptions value={opts} onChange={p => setOpts(o => ({ ...o, ...p }))} onPickDate={() => setView('date')} companion={pathCompanion(id)} /> : null}
          {active && !isActive ? <T small muted>{resumes ? t('You began this path before; it goes on from where you left it. {path} waits in your history.', { path: pathTitle(active) }) : t('{path} keeps its start and waits in your history.', { path: pathTitle(active) })}</T> : null}
          <Row style={{ justifyContent: 'flex-end' }}>
            <Button title={t('Cancel')} onPress={onClose} disabled={busy} />
            <Button title={verb} primary onPress={isActive ? onClose : go} disabled={busy} />
          </Row>
        </View>
      )} />
  )
}

// ---------------- the reader's own path ----------------

/** A title and whole books, in the order they are tapped (a tap on a chosen book takes it out again). */
export function CustomPathSheet({ open, onClose, initial, onStart }: { open: boolean; onClose: () => void; initial?: CustomPath | null; onStart: (custom: CustomPath) => Promise<void> }) {
  const c = useInks()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [books, setBooks] = useState<number[]>(initial?.books ?? [])
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setTitle(initial?.title ?? ''); setBooks(initial?.books ?? []) } }, [open, initial])
  const toggle = (n: number) => setBooks(b => b.includes(n) ? b.filter(x => x !== n) : [...b, n])
  const chapters = books.reduce((s, b) => s + (BOOKS[b - 1]?.chapters ?? 0), 0)
  const go = async () => {
    setBusy(true)
    try { await onStart({ title: title.trim(), books }); onClose() } finally { setBusy(false) }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t('Your own path')} maxHeight="90%">
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: SPACE.l, paddingBottom: SPACE.s, gap: SPACE.m }}>
        <Input placeholder={t('A name for it (optional)')} value={title} onChangeText={setTitle} maxLength={60} />
        <T small muted>{books.length ? tn(chapters, '{books} · {n} chapter, in the order you tap them', '{books} · {n} chapters, in the order you tap them', { books: tn(books.length, '{n} book', '{n} books') }) : t('Tap the books to read, in order')}</T>
        <Grid>{wait => (
          <View style={{ gap: SPACE.l }}>
            {(['OT', 'NT'] as const).map(testament => (
              <View key={testament} style={{ gap: SPACE.s }}>
                <T small muted style={pickerStyles.group}>{testament === 'OT' ? t('Old Testament') : t('New Testament')}</T>
                <View style={pickerStyles.wrap}>
                  {BOOKS.map((bk, i) => {
                    if (bk.testament !== testament) return null
                    const at = books.indexOf(bk.n) + 1
                    return (
                      <PopIn key={bk.n} index={i} cap={66} step={4} base={wait}>
                        <Choice label={bk.abbr} name={at ? t('{book}, {at} of {count}', { book: bk.name, at, count: books.length }) : bk.name} selected={at > 0} order={at || undefined} fillDelay={0} onPress={() => toggle(bk.n)} style={pickerStyles.chip} fontSize={14} bg={c.card} />
                      </PopIn>
                    )
                  })}
                </View>
              </View>
            ))}
          </View>
        )}</Grid>
        {books.length > 1 ? <T small muted>{t('In this order: {books}', { books: books.map(n => BOOKS[n - 1]?.name).join(', ') })}</T> : null}
        <Row style={{ justifyContent: 'flex-end' }}>
          <Button title={t('Cancel')} onPress={onClose} disabled={busy} />
          <Button title={t('Start')} primary onPress={go} disabled={busy || books.length === 0} />
        </Row>
      </ScrollView>
    </Sheet>
  )
}
