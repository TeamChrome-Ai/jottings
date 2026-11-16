import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Platform, ScrollView, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type TextInput, type TextStyle, type ViewStyle } from 'react-native'
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import type { Sentence } from '@shared/assistantTools'
import { MINISTRY_AUTHORS } from '@shared/ministry'
import type { Ref } from '@shared/ref'
import { t, tc } from '@shared/i18n'
import { dateLocale } from '../src/i18n'
import { NOUN } from '@shared/brand'
import { ask, closeDraft, loadConversation, newConversation, placeOf, stop, streamed, useAssistantOn, useConversation, useLive, type Shown } from '../src/lib/assistant'
import { ASK_MAX, draftOf, takeDraft } from '../src/lib/askDraft'
import { sentenceParts } from '../src/lib/askRefs'
import { paragraphLink } from '../src/lib/libraryNav'
import { follows } from '../src/lib/askScroll'
import { sourcesOf } from '../src/lib/askSources'
import { openRef } from '../src/lib/outlines'
import { AskProposal, ChangeRow } from '../src/components/AskOutlines'
import FeedbackSheet from '../src/components/FeedbackSheet'
import SignInCard from '../src/components/SignInCard'
import { useBottomInset } from '../src/hooks/useBottomInset'
import { useKeyboardCover } from '../src/hooks/useKeyboardCover'
import { useReadingFont } from '../src/hooks/useReadingFont'
import { useInks } from '../src/hooks/useTheme'
import { useAuth } from '../src/store/auth'
import { usePref } from '../src/store/prefs'
import { face } from '../src/theme'
import { Button, Card, Enter, ErrorText, Input, Screen, SPACE, Spinner, T, Tap, TYPE, useColumn } from '../src/components/ui'

/** The box to write in: one line tall when empty, growing with what is written as far as six lines, then scrolling. */
const BOX_LINE = 22
const BOX_MIN = 48
const BOX_MAX = BOX_MIN + 5 * BOX_LINE

/**
 * Ask (docs/ASSISTANT.md): a conversation. It scrolls, and follows its newest words; the box to write in stays at the
 * foot of the screen, on the keyboard when it is up, with Send beside it (Stop while an answer streams); New
 * conversation is in the screen's header while there is a conversation. The conversation is kept on this device
 * (lib/assistant.ts) and goes on while another screen is open. `?draft=` puts words in the box, unsent (Search's bubble).
 */
export default function Ask() {
  const { user, ready } = useAuth()
  const on = useAssistantOn()
  const conv = useConversation()
  const talking = !!user && on === true
  const begun = talking && conv.shown.length > 0
  // New conversation stands in the header, away from Send, and only while there is a conversation to clear
  const header = useMemo(() => ({ headerRight: begun ? () => <Button small title={t('New conversation')} onPress={newConversation} style={Platform.OS === 'web' ? { marginRight: SPACE.l } : null} /> : undefined }), [begun])
  if (!ready || on === null) return <Screen><Spinner /></Screen>
  return (
    <>
      <Stack.Screen options={header} />
      {talking ? <Conversation key={user.id} uid={user.id} /> : (
        <Screen>
          <Disclosure />
          {!user ? <SignInCard text={t('Ask needs an account: sign in to ask about the Bible and the app.')} /> : <T muted>{t('Ask is not available on this server.')}</T>}
        </Screen>
      )}
    </>
  )
}

const Disclosure = () => <T small muted>{t('Answers come from an AI model reading the library. What you write here is sent to the model’s provider, and so is {a} of yours when you ask Ask about it.', { a: NOUN.a })}</T>

function Conversation({ uid }: { uid: number }) {
  const conv = useConversation()
  const live = useLive()
  const c = useInks()
  const foot = useBottomInset()
  // a draft the route brought (Search's bubble, lib/askDraft.ts) is in the box from the first frame, and then taken
  // off the route: read once, and never sent from here. Cleared through the screen's own navigation, once it has
  // mounted: the router is not ready to be asked while a pushed screen is still mounting, and throws
  const { draft } = useLocalSearchParams<{ draft?: string }>()
  const navigation = useNavigation()
  const [text, setText] = useState(() => draftOf(draft))
  useEffect(() => { void loadConversation(uid) }, [uid])
  useEffect(() => {
    const words = takeDraft(draft, () => navigation.setParams({ draft: undefined } as never))
    if (words) setText(words)
  }, [draft, navigation])

  // the conversation follows its newest words (a message sent, an answer as it streams, the keyboard taking room)
  // until the reader scrolls up to read, and again once they are back at its end (lib/askScroll.ts)
  const scroller = useRef<ScrollView>(null)
  const following = useRef(true)
  const offset = useRef(0)
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent
    following.current = follows(following.current, offset.current, { y: contentOffset.y, view: layoutMeasurement.height, content: contentSize.height })
    offset.current = contentOffset.y
  }, [])
  const toEnd = useCallback(() => { if (following.current) scroller.current?.scrollToEnd({ animated: false }) }, [])
  // only when the conversation or the room it shows in has changed height: a screen laid out again as it was (Back
  // from a verse or a paragraph, when it had no height while it was out of sight) is left where the reader had it
  const sized = useRef({ view: 0, content: 0 })
  const onContent = useCallback((_w: number, h: number) => { if (h && h !== sized.current.content) { sized.current.content = h; toEnd() } }, [toEnd])
  const onView = useCallback((e: LayoutChangeEvent) => { const h = e.nativeEvent.layout.height; if (h && h !== sized.current.view) { sized.current.view = h; toEnd() } }, [toEnd])
  const send = () => { const q = text; setText(''); following.current = true; void ask(q) }

  // the screen's foot rises by what the keyboard covers, so the box stands on it
  const frame = useRef<View>(null)
  const cover = useKeyboardCover(frame)
  const column = useColumn()
  return (
    <View ref={frame} style={{ flex: 1, backgroundColor: c.bg, paddingBottom: cover }}>
      <ScrollView ref={scroller} testID="ask-conversation" style={{ flex: 1 }} contentContainerStyle={[column, { paddingHorizontal: SPACE.xl, paddingVertical: SPACE.l }]}
        keyboardShouldPersistTaps="handled" onScroll={onScroll} scrollEventThrottle={16} onContentSizeChange={onContent} onLayout={onView}>
        <Enter>
          <Disclosure />
          {conv.shown.length || live.asking ? null : (
            <T muted testID="ask-empty" style={{ marginTop: SPACE.l }}>{t('Ask a question about the Bible and the answer comes from the library, with its sources. Ask can also find a verse, open a chapter or change a setting for you.')}</T>
          )}
          {conv.shown.map((s, i) => <View key={i} style={{ marginTop: gapBefore(s.kind, conv.shown[i - 1]?.kind) }}><ShownRow s={s} index={i} /></View>)}
          {/* a write the server held waits here for the reader's tap, where the answer's words would come */}
          {live.proposal ? <View style={{ marginTop: SPACE.m }}><AskProposal p={live.proposal} /></View>
            : live.asking ? <View style={{ marginTop: SPACE.m }}>{live.words ? <Answer words={streamed(live.words)} /> : <Spinner label={t('Asking')} />}</View> : null}
        </Enter>
      </ScrollView>
      <View testID="ask-composer" style={[column, { flexDirection: 'row', alignItems: 'flex-end', gap: SPACE.s, paddingHorizontal: SPACE.xl, paddingTop: SPACE.s, paddingBottom: cover ? SPACE.s : SPACE.m + foot }]}>
        <Box value={text} onChangeText={setText} />
        {live.asking
          ? <Button title={tc('verb', 'Stop')} onPress={stop} style={SEND} />
          : <Button primary title={t('Send')} disabled={!text.trim()} onPress={send} style={SEND} />}
      </View>
      <FeedbackSheet open={live.draft !== null} draft={live.draft ?? ''} onClose={closeDraft} />
    </View>
  )
}
/** Send, on the box's last line: the button is 44 high beside a line of 48. */
const SEND: ViewStyle = { marginBottom: (BOX_MIN - 44) / 2 }

/** The space above a row of the conversation: a reader's message begins a turn, and what answers it stays close to it. */
const gapBefore = (kind: Shown['kind'], after: Shown['kind'] | undefined): number =>
  after === undefined ? SPACE.l : kind === 'reader' ? SPACE.xxl : kind === 'change' && after === 'change' ? SPACE.xs : SPACE.m

/**
 * The box to write in. On the phone a field of several lines grows with its words by itself, between the two heights;
 * a browser's does not, so there the height is read from the words each time they change (the field is measured at
 * no height, where its scroll height is its words' own).
 */
function Box({ value, onChangeText }: { value: string; onChangeText: (text: string) => void }) {
  const field = useRef<TextInput>(null)
  const [height, setHeight] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return
    const el = field.current as unknown as HTMLTextAreaElement | null
    if (!el?.style) return
    const was = el.style.height
    el.style.height = '0px'
    const words = el.scrollHeight
    el.style.height = was
    // the scroll height has the padding and not the 2 px outline on each side
    setHeight(Math.min(BOX_MAX, Math.max(BOX_MIN, words + 4)))
  }, [value])
  return (
    <Input inputRef={field} value={value} onChangeText={onChangeText} multiline maxLength={ASK_MAX} placeholder={t('Ask about the Bible or the app')} accessibilityLabel={t('Your question')}
      style={{ flex: 1, minHeight: BOX_MIN, maxHeight: BOX_MAX, height, lineHeight: BOX_LINE }} />
  )
}

/** One kept row. It is drawn again only when the row itself changes: the conversation above it re-renders at every
 *  word of an answer as it comes, and a kept row holds none of those words. */
const ShownRow = memo(function ShownRow({ s, index }: { s: Shown; index: number }) {
  switch (s.kind) {
    case 'reader': return <Card tone="soft" style={{ alignSelf: 'flex-end', maxWidth: '85%', paddingVertical: SPACE.m }}><T>{s.text}</T></Card>
    case 'answer': return <Answer sentences={s.sentences} />
    case 'change': return <ChangeRow s={s} index={index} />
    case 'cap': {
      const time = new Date(s.resetsAt).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
      return <T muted>{s.cap === 'account' ? t('That is all of today’s questions for your account. Ask answers again at {time}.', { time }) : t('Ask has answered all it can for today. It answers again at {time}.', { time })}</T>
    }
    // a proposal answered after Ask could go on from it: said quietly, since what the reader chose was done
    case 'lapsed': return <T small muted>{t('Ask waited too long to go on from here. Send a new message to continue.')}</T>
    case 'error': return <ErrorText>{s.text}</ErrorText>
  }
})

const authorOf = (id: string) => MINISTRY_AUTHORS.find(a => a.id === id)?.short ?? id
const SANS = face('sans')
/** The app's own label kept on one line: its spaces do not break ("no source" is never "no" at a line's end). */
const whole = (label: string) => label.replace(/ /g, '\u00A0')

/**
 * An answer in the reader's font: its sentences as prose, each followed by the number of every paragraph it rests on,
 * and under it the list of those paragraphs, numbered by first appearance (lib/askSources.ts), the author and the work
 * once each. A number and a line of the list both open the paragraph in the library, and both are named by author and
 * work for a screen reader. A sentence of an answer from the library that rests on none is in the ink of the others,
 * with "no source" after it in small muted type: said, not left to a colour. While the answer streams, its words so
 * far. In a finished answer every Bible reference that exists ("John 3:16", "Rom. 8:1-4", "Psalm 23") is a link, as
 * one in a note is, and opens the reader at its verse; they are read here from the answer's own words
 * (lib/askRefs.ts). All of it is drawn from the answer as it is kept, so the answers already in the conversation show
 * the same way and nothing is asked of the server for them. Back returns to the conversation.
 */
function Answer({ sentences, words }: { sentences?: Sentence[]; words?: string }) {
  const size = usePref('fontSize')
  const { body, bold } = useReadingFont(Math.min(size, 20))
  const c = useInks()
  const conv = useConversation()
  const router = useRouter()
  const { sources, parts } = useMemo(() => {
    const sources = sourcesOf(sentences ?? [], id => !!placeOf(conv, id))
    const number = (id: number) => { const i = sources.indexOf(id); return i < 0 ? null : i + 1 }
    return { sources, parts: (sentences ?? []).map(s => sentenceParts(s, number)) }
  }, [sentences, conv])
  const label = (id: number) => { const p = placeOf(conv, id); return p ? t('Open {author}, {work}', { author: authorOf(p.author), work: p.work.title }) : undefined }
  const open = (id: number) => { const p = placeOf(conv, id); if (p) router.push(paragraphLink(p.author, p)) }
  return (
    <View style={{ gap: SPACE.m }}>
      <Text style={[body, { color: c.text }]}>
        {words ?? sentences!.map((s, k) => (
          <Text key={k}>
            {k ? ' ' : ''}{parts[k].map((p, i) => ('cite' in p ? <Text key={i} testID="ask-cite" accessibilityRole="link" accessibilityLabel={label(p.cite)} style={{ color: c.accent }} onPress={() => open(p.cite)}>{p.text}</Text>
              : p.ref ? <RefLink key={i} to={p.ref} text={p.text} style={[bold, { color: c.accent }]} />
              : p.text))}
            {s.supported ? null : <>{' '}<Text testID="ask-no-source" style={[SANS, { color: c.muted, fontSize: TYPE.caption }]}>{whole(t('no source'))}</Text></>}
          </Text>
        ))}
      </Text>
      {sources.length ? (
        <View>
          <View style={{ width: 48, height: 1, backgroundColor: c.border, marginBottom: SPACE.xs }} />
          {sources.map((id, i) => {
            const p = placeOf(conv, id)
            return (
              <Tap key={id} testID="ask-source" accessibilityRole="link" accessibilityLabel={label(id)} onPress={() => open(id)} scaleTo={0.985} style={{ flexDirection: 'row', gap: SPACE.s, paddingVertical: SPACE.s }}>
                <T small bold accent style={{ lineHeight: 20, minWidth: 16, fontVariant: ['tabular-nums'] }}>{i + 1}</T>
                <T small muted style={{ flex: 1, lineHeight: 20 }}>{authorOf(p!.author)}, {p!.work.title}</T>
              </Tap>
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

/** A reference in an answer: opens the reader at its chapter with its verses marked (lib/outlines.ts `openRef`). */
function RefLink({ to, text, style }: { to: Ref; text: string; style: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="link" style={style} onPress={() => openRef(to)}>{text}</Text>
}
