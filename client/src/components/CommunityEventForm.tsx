import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { BOOKS } from '@shared/books'
import { t, tc } from '@shared/i18n'
import { patch, post } from '../lib/api'
import { useColors, useInks } from '../hooks/useTheme'
import { addDays, errMsg, isMetric, type GroupEventFull } from '../lib/community'
import {
  BOOKS_HINT, COUNTS_FROM, DATES_HINT, DESCRIPTION_HINT, GOAL_HINT, LATE_JOIN_HINT, METRICS, REPEATS, VISIBILITIES, booksLabel, draftOf, explainOf,
  isOneOf, metricInfo, payloadOf, problems, scoreFormula, usesBooks, type EventDraft,
} from '../lib/events'
import { localDay } from '../lib/localDay'
import { Choice, pickerStyles } from './ChapterPicker'
import { Field, SheetBody } from './CommunityBits'
import { Button, ErrorText, Input, Row, Segmented, SwitchRow, T } from './ui'

/**
 * Create (no `event`) or edit an event. Every option carries one line under it saying exactly what it counts or does
 * (client/src/lib/events.ts); the validation there mirrors the server's.
 */
export function EventForm({ slug, event, onDone, onCancel }: { slug: string; event?: GroupEventFull; onDone: () => void; onCancel: () => void }) {
  const [d, setD] = useState<EventDraft>(() => draftOf(event, localDay()))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const set = <K extends keyof EventDraft>(k: K, v: EventDraft[K]) => setD(prev => ({ ...prev, [k]: v }))
  const issues = problems(d)
  const tw = Number(d.time_weight), pw = Number(d.page_weight)

  const submit = async () => {
    setTouched(true)
    if (issues.length) return
    setBusy(true); setErr(null)
    try {
      if (event) await patch(`/groups/${slug}/events/${event.id}`, payloadOf(d))
      else await post(`/groups/${slug}/events`, payloadOf(d))
      onDone()
    } catch (ex) { setErr(errMsg(ex)) } finally { setBusy(false) }
  }

  return (
    <SheetBody>
      <Field label={t('Name')}>
        <Input value={d.name} onChangeText={v => set('name', v)} placeholder={t('A week of Psalms')} maxLength={80} autoFocus={!event} />
      </Field>
      <Field label={t('Description')} hint={t('optional')}>
        <Input value={d.description} onChangeText={v => set('description', v)} placeholder={t('Read the Gospels together this month')} maxLength={120} />
        <Hint>{t(DESCRIPTION_HINT)}</Hint>
      </Field>
      <Field label={t('Metric')}>
        <Segmented value={d.metric} options={METRICS.map(m => ({ value: m.value, label: m.label }))} onChange={v => { if (isMetric(v)) set('metric', v) }} />
        <Hint>{metricInfo(d.metric).label}: {metricInfo(d.metric).explain}</Hint>
      </Field>
      {d.metric === 'score' && (
        <View style={{ gap: 4 }}>
          <Row style={{ flexWrap: 'nowrap' }}>
            <View style={{ flex: 1 }}>
              <Field label={t('Time weight')} hint={t('points per minute')}><Input value={d.time_weight} onChangeText={v => set('time_weight', v)} keyboardType="decimal-pad" /></Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label={t('Chapter weight')} hint={t('points per chapter')}><Input value={d.page_weight} onChangeText={v => set('page_weight', v)} keyboardType="decimal-pad" /></Field>
            </View>
          </Row>
          {Number.isFinite(tw) && Number.isFinite(pw) ? <Hint>{scoreFormula(tw, pw)}</Hint> : null}
        </View>
      )}
      <View style={{ gap: 4 }}>
        <Row style={{ flexWrap: 'nowrap' }}>
          <View style={{ flex: 1 }}>
            <Field label={t('Starts')} hint={t('YYYY-MM-DD')}><Input value={d.starts_at} onChangeText={v => set('starts_at', v.trim())} placeholder={localDay()} autoCapitalize="none" maxLength={10} /></Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('Ends')} hint={t('YYYY-MM-DD')}><Input value={d.ends_at} onChangeText={v => set('ends_at', v.trim())} placeholder={addDays(localDay(), 6)} autoCapitalize="none" maxLength={10} /></Field>
          </View>
        </Row>
        <Hint>{t(DATES_HINT)}</Hint>
      </View>
      <Field label={t('Goal')} hint={t('optional, in the metric’s unit')}>
        <Input value={d.goal} onChangeText={v => set('goal', v)} placeholder={tc('goal', 'none')} keyboardType="decimal-pad" />
        <Hint>{t(GOAL_HINT)}</Hint>
      </Field>
      <Field label={t('Books')}>
        <BooksPick value={d.books} onChange={b => set('books', b)} />
        <Hint>{usesBooks(d.metric) ? t(BOOKS_HINT) : `${t(BOOKS_HINT)} ${t('{metric} is not affected.', { metric: metricInfo(d.metric).label })}`}</Hint>
      </Field>
      <Field label={t('Leaderboard')}>
        <Segmented value={d.visibility} options={VISIBILITIES.map(o => ({ value: o.value, label: o.label }))} onChange={v => { if (isOneOf(VISIBILITIES, v)) set('visibility', v) }} />
        <Hint>{explainOf(VISIBILITIES, d.visibility)}</Hint>
      </Field>
      <Field label={t('Counting from')}>
        <Segmented value={d.counts_from} options={COUNTS_FROM.map(o => ({ value: o.value, label: o.label }))} onChange={v => { if (isOneOf(COUNTS_FROM, v)) set('counts_from', v) }} />
        <Hint>{explainOf(COUNTS_FROM, d.counts_from)}</Hint>
      </Field>
      <Field label={tc('event', 'Repeat')}>
        <Segmented value={d.repeat} options={REPEATS.map(o => ({ value: o.value, label: o.label }))} onChange={v => { if (isOneOf(REPEATS, v)) set('repeat', v) }} />
        <Hint>{explainOf(REPEATS, d.repeat)}</Hint>
      </Field>
      <SwitchRow label={t('Late joiners score')} hint={d.late_join ? LATE_JOIN_HINT.on : LATE_JOIN_HINT.off} value={d.late_join} onChange={v => set('late_join', v)} />
      {touched && issues.length > 0 && <View style={{ gap: 2 }}>{issues.map(p => <ErrorText key={p}>{p}</ErrorText>)}</View>}
      {err && <ErrorText>{err}</ErrorText>}
      <Row style={{ justifyContent: 'flex-end' }}>
        <Button title={t('Cancel')} onPress={onCancel} disabled={busy} />
        <Button title={event ? t('Save changes') : t('Create event')} primary onPress={submit} disabled={busy} />
      </Row>
    </SheetBody>
  )
}

/** The one line under a control. */
function Hint({ children }: { children: React.ReactNode }) { return <T small muted>{children}</T> }

const TESTAMENTS = [{ testament: 'OT', label: () => t('Old Testament') }, { testament: 'NT', label: () => t('New Testament') }] as const

/**
 * The books that count, as the reader's book chips (ChapterPicker): tap to add or drop a book, "All books" to clear.
 * Inline and collapsible: nesting a second Modal inside the form's Sheet misbehaves on iOS.
 */
function BooksPick({ value, onChange }: { value: number[]; onChange: (b: number[]) => void }) {
  const c = useColors()
  const ink = useInks()
  const [open, setOpen] = useState(false)
  const chosen = new Set(value)
  const toggle = (n: number) => { const next = new Set(chosen); if (next.has(n)) next.delete(n); else next.add(n); onChange([...next].sort((a, b) => a - b)) }
  const summary = booksLabel(value)
  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => setOpen(o => !o)} accessibilityRole="button" accessibilityLabel={t('Books: {summary}', { summary })} accessibilityState={{ expanded: open }}
        style={{ backgroundColor: c.card, borderColor: open ? c.accent : 'transparent', borderWidth: 2, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 }}>
        <T numberOfLines={2}>{summary} {open ? '▴' : '▾'}</T>
      </Pressable>
      {open && (
        <View style={{ gap: 10, paddingVertical: 4 }}>
          <Button small title={t('All books')} onPress={() => onChange([])} disabled={value.length === 0} style={pickerStyles.back} />
          {TESTAMENTS.map(({ testament, label }) => (
            <View key={testament} style={{ gap: 6 }}>
              <T small muted>{label()}</T>
              <View style={pickerStyles.wrap}>
                {BOOKS.filter(b => b.testament === testament).map(b => (
                  <Choice key={b.n} label={b.abbr} name={b.name} selected={chosen.has(b.n)} fillDelay={0} onPress={() => toggle(b.n)} style={pickerStyles.chip} fontSize={14} bg={ink.card} />
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
