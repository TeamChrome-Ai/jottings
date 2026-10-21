import { VOICES } from '../../src/lib/tts'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Animated, Easing, Platform, ScrollView, Text, View, useWindowDimensions } from 'react-native'
import { TEXT_FIT, THEMES, face, mix } from '../../src/theme'
import { lineFactor, lineTight } from '../../src/lib/lineHeight'
import { useFocusEffect, useRouter } from 'expo-router'
import { api, get, getApiBase, patch } from '../../src/lib/api'
import * as Linking from 'expo-linking'
import Constants from 'expo-constants'
import { VersionLine } from '../../src/components/UpdateLine'
import { useLazyFontState } from '../../src/lib/fonts'
import FontLoading from '../../src/components/FontLoading'
import AddFontSheet from '../../src/components/AddFontSheet'
import FeedbackSheet from '../../src/components/FeedbackSheet'
import ListeningSheet from '../../src/components/ListeningSheet'
import LanguageSheet from '../../src/components/LanguageSheet'
import { LANG_NAMES, peekLang } from '@shared/i18n'
import { TEXT_NAMES, TEXT_SAMPLE } from '@shared/texts'
import { peekText } from '../../src/lib/text'
import FriendsSettingsSheet from '../../src/components/friends/FriendsSettingsSheet'
import AvatarSheet from '../../src/components/AvatarSheet'
import AvatarArt from '../../src/components/AvatarArt'
import { easeNextLayout } from '../../src/components/motion/nav'
import { SPEED_MAX, SPEED_MIN, SPEED_STEP } from '../../src/lib/motionSpeed'
import { customKey, type CustomFont } from '../../src/lib/customFonts'
import { useAuth } from '../../src/store/auth'
import { adminMode, errMsg, useLoad } from '../../src/lib/community'
import { policyPath } from '../../src/lib/credits'
import { AdminBadge } from '../../src/components/CommunityBits'
import { adminSummary, listBlocks, unblockUser } from '../../src/lib/moderation'
import { FONT_MAX, FONT_MIN, usePref, usePrefs, usePrefsStore, type Align, type Font, type Width } from '../../src/store/prefs'
import type { NoteLetters } from '../../src/lib/noteLetters'
import { REMINDER_PRESETS, formatTime, parseTime } from '../../src/lib/reminderPlan'
import { DAILY_GOALS, readDailyGoal } from '../../src/lib/dailyGoal'
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
import { N_, t, tc, tn } from '@shared/i18n'

const LINE_MIN = 1.2, LINE_MAX = 2.4
const PREVIEW_PAD = 16
/** Two lines at the largest size and loosest leading; smaller settings show more lines in the same box. */
const PREVIEW_H = Math.ceil(2 * FONT_MAX * LINE_MAX) + 2 * PREVIEW_PAD

const BUILT_IN_FONTS: { value: Font; label: string }[] = [{ value: 'serif', label: N_('Serif') }, { value: 'sans', label: N_('Sans') }, { value: 'dyslexic', label: N_('Dyslexic') }]

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
  const [sheet, setSheet] = useState<'font' | 'feedback' | 'listening' | 'language' | 'again' | 'reminder' | 'verse' | 'blocked' | 'admin' | 'friends' | 'avatar' | null>(null)
  const close = useCallback(() => setSheet(null), [])

  const siteBase = () => getApiBase() || (Platform.OS === 'web' && typeof location !== 'undefined' ? location.origin : '')
  const deleteAccount = async () => {
    const go = async () => {
      try { await api('/me', { method: 'DELETE', json: { confirm: 'delete' } }); await logout(); toast.show(t('Account deleted')) }
      catch (e) { toast.show(e instanceof Error ? e.message : t('Could not delete the account')) }
    }
    const msg = t('This removes your account, reading activity, {many}, group memberships and any groups you own. There is no undo.', { many: NOUN.many })
    if (Platform.OS === 'web') { const ask = (globalThis as { confirm?: (m: string) => boolean }).confirm; if (ask && ask(msg)) await go(); return }
    Alert.alert(t('Delete account?'), msg, [{ text: t('Cancel'), style: 'cancel' }, { text: t('Delete'), style: 'destructive', onPress: () => { go() } }])
  }
  const dys = prefs.font === 'dyslexic'
  const fs = prefs.fontSize
  // up to two added fonts join the built-in choices; more than that get a list of their own under them
  const listFonts = prefs.customFonts.length > 2
  const fontOptions: { value: Font; label: string }[] = [...BUILT_IN_FONTS.map(f => ({ ...f, label: t(f.label) })), ...(listFonts ? [] : prefs.customFonts.map(f => ({ value: customKey(f.id), label: f.name })))]
  // the system's text size scales the preview's lines too: count whole lines at the size they are drawn
  const previewLine = fs * lineFactor(prefs.font, prefs.lineHeight)
  // the slider keeps its range (the sans goes to 1.2 whole); a font with deeper descenders is laid out at its floor and says so
  const lineHeld = lineTight(prefs.font, prefs.lineHeight)
  const voice = VOICES.find(v => v.id === prefs.ttsVoice)?.name ?? prefs.ttsVoice
  const pause = { none: t('no pause'), short: t('short pauses'), long: t('long pauses') }[prefs.ttsPause]
  const spacing = prefs.letterSpacing || prefs.wordSpacing ? t('{letters} em letters, {words} em words', { letters: prefs.letterSpacing.toFixed(2), words: prefs.wordSpacing.toFixed(2) }) : t('As set by the font')
  return (
    <Screen safeTop>
      <H>{t('Settings')}</H>

      <H2>{t('Text')}</H2>
      <Card ref={tourRef('settings-text')} style={{ gap: 14 }}>
        {/* one height for every setting, so the sliders below never move under the finger */}
        <View accessibilityLabel={t('Preview of the reading text')} accessibilityState={{ busy: fontState === 'loading' }} style={{ backgroundColor: c.bg, borderRadius: 14, padding: PREVIEW_PAD, height: PREVIEW_H, overflow: 'hidden' }}>
          <Text numberOfLines={Math.max(1, Math.floor((PREVIEW_H - 2 * PREVIEW_PAD) / (previewLine * fontScale)))}
            style={{ color: c.text, fontSize: fs, lineHeight: previewLine, letterSpacing: fs * prefs.letterSpacing, ...face(prefs.font), ...TEXT_FIT }}>
            {TEXT_SAMPLE[peekText()].map((verse, i) => (
              <Text key={i}><Text style={{ color: c.accent, fontSize: fs * 0.6, ...face('sans', { bold: true }) }}>{i + 1} </Text>{verse}{i < 2 ? ' ' : ''}</Text>
            ))}
          </Text>
          <FontLoading state={fontState} />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Segmented<Font> value={prefs.font} onChange={font => set({ font })} options={fontOptions} />
          </View>
          <Button small iconName="add" title={prefs.customFonts.length ? t('Fonts') : t('Add a font')} accessibilityLabel={prefs.customFonts.length ? t('Your fonts: add or remove') : t('Add a font')} onPress={() => setSheet('font')} style={{ marginTop: 4 }} />
        </View>
        {listFonts ? <CustomFontList value={prefs.font} fonts={prefs.customFonts} onChange={font => set({ font })} onRemove={f => { removeCustomFont(store, f); toast.show(t('{name} removed', { name: f.name })) }} /> : null}
        {prefs.customFonts.length && !listFonts ? <T small muted>{t('Added fonts can be removed under Fonts.')}</T> : null}
        <Slider label={t('Text size')} value={prefs.fontSize} min={FONT_MIN} max={FONT_MAX} step={1} onChange={v => set({ fontSize: v })} format={v => `${v} px`} />
        <Slider label={t('Line height')} value={prefs.lineHeight} min={LINE_MIN} max={LINE_MAX} step={0.05} onChange={v => set({ lineHeight: v })} format={v => v.toFixed(2)} />
        {lineHeld ? <T small muted style={{ marginTop: -8 }}>{t('Tighter than the font allows: shown at {n}, the least that keeps its letters whole.', { n: lineFactor(prefs.font, prefs.lineHeight).toFixed(2) })}</T> : null}
        <Disclosure label={t('Letter and word spacing')} detail={spacing}>
          <Slider label={t('Letter spacing')} value={prefs.letterSpacing} min={0} max={0.15} step={0.01} onChange={v => set({ letterSpacing: v })} format={v => `${v.toFixed(2)} em`} />
          <Slider label={t('Word spacing')} value={prefs.wordSpacing} min={0} max={0.5} step={0.02} onChange={v => set({ wordSpacing: v })} format={v => `${v.toFixed(2)} em`} />
        </Disclosure>
      </Card>

      <H2>{t('Theme')}</H2>
      <Card onPress={() => router.push('/themes')} accessibilityLabel={t('Themes, current {name}', { name: theme.name })} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: theme.accent, fontSize: 28, lineHeight: 32, ...face('serif', { bold: true }) }}>1</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T bold>{theme.name}</T>
          <T small muted>{prefs.theme === 'system' ? t('Follows the system.') + ' ' : ''}{t('{n} themes in light, dark and true black', { n: THEMES.length })}</T>
        </View>
        <Icon name="chevron" color={c.muted} size={20} />
      </Card>

      <H2>{t('Reading')}</H2>
      <Card ref={tourRef('settings-reading')} style={{ gap: 0, paddingVertical: 8 }}>
        <ListRow icon="dictionary" label={t('Language')} detail={prefs.bible2 ? `${LANG_NAMES[peekLang()]} · ${TEXT_NAMES[peekText()]} + ${TEXT_NAMES[prefs.bible2]}` : `${LANG_NAMES[peekLang()]} · ${TEXT_NAMES[peekText()]}`} onPress={() => setSheet('language')} />
        <SwitchRow label={t('Paragraphs')} hint={prefs.paragraphs ? t('On: verses run together in paragraphs') : t('Off: every verse starts on its own line')} value={prefs.paragraphs} onChange={paragraphs => set({ paragraphs })} />
        <SwitchRow label={t('Verse numbers')} value={prefs.verseNumbers} onChange={verseNumbers => set({ verseNumbers })} />
        <SwitchRow label={t('Footnote markers')} value={prefs.showNotes} onChange={showNotes => set({ showNotes })} />
        {prefs.showNotes ? (
          <View style={{ gap: 6, paddingVertical: 10 }}>
            <T>{t('Footnote letters')}</T>
            <T small muted>{prefs.noteLetters === 'chapter' ? t('a, b, c … once through each chapter') : t('As the 1961 edition prints them: they start again on each of its pages, so a chapter can have two a’s')}</T>
            <Segmented<NoteLetters> value={prefs.noteLetters} onChange={noteLetters => set({ noteLetters })} options={[{ value: 'chapter', label: t('Through the chapter') }, { value: 'printed', label: t('As printed') }]} />
          </View>
        ) : null}
        <SwitchRow label={t('More highlight colours')} hint={t('Eight more colours when you tap a verse')} value={prefs.moreColours} onChange={moreColours => set({ moreColours })} />
        {wideScreen ? (
          <View style={{ gap: 6, paddingVertical: 10 }}>
            <T>{t('Page')}</T>
            <T small muted>{t('Where the page sits on a wide screen, and how wide it may grow.')}</T>
            <Segmented<Align> value={prefs.align} onChange={align => set({ align })} options={[{ value: 'left', label: tc('align', 'Left') }, { value: 'center', label: tc('align', 'Centre') }, { value: 'right', label: tc('align', 'Right') }]} />
            <Segmented<Width> value={prefs.width} onChange={width => set({ width })} options={[{ value: 'narrow', label: tc('width', 'Narrow') }, { value: 'medium', label: tc('width', 'Medium') }, { value: 'wide', label: tc('width', 'Wide') }, { value: 'full', label: tc('width', 'Full') }]} />
          </View>
        ) : null}
        <SwitchRow label={t('Reduce animation')} hint={t('Switch chapters and screens instantly')} value={prefs.reduceMotion} onChange={reduceMotion => set({ reduceMotion })} />
        <Dimmed off={prefs.reduceMotion}>
          <Slider label={t('Animation speed')} value={prefs.motionSpeed} min={SPEED_MIN} max={SPEED_MAX} step={SPEED_STEP} onChange={motionSpeed => set({ motionSpeed })} format={v => `${v.toFixed(1)}×`} />
          <T small muted>{prefs.reduceMotion ? t('Off while Reduce animation is on') : t('For every motion in the app')}</T>
        </Dimmed>
        {/* the morning verse is a local notification: native only, no account needed */}
        {Platform.OS !== 'web' ? <ListRow icon="book" label={t('Verse of the day')} detail={verseNotifyDetail(prefs.verseNotify)} onPress={() => setSheet('verse')} /> : null}
      </Card>

      <H2>{t('Listening')}</H2>
      <Card style={{ gap: 0, paddingVertical: 8 }}>
        <ListRow ref={tourRef('settings-listening')} icon="voice" label={t('Voice, speed and pauses')} detail={prefs.ttsDevice ? t('{voice} at {speed}×, {pause}, device voice', { voice, speed: prefs.ttsSpeed, pause }) : t('{voice} at {speed}×, {pause}', { voice, speed: prefs.ttsSpeed, pause })} onPress={() => setSheet('listening')} />
      </Card>

      {/* native only: the web keeps its HTTP cache and renders nothing here */}
      <OfflineSection />

      <H2>{t('About')}</H2>
      <Card style={{ gap: 0, paddingVertical: 8 }}>
        <ListRow icon="info" label={t('About the translation')} detail={hasChronology(edition) ? t('Darby’s introductory notices and note on dates') : t('Darby’s introductory notices')} onPress={() => router.push('/about')} />
        <ListRow icon="list" label={t('Credits and licences')} detail={t('Sources, fonts, icons and open-source software')} onPress={() => router.push('/credits')} />
        <ListRow icon="heart" label={t('Acknowledgments')} detail={t('The people behind {name}', { name: BRAND.name })} onPress={() => router.push('/acknowledgments')} />
        <ListRow icon="feedback" label={t('Send feedback')} detail={t('A fault, a wish or a kind word')} onPress={() => setSheet('feedback')} />
        <ListRow ref={tourRef('settings-welcome')} icon="play" label={t('Welcome and tour')} detail={t('Play them again, to show someone')} onPress={() => setSheet('again')} />
      </Card>

      <H2>{t('Account')}</H2>
      {user ? (
        <Card ref={tourRef('settings-account')} style={{ gap: 0, paddingVertical: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingVertical: 6 }}>
            <Tap onPress={() => setSheet('avatar')} scaleTo={0.9} accessibilityRole="button" accessibilityLabel={t('Choose your picture')}>
              <AvatarArt id={user.avatar} userId={user.id} size={48} />
            </Tap>
            {/* the badge sits on the handle's line: beside a long name it ran under Sign out */}
            <View style={{ flex: 1, minWidth: 0 }}><T bold numberOfLines={1}>{user.display_name}</T><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><T small muted numberOfLines={1} style={{ flexShrink: 1 }}>@{user.handle}</T>{adminMode(user) ? <AdminBadge /> : null}</View></View>
            <Button small title={t('Sign out')} onPress={() => logout()} />
          </View>
          <FriendsRow onPress={() => setSheet('friends')} />
          <PublicProfileRow />
          {/* the reader's own bar, kept on this device: a day counts for the streak at the server's ten minutes whatever is chosen */}
          <View style={{ gap: 6, paddingVertical: 10 }}>
            <T>{t('Daily goal')}</T>
            <T small muted>{t('Minutes a day. The streak still counts at ten.')}</T>
            <Segmented value={String(prefs.dailyGoal)} onChange={v => set({ dailyGoal: readDailyGoal(Number(v)) })} options={DAILY_GOALS.map(g => ({ value: String(g), label: String(g) }))} />
          </View>
          {/* local notifications exist only in the native apps */}
          {Platform.OS !== 'web' ? <ListRow icon="clock" label={t('Streak reminder')} detail={prefs.streakReminder.enabled ? t('Evenings at {time}, if today’s reading is still to do', { time: formatTime(prefs.streakReminder.hour, prefs.streakReminder.minute) }) : tc('state', 'Off')} onPress={() => setSheet('reminder')} /> : null}
          <ListRow icon="block" label={t('Blocked users')} detail={t('Hidden from you, and no longer friends')} onPress={() => setSheet('blocked')} />
          <ListRow icon="share" label={t('Your data')} detail={t('Back up, restore or import; see or delete what is stored')} onPress={() => router.push('/your-data')} />
          {user.is_admin ? <ListRow icon="award" label={t('Admin')} detail={adminMode(user) ? t('Admin mode on: your badge, every group, moderation') : t('Admin mode, moderation queue and feedback')} onPress={() => setSheet('admin')} /> : null}
          <ListRow icon="x" label={t('Delete account')} danger onPress={deleteAccount} />
        </Card>
      ) : (
        <SignInCard ref={tourRef('settings-account')} title={t('Not signed in')} text={t('Sign in to sync bookmarks, keep a streak and join groups.')} />
      )}

      <H2 hint={t('Text, theme, reading and listening go back to how they came; added fonts, the daily goal, the reminder and your name stay')}>{t('Reset')}</H2>
      <Card ref={tourRef('settings-reset')}>
        <Button title={t('Reset all settings')} onPress={() => { reset(); toast.show(t('Settings reset')) }} style={{ alignSelf: 'flex-start' }} small />
      </Card>

      <View style={{ alignItems: 'center', gap: 10, marginTop: 8 }}>
        <VersionLine text={`${BRAND.fullName} ${Constants.expoConfig?.version ?? ''}`} />
        <Row style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          <Button small title={t('Privacy policy')} onPress={() => Linking.openURL(`${siteBase()}${policyPath('/privacy')}`)} />
          <Button small title={t('Terms')} onPress={() => Linking.openURL(`${siteBase()}/terms`)} />
          <Button small title={t('Copyright')} onPress={() => Linking.openURL(`${siteBase()}/copyright`)} />
        </Row>
      </View>
      <AddFontSheet open={sheet === 'font'} onClose={close} />
      <FeedbackSheet open={sheet === 'feedback'} onClose={close} />
      <ListeningSheet open={sheet === 'listening'} onClose={close} />
      <LanguageSheet open={sheet === 'language'} onClose={close} />
      <AgainSheet open={sheet === 'again'} onClose={close} />
      {Platform.OS !== 'web' ? <Sheet open={sheet === 'verse'} onClose={close} title={t('Verse of the day')}><ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}><VerseNotify /></ScrollView></Sheet> : null}
      {user ? <>
        {Platform.OS !== 'web' ? <Sheet open={sheet === 'reminder'} onClose={close} title={t('Streak reminder')}><ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}><StreakReminder /></ScrollView></Sheet> : null}
        <FriendsSettingsSheet open={sheet === 'friends'} onClose={close} />
        <AvatarSheet open={sheet === 'avatar'} onClose={close} />
        <Sheet open={sheet === 'blocked'} onClose={close} title={t('Blocked users')}><ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}><BlockedUsers /></ScrollView></Sheet>
        {user.is_admin ? <Sheet open={sheet === 'admin'} onClose={close} title={t('Admin')}><View style={{ padding: 16, gap: 10 }}><AdminLinks onGo={close} /></View></Sheet> : null}
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
    <Sheet open={open} onClose={onClose} title={t('Welcome and tour')}>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
        <ListRow icon="play" label={t('Welcome')} detail={t('The opening page and first steps')} onPress={() => after(playWelcome)} />
        <ListRow icon="info" label={t('Full tour')} detail={t('Every screen and sheet, one step at a time')} onPress={() => after(() => startTour(null, true))} />
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
  return <SwitchRow label={t('Public profile')} hint={on ? t('On: anyone can see your name, picture, badges, reading totals and streak') : t('Off: only your friends and group members see your name and picture')} value={on} onChange={flip} />
}

/** Account → Friends, with the invites waiting (live: a heartbeat or a check may bring one while Settings is open). */
function FriendsRow({ onPress }: { onPress: () => void }) {
  const n = useInvitesWaiting()
  return <ListRow icon="invite" label={t('Friends')} detail={n ? tn(n, '{n} invite waiting', '{n} invites waiting') : t('Invites, what friends see, reactions')} onPress={onPress} />
}

/** Added fonts past the second: one compact radio row each, under the font choice. */
function CustomFontList({ value, fonts, onChange, onRemove }: { value: Font; fonts: CustomFont[]; onChange: (f: Font) => void; onRemove: (f: CustomFont) => void }) {
  const c = useInks()
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('Your fonts')} style={{ gap: 2 }}>
      {fonts.map(f => {
        const key = customKey(f.id), on = value === key
        return (
          <Tap key={f.id} onPress={() => onChange(key)} scaleTo={0.985} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={f.name}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: on ? c.accentSoft : 'transparent' }}>
            <Text numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: TYPE.small, fontWeight: '600' }}>{f.name}</Text>
            {on ? <Icon name="check" size={16} color={c.accent} /> : null}
            <Tap onPress={() => onRemove(f)} accessibilityRole="button" accessibilityLabel={t('Remove {name}', { name: f.name })} hitSlop={8} style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}>
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
    try { await unblockUser(id); mutate(bs => bs.filter(b => b.user_id !== id)); toast.show(t('Unblocked @{handle}', { handle })) } catch (e) { setErr(errMsg(e)) } finally { setBusy(null) }
  }
  return (
    <>
      <View style={{ gap: 10 }}>
        {state.kind === 'loading' && <Spinner />}
        {state.kind === 'error' && <ErrorText>{state.message}</ErrorText>}
        {state.kind === 'ready' && state.data.length === 0 && <T small muted>{t('You have not blocked anyone. Blocking someone hides their posts and shared {many}, ends a friendship and stops their invites.', { many: NOUN.many })}</T>}
        {state.kind === 'ready' && state.data.map(b => (
          <Row key={b.user_id} style={{ justifyContent: 'space-between' }}>
            <View><T bold>{b.display_name || b.handle}</T><T small muted>@{b.handle}</T></View>
            <Button title={busy === b.user_id ? '…' : t('Unblock')} small disabled={busy !== null} onPress={() => { void unblock(b.user_id, b.handle) }} />
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
  const queue = state.kind === 'ready' ? t('Moderation queue ({n} pending)', { n: state.data.pending }) : t('Moderation queue')
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
      <SwitchRow label={t('Admin mode')} hint={on ? t('The Developer badge is by your name, and every group opens to you: post a notice, remove posts or members') : t('Off: you read, post and appear as an ordinary reader')} value={on} onChange={v => { void flip(v) }} />
      {modeErr && <ErrorText>{modeErr}</ErrorText>}
      {on ? <Button title={t('All groups')} primary onPress={() => { onGo(); router.push('/admin/groups') }} /> : null}
      <Button title={t('Live numbers')} onPress={() => { onGo(); router.push('/admin/live') }} />
      <Button title={queue} primary={state.kind === 'ready' && state.data.pending > 0} onPress={() => { onGo(); router.push('/admin/reports') }} />
      <Button title={t('Feedback')} onPress={() => { onGo(); router.push('/admin/feedback') }} />
      {state.kind === 'error' && <T small muted>{t('Pending count unavailable: {message}', { message: state.message })}</T>}
    </>
  )
}
