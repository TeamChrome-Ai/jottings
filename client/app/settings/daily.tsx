import { useCallback, useState } from 'react'
import { Platform, Text, View } from 'react-native'
import { Redirect, useFocusEffect } from 'expo-router'
import * as Linking from 'expo-linking'
import { mix } from '../../src/theme'
import { easeNextLayout } from '../../src/components/motion/nav'
import { useAuth } from '../../src/store/auth'
import { usePref, usePrefs, usePrefsStore } from '../../src/store/prefs'
import { REMINDER_PRESETS, formatTime, parseTime } from '../../src/lib/reminderPlan'
import { DAILY_GOALS, readDailyGoal } from '../../src/lib/dailyGoal'
import { askNotifyPermission, notifyPermission, type NotifyPermission } from '../../src/lib/streakReminder'
import { ANY_BOOK, ANY_BOOK_LABEL, DEFAULT_ITEM, PATH_BOOK, PATH_LABEL, VERSE_NOTIFY_MAX_ITEMS, VERSE_NOTIFY_PRESETS, bookLabel, verseItemDetail, type VerseNotifyItem } from '../../src/lib/verseNotifyPlan'
import { usePath } from '../../src/lib/paths'
import { useColors, useInkFill, useInks } from '../../src/hooks/useTheme'
import { Button, Card, ErrorText, H2, Input, SPACE, Screen, Segmented, SwitchRow, T, Tap, TYPE } from '../../src/components/ui'
import { BOOKS } from '@shared/books'
import { Choice, Grid, pickerStyles } from '../../src/components/ChapterPicker'
import { BRAND } from '@shared/brand'
import { t, tc } from '@shared/i18n'

/** Settings → Daily: the reader's own goal, the evening reminder and the morning verses, each where it can be. */
export default function DailySettings() {
  const { user, ready } = useAuth()
  const { prefs, set } = usePrefs()
  // local notifications exist only in the native apps; the goal shapes the streak, which needs an account
  const native = Platform.OS !== 'web'
  if (!native && !user) return ready ? <Redirect href="/settings" /> : null
  return (
    <Screen>
      {user ? <>
        {/* the reader's own bar, kept on this device: a day counts for the streak at the server's ten minutes whatever is chosen */}
        <H2 hint={t('Minutes a day. The streak still counts at ten.')}>{t('Daily goal')}</H2>
        <Card>
          <Segmented value={String(prefs.dailyGoal)} onChange={v => set({ dailyGoal: readDailyGoal(Number(v)) })} options={DAILY_GOALS.map(g => ({ value: String(g), label: String(g) }))} />
        </Card>
      </> : null}
      {native && user ? <>
        <H2>{t('Streak reminder')}</H2>
        <Card><StreakReminder /></Card>
      </> : null}
      {/* the morning verse is a local notification: no account needed; its editor is a card of its own, so the list sits on the page */}
      {native ? <>
        <H2>{t('Verse of the day')}</H2>
        <VerseNotify />
      </> : null}
    </Screen>
  )
}

const OTHER = 'other'

/** On, time, and the system permission it depends on. Four evening presets; Other takes any 24-hour time. */
function StreakReminder() {
  const pref = usePref('streakReminder')
  const store = usePrefsStore()
  const { set } = store
  const current = formatTime(pref.hour, pref.minute)
  const isPreset = (t: string) => (REMINDER_PRESETS as readonly string[]).includes(t)
  const [other, setOther] = useState(!isPreset(current))
  const [text, setText] = useState(current)
  const [bad, setBad] = useState(false)
  const [perm, setPerm] = useState<NotifyPermission | null>(null)
  // read again on every visit: the answer can change in the system settings while the app is away
  useFocusEffect(useCallback(() => { notifyPermission().then(setPerm).catch(() => {}) }, []))

  // the card grows and shrinks with the time choices: ease it on native (a no-op on the web and under Reduce animation)
  const ease = () => easeNextLayout(store.get().reduceMotion)
  const toggle = (enabled: boolean) => {
    ease()
    set({ streakReminder: { ...pref, enabled } })
    if (enabled) askNotifyPermission().then(setPerm).catch(() => {})
  }
  const choose = (v: string) => {
    if (v === OTHER) { ease(); setOther(true); setText(current); setBad(false); return }
    const t = parseTime(v)
    if (t) { if (other) ease(); setOther(false); set({ streakReminder: { ...pref, ...t } }) }
  }
  const commitText = () => {
    const t = parseTime(text)
    setBad(!t)
    if (!t) return
    const f = formatTime(t.hour, t.minute)
    setText(f)
    if (isPreset(f)) setOther(false)
    set({ streakReminder: { ...pref, ...t } })
  }
  return (
    <>
      <View>
        <SwitchRow label={t('Remind me to read')} hint={t('Only on days the goal is not met yet')} value={pref.enabled} onChange={toggle} />
        {pref.enabled ? <>
          <T small muted>{tc('time of day', 'Time')}</T>
          <Segmented value={other ? OTHER : current} onChange={choose} options={[...REMINDER_PRESETS.map(t => ({ value: t, label: t })), { value: OTHER, label: t('Other…') }]} />
          {other ? <>
            <Input value={text} onChangeText={t => { setText(t); setBad(false) }} onEndEditing={commitText} onSubmitEditing={commitText} placeholder={t('HH:MM')} keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel={t('Reminder time, 24-hour')} />
            {bad ? <ErrorText>{t('Not a time of day; the reminder stays at {time}', { time: current })}</ErrorText> : <T small muted>{t('24-hour time, such as 18:30')}</T>}
          </> : null}
          {perm === 'denied' ? <>
            <T small muted>{t('Notifications are off for {name} in the system settings, so the reminder cannot show.', { name: BRAND.name })}</T>
            <Button small title={t('Open system settings')} onPress={() => { Linking.openSettings().catch(() => {}) }} style={{ alignSelf: 'flex-start' }} />
          </> : perm === 'undetermined' ? (
            <Button small title={t('Allow notifications')} onPress={() => { askNotifyPermission().then(setPerm).catch(() => {}) }} style={{ alignSelf: 'flex-start' }} />
          ) : null}
        </> : null}
      </View>
    </>
  )
}

/**
 * Morning verses: the reader's items as rows (a book, or any book, at a time), "Add a verse" up to four, the tapped or
 * added item edited in place (book chips as the reader's picker, the time as presets + Other), and the system
 * permission it shares with the reminder.
 */
function VerseNotify() {
  const pref = usePref('verseNotify')
  const store = usePrefsStore()
  const { set } = store
  const items = pref.items
  const [editing, setEditing] = useState<number | null>(null)
  const [perm, setPerm] = useState<NotifyPermission | null>(null)
  useFocusEffect(useCallback(() => { notifyPermission().then(setPerm).catch(() => {}) }, []))

  const ease = () => easeNextLayout(store.get().reduceMotion)
  const save = (next: VerseNotifyItem[]) => set({ verseNotify: { items: next } })
  // a new item: Any book, at the last item's time (the first at 6:00)
  const add = () => {
    if (items.length >= VERSE_NOTIFY_MAX_ITEMS) return
    ease()
    const last = items[items.length - 1]
    const next = [...items, last ? { ...DEFAULT_ITEM, hour: last.hour, minute: last.minute } : DEFAULT_ITEM]
    save(next)
    setEditing(next.length - 1)
    askNotifyPermission().then(setPerm).catch(() => {})
  }
  const remove = (i: number) => {
    ease()
    save(items.filter((_, j) => j !== i))
    setEditing(e => (e === null || e === i ? null : e > i ? e - 1 : e))
  }
  const update = (i: number, patch: Partial<VerseNotifyItem>) => save(items.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  const item = editing !== null ? items[editing] : undefined
  // a "Your path" item says so on its row while no path is on: it schedules nothing until one starts
  const pathOn = !!usePath().state
  return (
    <View style={{ gap: 10 }}>
      {items.map((it, i) => <VerseItemRow key={i} item={it} pathOn={pathOn} selected={i === editing} onPress={() => { ease(); setEditing(i === editing ? null : i) }} onRemove={() => remove(i)} />)}
      {items.length < VERSE_NOTIFY_MAX_ITEMS
        ? <Button soft title={t('Add a verse')} lead="add" onPress={add} style={{ alignSelf: 'flex-start' }} />
        : <T small muted>{t('Up to four')}</T>}
      {item && editing !== null ? <Card><VerseItemEditor key={editing} item={item} onChange={patch => update(editing, patch)} /></Card> : null}
      {items.length ? (perm === 'denied' ? <>
        <T small muted>{t('Notifications are off for {name} in the system settings, so the verse cannot show.', { name: BRAND.name })}</T>
        <Button small title={t('Open system settings')} onPress={() => { Linking.openSettings().catch(() => {}) }} style={{ alignSelf: 'flex-start' }} />
      </> : perm === 'undetermined' ? (
        <Button small title={t('Allow notifications')} onPress={() => { askNotifyPermission().then(setPerm).catch(() => {}) }} style={{ alignSelf: 'flex-start' }} />
      ) : null) : null}
    </View>
  )
}

/** One item: the book (or Any book) and its time; tapped to edit, the x removes it (as an added font's row). */
function VerseItemRow({ item, pathOn, selected, onPress, onRemove }: { item: VerseNotifyItem; pathOn: boolean; selected: boolean; onPress: () => void; onRemove: () => void }) {
  const c = useInks()
  const label = bookLabel(item.book, 'full', pathOn)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACE.m, minHeight: 52 }}>
      <Tap onPress={onPress} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={`${label}, ${verseItemDetail(item)}`} accessibilityState={{ selected }} style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: selected ? c.accent : c.text, fontSize: TYPE.body, fontWeight: '500' }}>{label}</Text>
        <Text style={{ color: c.muted, fontSize: TYPE.small }}>{verseItemDetail(item)}</Text>
      </Tap>
      <Button small iconName="x" title={t('Remove {name}', { name: label })} onPress={onRemove} />
    </View>
  )
}

/** The tapped item in place: Any book and Your path first, then the 66 books by testament as the reader's picker shows them; the time below. */
function VerseItemEditor({ item, onChange }: { item: VerseNotifyItem; onChange: (patch: Partial<VerseNotifyItem>) => void }) {
  const c = useColors()
  const fill = useInkFill()
  const store = usePrefsStore()
  const current = formatTime(item.hour, item.minute)
  const isPreset = (t: string) => (VERSE_NOTIFY_PRESETS as readonly string[]).includes(t)
  const [other, setOther] = useState(!isPreset(current))
  const [text, setText] = useState(current)
  const [bad, setBad] = useState(false)
  const ease = () => easeNextLayout(store.get().reduceMotion)
  const choose = (v: string) => {
    if (v === OTHER) { ease(); setOther(true); setText(current); setBad(false); return }
    const t = parseTime(v)
    if (t) { if (other) ease(); setOther(false); onChange(t) }
  }
  const commitText = () => {
    const t = parseTime(text)
    setBad(!t)
    if (!t) return
    const f = formatTime(t.hour, t.minute)
    setText(f)
    if (isPreset(f)) setOther(false)
    onChange(t)
  }
  // the New Testament's chips carry the picker's faint wash of the accent
  const ntFill = mix(fill, c.accent, 0.08), ntBorder = mix(c.border, c.accent, 0.24)
  const chip = (n: number, label: string, name: string, bg: string, border?: string, wait = 0) =>
    <Choice key={n} label={label} name={name} selected={n === item.book} fillDelay={wait} onPress={() => onChange({ book: n })} style={pickerStyles.chip} fontSize={14} bg={bg} border={border} />
  return (
    <View style={{ gap: SPACE.l }}>
      <Grid>{wait => <>
        <View style={pickerStyles.wrap}>{chip(ANY_BOOK, t(ANY_BOOK_LABEL), t('Any book: the verse of the day'), fill, undefined, wait)}{chip(PATH_BOOK, t(PATH_LABEL), t('Your path: the next chapter on it'), fill, undefined, wait)}</View>
        {([['OT', t('Old Testament')], ['NT', t('New Testament')]] as const).map(([testament, label]) => (
          <View key={testament} style={{ gap: SPACE.s }}>
            <Text style={[pickerStyles.group, { color: c.muted }]}>{label}</Text>
            <View style={pickerStyles.wrap}>
              {BOOKS.filter(bk => bk.testament === testament).map(bk => chip(bk.n, bk.abbr, bk.name, testament === 'NT' ? ntFill : fill, testament === 'NT' ? ntBorder : undefined, wait))}
            </View>
          </View>
        ))}
      </>}</Grid>
      <View style={{ gap: 10 }}>
        <T small muted>{tc('time of day', 'Time')}</T>
        <Segmented value={other ? OTHER : current} onChange={choose} options={[...VERSE_NOTIFY_PRESETS.map(t => ({ value: t, label: t })), { value: OTHER, label: t('Other…') }]} />
        {other ? <>
          <Input value={text} onChangeText={t => { setText(t); setBad(false) }} onEndEditing={commitText} onSubmitEditing={commitText} placeholder={t('HH:MM')} keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel={t('Verse time, 24-hour')} />
          {bad ? <ErrorText>{t('Not a time of day; the verse stays at {time}', { time: current })}</ErrorText> : <T small muted>{t('24-hour time, such as 06:30')}</T>}
        </> : null}
      </View>
    </View>
  )
}
