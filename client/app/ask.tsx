import { useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import type { Sentence } from '@shared/assistantTools'
import { MINISTRY_AUTHORS } from '@shared/ministry'
import { t, tc } from '@shared/i18n'
import { dateLocale } from '../src/i18n'
import { ask, closeDraft, loadConversation, newConversation, placeOf, stop, streamed, undoShown, useAssistantOn, useConversation, useLive, type Shown } from '../src/lib/assistant'
import { changeText } from '../src/lib/assistantActions'
import FeedbackSheet from '../src/components/FeedbackSheet'
import SignInCard from '../src/components/SignInCard'
import { useReadingFont } from '../src/hooks/useReadingFont'
import { useInks } from '../src/hooks/useTheme'
import { useAuth } from '../src/store/auth'
import { usePref } from '../src/store/prefs'
import { Button, Card, ErrorText, Input, Row, Screen, SPACE, Spinner, T, TYPE } from '../src/components/ui'

/**
 * Ask (docs/ASSISTANT.md): the conversation, a box to write in, Send, and Stop while an answer streams. The
 * conversation is kept on this device (lib/assistant.ts) and goes on while another screen is open.
 */
export default function Ask() {
  const { user, ready } = useAuth()
  const on = useAssistantOn()
  if (!ready || on === null) return <Screen><Spinner /></Screen>
  return (
    <Screen>
      <T small muted>{t('Answers come from an AI model reading the library. What you write here is sent to the model’s provider.')}</T>
      {!user ? <SignInCard text={t('Ask needs an account: sign in to ask about the Bible and the app.')} />
        : !on ? <T muted>{t('Ask is not available on this server.')}</T>
        : <Conversation key={user.id} uid={user.id} />}
    </Screen>
  )
}

function Conversation({ uid }: { uid: number }) {
  const conv = useConversation()
  const live = useLive()
  const [text, setText] = useState('')
  useEffect(() => { void loadConversation(uid) }, [uid])
  const send = () => { const q = text; setText(''); void ask(q) }
  return (
    <>
      {conv.shown.map((s, i) => <ShownRow key={i} s={s} index={i} />)}
      {live.asking ? (live.words ? <Answer words={streamed(live.words)} /> : <Spinner label={t('Asking')} />) : null}
      <Input value={text} onChangeText={setText} multiline maxLength={2000} placeholder={t('Ask about the Bible or the app')} accessibilityLabel={t('Your question')}
        style={{ minHeight: 72, textAlignVertical: 'top' }} />
      <Row style={{ justifyContent: 'space-between' }}>
        {conv.shown.length ? <Button small title={t('New conversation')} onPress={newConversation} /> : <View />}
        {live.asking
          ? <Button small title={tc('verb', 'Stop')} onPress={stop} />
          : <Button small primary title={t('Send')} disabled={!text.trim()} onPress={send} />}
      </Row>
      <FeedbackSheet open={live.draft !== null} draft={live.draft ?? ''} onClose={closeDraft} />
    </>
  )
}

function ShownRow({ s, index }: { s: Shown; index: number }) {
  switch (s.kind) {
    case 'reader': return <Card tone="soft" style={{ alignSelf: 'flex-end', maxWidth: '85%', paddingVertical: SPACE.m }}><T>{s.text}</T></Card>
    case 'answer': return <Answer sentences={s.sentences} />
    case 'change': return (
      <Row style={{ justifyContent: 'space-between', gap: SPACE.m }}>
        <T small muted style={{ flexShrink: 1 }}>{changeText(s.change.line)}</T>
        {s.undone ? <T small muted>{t('Undone')}</T> : <Button small title={t('Undo')} onPress={() => void undoShown(index)} />}
      </Row>
    )
    case 'cap': {
      const time = new Date(s.resetsAt).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
      return <T muted>{s.cap === 'account' ? t('That is all of today’s questions for your account. Ask answers again at {time}.', { time }) : t('Ask has answered all it can for today. It answers again at {time}.', { time })}</T>
    }
    case 'error': return <ErrorText>{s.text}</ErrorText>
  }
}

/** An answer in the reader's font: each sentence with a citation for every paragraph it rests on, a sentence of an
 *  answer from the library that rests on none muted; or, while it streams, its words so far. */
function Answer({ sentences, words }: { sentences?: Sentence[]; words?: string }) {
  const size = usePref('fontSize')
  const { body } = useReadingFont(Math.min(size, 20))
  const c = useInks()
  return (
    <Text style={[body, { color: c.text }]}>
      {words ?? sentences!.map((s, k) => (
        <Text key={k} style={s.supported ? null : { color: c.muted }}>
          {k ? ' ' : ''}{s.text}{s.ids.map(id => <Citation key={id} id={id} />)}
        </Text>
      ))}
    </Text>
  )
}

function Citation({ id }: { id: number }) {
  const router = useRouter()
  const conv = useConversation()
  const c = useInks()
  const p = placeOf(conv, id)
  if (!p) return null
  const author = MINISTRY_AUTHORS.find(a => a.id === p.author)?.short ?? p.author
  return (
    <Text accessibilityRole="link" accessibilityLabel={t('Open {author}, {work}', { author, work: p.work.title })} style={{ color: c.accent, fontSize: TYPE.small }}
      onPress={() => router.push({ pathname: '/companion', params: { author: p.author, work: p.work.id, n: String(p.n), p: String(p.para) } })}>
      {` ${author}, ${p.work.title}`}
    </Text>
  )
}
