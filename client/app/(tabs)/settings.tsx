import { VOICES } from '../../src/lib/tts'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Animated, Easing, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { TEXT_FIT, THEMES, face, mix } from '../../src/theme'
import { lineFactor, lineTight } from '../../src/lib/lineHeight'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, get, getApiBase, patch } from '../../src/lib/api'
import * as Linking from 'expo-linking'
import Constants from 'expo-constants'
import { useLazyFontState } from '../../src/lib/fonts'
import FontLoading from '../../src/components/FontLoading'
import AddFontSheet from '../../src/components/AddFontSheet'
import FeedbackSheet from '../../src/components/FeedbackSheet'
import ListeningSheet from '../../src/components/ListeningSheet'
import FriendsSettingsSheet from '../../src/components/friends/FriendsSettingsSheet'
import AvatarSheet from '../../src/components/AvatarSheet'
import AvatarArt from '../../src/components/AvatarArt'
import { easeNextLayout } from '../../src/components/motion/nav'
import { SPEED_MAX, SPEED_MIN, SPEED_STEP } from '../../src/lib/motionSpeed'
import { customKey, type CustomFont } from '../../src/lib/customFonts'
import { useAuth } from '../../src/store/auth'
import { adminMode, errMsg, useLoad } from '../../src/lib/community'
import { AdminBadge } from '../../src/components/CommunityBits'
import { adminSummary, listBlocks, unblockUser } from '../../src/lib/moderation'
import { FONT_MAX, FONT_MIN, usePref, usePrefs, usePrefsStore, type Align, type Font, type Width } from '../../src/store/prefs'
import type { NoteLetters } from '../../src/lib/noteLetters'
import { REMINDER_PRESETS, formatTime, parseTime } from '../../src/lib/reminderPlan'
import { askNotifyPermission, notifyPermission, type NotifyPermission } from '../../src/lib/streakReminder'
import { ANY_BOOK, ANY_BOOK_LABEL, DEFAULT_ITEM, PATH_BOOK, PATH_LABEL, VERSE_NOTIFY_MAX_ITEMS, VERSE_NOTIFY_PRESETS, bookLabel, verseItemDetail, verseNotifyDetail, type VerseNotifyItem } from '../../src/lib/verseNotifyPlan'
import { usePath } from '../../src/lib/paths'
import { useToast } from '../../src/store/toast'
import { useInvitesWaiting } from '../../src/hooks/useInviteNotice'
import { playWelcome } from '../../src/store/welcome'
import { startTour, tourRef } from '../../src/store/tour'
import { removeCustomFont } from '../../src/lib/addFont'
import { useThemeDef, useColors, useInkFill, useInks } from '../../src/hooks/useTheme'
import Slider from '../../src/components/Slider'
import { Button, Card, ErrorText, H, H2, Input, ListRow, Row, SPACE, Screen, Segmented, Sheet, Spinner, SwitchRow, T, Tap, TYPE } from '../../src/components/ui'
import Disclosure from '../../src/components/Disclosure'
import Icon from '../../src/components/Icon'
import { BOOKS } from '@shared/books'
import { Choice, Grid, pickerStyles } from '../../src/components/ChapterPicker'
import SignInCard from '../../src/components/SignInCard'
import OfflineSection from '../../src/components/OfflineSection'
import { useEdition } from '../../src/lib/edition'
import { hasChronology } from '../../src/lib/editionCore'
import { BRAND, NOUN } from '@shared/brand'

const LINE_MIN = 1.2, LINE_MAX = 2.4
const PREVIEW_PAD = 16
/** Two lines at the largest size and loosest leading; smaller settings show more lines in the same box. */
const PREVIEW_H = Math.ceil(2 * FONT_MAX * LINE_MAX) + 2 * PREVIEW_PAD

const BUILT_IN_FONTS: { value: Font; label: string }[] = [{ value: 'serif', label: 'Serif' }, { value: 'sans', label: 'Sans' }, { value: 'dyslexic', label: 'Dyslexic' }]

export default function Settings() {
  const edition = useEdition()
  const { width: windowW, fontScale } = useWindowDimensions()
  const wideScreen = windowW >= 600   // position and width only bite on tablets and the web
  const router = useRouter()
  const { user, logout } = useAuth()
  const { prefs, set, reset } = usePrefs()
  const store = usePrefsStore()
  const fontState = useLazyFontState(prefs.font)
  const toast = useToast()
  const c = useInks()
  const theme = useThemeDef()
  const [sheet, setSheet] = useState<'font' | 'feedback' | 'listening' | 'again' | 'reminder' | 'verse' | 'blocked' | 'admin' | 'friends' | 'avatar' | null>(null)
  const close = useCallback(() => setSheet(null), [])

  const siteBase = () => getApiBase() || (Platform.OS === 'web' && typeof location !== 'undefined' ? location.origin : '')
  const deleteAccount = async () => {
    const go = async () => {
      try { await api('/me', { method: 'DELETE', json: { confirm: 'delete' } }); await logout(); toast.show('Account deleted') }
      catch (e) { toast.show(e instanceof Error ? e.message : 'Could not delete the account') }
    }
    const msg = `This removes your account, reading activity, ${NOUN.many}, group memberships and any groups you own. There is no undo.`
    if (Platform.OS === 'web') { const ask = (globalThis as { confirm?: (m: string) => boolean }).confirm; if (ask && ask(msg)) await go(); return }
    Alert.alert('Delete account?', msg, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { go() } }])
  }
  const dys = prefs.font === 'dyslexic'
  const fs = prefs.fontSize
  // up to two added fonts join the built-in choices; more than that get a list of their own under them
  const listFonts = prefs.customFonts.length > 2
  const fontOptions: { value: Font; label: string }[] = [...BUILT_IN_FONTS, ...(listFonts ? [] : prefs.customFonts.map(f => ({ value: customKey(f.id), label: f.name })))]
  // the system's text size scales the preview's lines too: count whole lines at the size they are drawn
  const previewLine = fs * lineFactor(prefs.font, prefs.lineHeight)
  // the slider keeps its range (the sans goes to 1.2 whole); a font with deeper descenders is laid out at its floor and says so
  const lineHeld = lineTight(prefs.font, prefs.lineHeight)
  const voice = VOICES.find(v => v.id === prefs.ttsVoice)?.name ?? prefs.ttsVoice
  const pause = { none: 'no pause', short: 'short pauses', long: 'long pauses' }[prefs.ttsPause]
  const spacing = prefs.letterSpacing || prefs.wordSpacing ? `${prefs.letterSpacing.toFixed(2)} em letters, ${prefs.wordSpacing.toFixed(2)} em words` : 'As set by the font'
  return (
    <Screen safeTop>
      <H>Settings</H>

      <H2>Text</H2>
      <Card ref={tourRef('settings-text')} style={{ gap: 14 }}>
        {/* one height for every setting, so the sliders below never move under the finger */}
        <View accessibilityLabel="Preview of the reading text" accessibilityState={{ busy: fontState === 'loading' }} style={{ backgroundColor: c.bg, borderRadius: 14, padding: PREVIEW_PAD, height: PREVIEW_H, overflow: 'hidden' }}>
          <Text numberOfLines={Math.max(1, Math.floor((PREVIEW_H - 2 * PREVIEW_PAD) / (previewLine * fontScale)))}
            style={{ color: c.text, fontSize: fs, lineHeight: previewLine, letterSpacing: fs * prefs.letterSpacing, ...face(prefs.font), ...TEXT_FIT }}>
            <Text style={{ color: c.accent, fontSize: fs * 0.6, ...face('sans', { bold: true }) }}>1 </Text>
            In the beginning was the Word, and the Word was with God, and the Word was God.{' '}
            <Text style={{ color: c.accent, fontSize: fs * 0.6, ...face('sans', { bold: true }) }}>2 </Text>
            He was in the beginning with God.{' '}
            <Text style={{ color: c.accent, fontSize: fs * 0.6, ...face('sans', { bold: true }) }}>3 </Text>
            All things received being through him, and without him not one thing received being which has received being.
          </Text>
          <FontLoading state={fontState} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Segmented<Font> value={prefs.font} onChange={font => set({ font })} options={fontOptions} />
          </View>
          <Button small iconName="add" title={prefs.customFonts.length ? 'Fonts' : 'Add a font'} accessibilityLabel={prefs.customFonts.length ? 'Your fonts: add or remove' : 'Add a font'} onPress={() => setSheet('font')} style={{ marginTop: 4 }} />
        </View>
        {listFonts ? <CustomFontList value={prefs.font} fonts={prefs.customFonts} onChange={font => set({ font })} onRemove={f => { removeCustomFont(store, f); toast.show(`${f.name} removed`) }} /> : null}
        {prefs.customFonts.length && !listFonts ? <T small muted>Added fonts can be removed under Fonts.</T> : null}
        <Slider label="Text size" value={prefs.fontSize} min={FONT_MIN} max={FONT_MAX} step={1} onChange={v => set({ fontSize: v })} format={v => `${v} px`} />
        <Slider label="Line height" value={prefs.lineHeight} min={LINE_MIN} max={LINE_MAX} step={0.05} onChange={v => set({ lineHeight: v })} format={v => v.toFixed(2)} />
        {lineHeld ? <T small muted style={{ marginTop: -8 }}>Tighter than the font allows: shown at {lineFactor(prefs.font, prefs.lineHeight).toFixed(2)}, the least that keeps its letters whole.</T> : null}
        <Disclosure label="Letter and word spacing" detail={spacing}>
          <Slider label="Letter spacing" value={prefs.letterSpacing} min={0} max={0.15} step={0.01} onChange={v => set({ letterSpacing: v })} format={v => `${v.toFixed(2)} em`} />
          <Slider label="Word spacing" value={prefs.wordSpacing} min={0} max={0.5} step={0.02} onChange={v => set({ wordSpacing: v })} format={v => `${v.toFixed(2)} em`} />
        </Disclosure>
      </Card>

      <H2>Theme</H2>
      <Card onPress={() => router.push('/themes')} accessibilityLabel={`Themes, current ${theme.name}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: theme.accent, fontSize: 28, lineHeight: 32, ...face('serif', { bold: true }) }}>1</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T bold>{theme.name}</T>
          <T small muted>{prefs.theme === 'system' ? 'Follows the system. ' : ''}{THEMES.length} themes in light, dark and true black</T>
        </View>
        <Icon name="chevron" color={c.muted} size={20} />
      </Card>

      <H2>Reading</H2>
      <Card ref={tourRef('settings-reading')} style={{ gap: 0, paddingVertical: 8 }}>
        <SwitchRow label="Paragraphs" hint={prefs.paragraphs ? 'On: verses run together in paragraphs' : 'Off: every verse starts on its own line'} value={prefs.paragraphs} onChange={paragraphs => set({ paragraphs })} />
        <SwitchRow label="Verse numbers" value={prefs.verseNumbers} onChange={verseNumbers => set({ verseNumbers })} />
        <SwitchRow label="Footnote markers" value={prefs.showNotes} onChange={showNotes => set({ showNotes })} />
        {prefs.showNotes ? (
          <View style={{ gap: 6, paddingVertical: 10 }}>
            <T>Footnote letters</T>
            <T small muted>{prefs.noteLetters === 'chapter' ? 'a, b, c … once through each chapter' : 'As the 1961 edition prints them: they start again on each of its pages, so a chapter can have two a’s'}</T>
            <Segmented<NoteLetters> value={prefs.noteLetters} onChange={noteLetters => set({ noteLetters })} options={[{ value: 'chapter', label: 'Through the chapter' }, { value: 'printed', label: 'As printed' }]} />
          </View>
        ) : null}
        {wideScreen ? (
          <View style={{ gap: 6, paddingVertical: 10 }}>
            <T>Page</T>
            <T small muted>Where the page sits on a wide screen, and how wide it may grow.</T>
            <Segmented<Align> value={prefs.align} onChange={align => set({ align })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} />
            <Segmented<Width> value={prefs.width} onChange={width => set({ width })} options={[{ value: 'narrow', label: 'Narrow' }, { value: 'medium', label: 'Medium' }, { value: 'wide', label: 'Wide' }, { value: 'full', label: 'Full' }]} />
          </View>
        ) : null}
        <SwitchRow label="Reduce animation" hint="Switch chapters and screens instantly" value={prefs.reduceMotion} onChange={reduceMotion => set({ reduceMotion })} />
        <Dimmed off={prefs.reduceMotion}>
          <Slider label="Animation speed" value={prefs.motionSpeed} min={SPEED_MIN} max={SPEED_MAX} step={SPEED_STEP} onChange={motionSpeed => set({ motionSpeed })} format={v => `${v.toFixed(1)}×`} />
          <T small muted>{prefs.reduceMotion ? 'Off while Reduce animation is on' : 'For every motion in the app'}</T>
        </Dimmed>
        {/* the morning verse is a local notification: native only, no account needed */}
        {Platform.OS !== 'web' ? <ListRow icon="book" label="Verse of the day" detail={verseNotifyDetail(prefs.verseNotify)} onPress={() => setSheet('verse')} /> : null}
      </Card>

      <H2>Listening</H2>
      <Card style={{ gap: 0, paddingVertical: 8 }}>
        <ListRow ref={tourRef('settings-listening')} icon="voice" label="Voice, speed and pauses" detail={`${voice} at ${prefs.ttsSpeed}×, ${pause}${prefs.ttsDevice ? ', device voice' : ''}`} onPress={() => setSheet('listening')} />
      </Card>

      {/* native only: the web keeps its HTTP cache and renders nothing here */}
      <OfflineSection />

      <H2>About</H2>
      <Card style={{ gap: 0, paddingVertical: 8 }}>
        <ListRow icon="info" label="About the translation" detail={hasChronology(edition) ? 'Darby’s introductory notices and note on dates' : 'Darby’s introductory notices'} onPress={() => router.push('/about')} />
        <ListRow icon="list" label="Credits and licences" detail="Sources, fonts, icons and open-source software" onPress={() => router.push('/credits')} />
        <ListRow icon="heart" label="Acknowledgments" detail={`The people behind ${BRAND.name}`} onPress={() => router.push('/acknowledgments')} />
        <ListRow icon="feedback" label="Send feedback" detail="A fault, a wish or a kind word" onPress={() => setSheet('feedback')} />
        <ListRow ref={tourRef('settings-welcome')} icon="play" label="Welcome and tour" detail="Play them again, to show someone" onPress={() => setSheet('again')} />
      </Card>

      <H2>Account</H2>
      {user ? (
        <Card ref={tourRef('settings-account')} style={{ gap: 0, paddingVertical: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingVertical: 6 }}>
            <Tap onPress={() => setSheet('avatar')} scaleTo={0.9} accessibilityRole="button" accessibilityLabel="Choose your picture">
              <AvatarArt id={user.avatar} userId={user.id} size={48} />
            </Tap>
            {/* the badge sits on the handle's line: beside a long name it ran under Sign out */}
            <View style={{ flex: 1, minWidth: 0 }}><T bold numberOfLines={1}>{user.display_name}</T><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><T small muted numberOfLines={1} style={{ flexShrink: 1 }}>@{user.handle}</T>{adminMode(user) ? <AdminBadge /> : null}</View></View>
            <Button small title="Sign out" onPress={() => logout()} />
          </View>
          <FriendsRow onPress={() => setSheet('friends')} />
          <PublicProfileRow />
          {/* local notifications exist only in the native apps */}
          {Platform.OS !== 'web' ? <ListRow icon="clock" label="Streak reminder" detail={prefs.streakReminder.enabled ? `Evenings at ${formatTime(prefs.streakReminder.hour, prefs.streakReminder.minute)}, if today’s reading is still to do` : 'Off'} onPress={() => setSheet('reminder')} /> : null}
          <ListRow icon="block" label="Blocked users" detail="Hidden from you, and no longer friends" onPress={() => setSheet('blocked')} />
          <ListRow icon="share" label="Your data" detail="Back up, restore or import; see or delete what is stored" onPress={() => router.push('/your-data')} />
          {user.is_admin ? <ListRow icon="award" label="Admin" detail={adminMode(user) ? 'Admin mode on: your badge, every group, moderation' : 'Admin mode, moderation queue and feedback'} onPress={() => setSheet('admin')} /> : null}
          <ListRow icon="x" label="Delete account" danger onPress={deleteAccount} />
        </Card>
      ) : (
        <SignInCard ref={tourRef('settings-account')} title="Not signed in" text="Sign in to sync bookmarks, keep a streak and join groups." />
      )}

      <H2 hint="Text, theme, reading and listening go back to how they came; added fonts, the reminder and your name stay">Reset</H2>
      <Card ref={tourRef('settings-reset')}>
        <Button title="Reset all settings" onPress={() => { reset(); toast.show('Settings reset') }} style={{ alignSelf: 'flex-start' }} small />
      </Card>

      <View style={{ alignItems: 'center', gap: 10, marginTop: 8 }}>
        <T small muted>{BRAND.fullName} {Constants.expoConfig?.version ?? ''}{Constants.expoConfig?.android?.versionCode ? ` (${Constants.expoConfig.android.versionCode})` : ''}</T>
        <Row style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button small title="Privacy policy" onPress={() => Linking.openURL(`${siteBase()}/privacy`)} />
          <Button small title="Terms" onPress={() => Linking.openURL(`${siteBase()}/terms`)} />
          <Button small title="Copyright" onPress={() => Linking.openURL(`${siteBase()}/copyright`)} />
        </Row>
      </View>
      <AddFontSheet open={sheet === 'font'} onClose={close} />
      <FeedbackSheet open={sheet === 'feedback'} onClose={close} />
      <ListeningSheet open={sheet === 'listening'} onClose={close} />
      <AgainSheet open={sheet === 'again'} onClose={close} />
      {Platform.OS !== 'web' ? <Sheet open={sheet === 'verse'} onClose={close} title="Verse of the day"><ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}><VerseNotify /></ScrollView></Sheet> : null}
      {user ? <>
        {Platform.OS !== 'web' ? <Sheet open={sheet === 'reminder'} onClose={close} title="Streak reminder"><ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}><StreakReminder /></ScrollView></Sheet> : null}
        <FriendsSettingsSheet open={sheet === 'friends'} onClose={close} />
        <AvatarSheet open={sheet === 'avatar'} onClose={close} />
        <Sheet open={sheet === 'blocked'} onClose={close} title="Blocked users"><ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}><BlockedUsers /></ScrollView></Sheet>
        {user.is_admin ? <Sheet open={sheet === 'admin'} onClose={close} title="Admin"><View style={{ padding: 16, gap: 10 }}><AdminLinks onGo={close} /></View></Sheet> : null}
      </> : null}
    </Screen>
  )
}

/** A block that fades to a hint of itself and takes no touches while `off`. */
function Dimmed({ off, children }: { off: boolean; children: ReactNode }) {
  const reduce = usePref('reduceMotion')
  const v = useRef(new Animated.Value(off ? 0.4 : 1)).current
  useEffect(() => {
    const a = Animated.timing(v, { toValue: off ? 0.4 : 1, duration: reduce ? 0 : 200, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [off, reduce, v])
  return <Animated.View pointerEvents={off ? 'none' : 'auto'} style={{ opacity: v, paddingBottom: 8 }}>{children}</Animated.View>
}

/** Settings → Welcome and tour: the welcome or the full tour, each after the sheet has gone. The short tour runs on a new
 * device from the welcome; the full one starts with its six steps. */
function AgainSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const after = (go: () => void) => { onClose(); setTimeout(go, 280) }
  return (
    <Sheet open={open} onClose={onClose} title="Welcome and tour">
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <ListRow icon="play" label="Welcome" detail="The opening page and first steps" onPress={() => after(playWelcome)} />
        <ListRow icon="info" label="Full tour" detail="Every screen and sheet, one step at a time" onPress={() => after(() => startTour(null, true))} />
      </View>
    </Sheet>
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

  // the sheet grows and shrinks with the time choices: ease it on native (a no-op on the web and under Reduce animation)
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
        <SwitchRow label="Remind me to read" hint="Only on days the goal is not met yet" value={pref.enabled} onChange={toggle} />
        {pref.enabled ? <>
          <T small muted>Time</T>
          <Segmented value={other ? OTHER : current} onChange={choose} options={[...REMINDER_PRESETS.map(t => ({ value: t, label: t })), { value: OTHER, label: 'Other…' }]} />
          {other ? <>
            <Input value={text} onChangeText={t => { setText(t); setBad(false) }} onEndEditing={commitText} onSubmitEditing={commitText} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel="Reminder time, 24-hour" />
            {bad ? <ErrorText>Not a time of day; the reminder stays at {current}</ErrorText> : <T small muted>24-hour time, such as 18:30</T>}
          </> : null}
          {perm === 'denied' ? <>
            <T small muted>Notifications are off for {BRAND.name} in the system settings, so the reminder cannot show.</T>
            <Button small title="Open system settings" onPress={() => { Linking.openSettings().catch(() => {}) }} style={{ alignSelf: 'flex-start' }} />
          </> : perm === 'undetermined' ? (
            <Button small title="Allow notifications" onPress={() => { askNotifyPermission().then(setPerm).catch(() => {}) }} style={{ alignSelf: 'flex-start' }} />
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
        ? <Button soft title="Add a verse" lead="add" onPress={add} style={{ alignSelf: 'flex-start' }} />
        : <T small muted>Up to four</T>}
      {item && editing !== null ? <Card><VerseItemEditor key={editing} item={item} onChange={patch => update(editing, patch)} /></Card> : null}
      {items.length ? (perm === 'denied' ? <>
        <T small muted>Notifications are off for {BRAND.name} in the system settings, so the verse cannot show.</T>
        <Button small title="Open system settings" onPress={() => { Linking.openSettings().catch(() => {}) }} style={{ alignSelf: 'flex-start' }} />
      </> : perm === 'undetermined' ? (
        <Button small title="Allow notifications" onPress={() => { askNotifyPermission().then(setPerm).catch(() => {}) }} style={{ alignSelf: 'flex-start' }} />
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
      <Button small iconName="x" title={`Remove ${label}`} onPress={onRemove} />
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
        <View style={pickerStyles.wrap}>{chip(ANY_BOOK, ANY_BOOK_LABEL, 'Any book: the verse of the day', fill, undefined, wait)}{chip(PATH_BOOK, PATH_LABEL, 'Your path: the next chapter on it', fill, undefined, wait)}</View>
        {([['OT', 'Old Testament'], ['NT', 'New Testament']] as const).map(([testament, label]) => (
          <View key={testament} style={{ gap: SPACE.s }}>
            <Text style={[pickerStyles.group, { color: c.muted }]}>{label}</Text>
            <View style={pickerStyles.wrap}>
              {BOOKS.filter(bk => bk.testament === testament).map(bk => chip(bk.n, bk.abbr, bk.name, testament === 'NT' ? ntFill : fill, testament === 'NT' ? ntBorder : undefined, wait))}
            </View>
          </View>
        ))}
      </>}</Grid>
      <View style={{ gap: 10 }}>
        <T small muted>Time</T>
        <Segmented value={other ? OTHER : current} onChange={choose} options={[...VERSE_NOTIFY_PRESETS.map(t => ({ value: t, label: t })), { value: OTHER, label: 'Other…' }]} />
        {other ? <>
          <Input value={text} onChangeText={t => { setText(t); setBad(false) }} onEndEditing={commitText} onSubmitEditing={commitText} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} accessibilityLabel="Verse time, 24-hour" />
          {bad ? <ErrorText>Not a time of day; the verse stays at {current}</ErrorText> : <T small muted>24-hour time, such as 06:30</T>}
        </> : null}
      </View>
    </View>
  )
}

/** Account → Public profile: off unless turned on (an absent `public_profile` is private); saves at once. */
function PublicProfileRow() {
  const toast = useToast()
  const [on, setOn] = useState<boolean | null>(null)
  useEffect(() => {
    let cancelled = false
    get<{ settings: { public_profile?: unknown } | null }>('/me').then(r => { if (!cancelled) setOn(r.settings?.public_profile === true) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  if (on === null) return null
  const flip = (v: boolean) => {
    setOn(v)
    patch('/me', { settings: { public_profile: v } }).catch(e => { setOn(!v); toast.show(errMsg(e)) })
  }
  return <SwitchRow label="Public profile" hint={on ? 'On: anyone can see your name, picture, badges, reading totals and streak' : 'Off: only your friends and group members see your name and picture'} value={on} onChange={flip} />
}

/** Account → Friends, with the invites waiting (live: a heartbeat or a check may bring one while Settings is open). */
function FriendsRow({ onPress }: { onPress: () => void }) {
  const n = useInvitesWaiting()
  return <ListRow icon="invite" label="Friends" detail={n ? `${n} ${n === 1 ? 'invite' : 'invites'} waiting` : 'Invites, what friends see, reactions'} onPress={onPress} />
}

/** Added fonts past the second: one compact radio row each, under the font choice. */
function CustomFontList({ value, fonts, onChange, onRemove }: { value: Font; fonts: CustomFont[]; onChange: (f: Font) => void; onRemove: (f: CustomFont) => void }) {
  const c = useInks()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Your fonts" style={{ gap: 2 }}>
      {fonts.map(f => {
        const key = customKey(f.id), on = value === key
        return (
          <Tap key={f.id} onPress={() => onChange(key)} scaleTo={0.985} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={f.name}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: on ? c.accentSoft : 'transparent' }}>
            <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: TYPE.small, fontWeight: '600' }}>{f.name}</Text>
            {on ? <Icon name="check" size={16} color={c.accent} /> : null}
            <Tap onPress={() => onRemove(f)} accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`} hitSlop={8} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="x" size={16} color={c.muted} />
            </Tap>
          </Tap>
        )
      })}
    </View>
  )
}

/** GET /blocks with Unblock per row; the list is small (people you chose to block), so no paging. */
function BlockedUsers() {
  const toast = useToast()
  const { state, mutate } = useLoad(() => listBlocks(), [])
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const unblock = async (id: number, handle: string) => {
    setBusy(id); setErr(null)
    try { await unblockUser(id); mutate(bs => bs.filter(b => b.user_id !== id)); toast.show(`Unblocked @${handle}`) } catch (e) { setErr(errMsg(e)) } finally { setBusy(null) }
  }
  return (
    <>
      <View style={{ gap: 10 }}>
        {state.kind === 'loading' && <Spinner />}
        {state.kind === 'error' && <ErrorText>{state.message}</ErrorText>}
        {state.kind === 'ready' && state.data.length === 0 && <T small muted>You have not blocked anyone. Blocking someone hides their posts and shared {NOUN.many}, ends a friendship and stops their invites.</T>}
        {state.kind === 'ready' && state.data.map(b => (
          <Row key={b.user_id} style={{ justifyContent: 'space-between' }}>
            <View><T bold>{b.display_name || b.handle}</T><T small muted>@{b.handle}</T></View>
            <Button title={busy === b.user_id ? '…' : 'Unblock'} small disabled={busy !== null} onPress={() => { void unblock(b.user_id, b.handle) }} />
          </Row>
        ))}
        {err && <ErrorText>{err}</ErrorText>}
      </View>
    </>
  )
}

/** Admin only: Admin mode, then the panel. The pending count is from GET /admin/summary; the row still opens the queue when the count cannot load. */
function AdminLinks({ onGo }: { onGo: () => void }) {
  const router = useRouter()
  const { user, update } = useAuth()
  const { state } = useLoad(() => adminSummary(), [])
  const count = state.kind === 'ready' ? ` (${state.data.pending} pending)` : ''
  const on = adminMode(user)
  const [modeErr, setModeErr] = useState<string | null>(null)
  // settings.admin_mode on the account (rs/src/auth.rs admin_mode); the badge and the open groups follow it on the server
  const flip = async (v: boolean) => {
    if (!user) return
    setModeErr(null)
    try { await patch('/me', { settings: { admin_mode: v } }); update({ ...user, settings: { ...(user.settings ?? {}), admin_mode: v } }) }
    catch (e) { setModeErr(errMsg(e)) }
  }
  return (
    <>
      <SwitchRow label="Admin mode" hint={on ? 'The Developer badge is by your name, and every group opens to you: post a notice, remove posts or members' : 'Off: you read, post and appear as an ordinary reader'} value={on} onChange={v => { void flip(v) }} />
      {modeErr && <ErrorText>{modeErr}</ErrorText>}
      {on ? <Button title="All groups" primary onPress={() => { onGo(); router.push('/admin/groups') }} /> : null}
      <Button title="Live numbers" onPress={() => { onGo(); router.push('/admin/live') }} />
      <Button title={`Moderation queue${count}`} primary={state.kind === 'ready' && state.data.pending > 0} onPress={() => { onGo(); router.push('/admin/reports') }} />
      <Button title="Feedback" onPress={() => { onGo(); router.push('/admin/feedback') }} />
      {state.kind === 'error' && <T small muted>Pending count unavailable: {state.message}</T>}
    </>
  )
}
