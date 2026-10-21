import { useState } from 'react'
import { Platform, Text, View } from 'react-native'
import Constants from 'expo-constants'
import { t } from '@shared/i18n'
import { BRAND } from '@shared/brand'
import { useInks } from '../hooks/useTheme'
import { errMsg } from '../lib/community'
import { MESSAGE_MAX, appVersionLabel, feedbackBody, sendFeedback } from '../lib/feedback'
import { answerReviewAsk, useReviewAsk, type ReviewAnswer } from '../lib/reviewAsk'
import { openStore } from '../lib/storeUpdate'
import { useAuth } from '../store/auth'
import Icon from './Icon'
import { Button, Card, ErrorText, Input, Row, T, Tap, TYPE } from './ui'

type Step = 'ask' | 'like' | 'note' | 'done'

/**
 * Home's ask for a review, while the owner has one running and this reader has read enough (lib/reviewAsk.ts). It asks
 * whether the app is a help; then a review on Google Play and a private note to the developer are both on offer
 * whatever the answer (Play does not allow keeping the review from those who say no), the one the answer suggests in
 * the accent and the other a quiet link. Once answered it is not shown again; the × closes it unanswered.
 */
export default function ReviewAsk() {
  const c = useInks()
  const { user } = useAuth()
  const ask = useReviewAsk(!!user)
  const [step, setStep] = useState<Step>('ask')
  const [answer, setAnswer] = useState<ReviewAnswer | null>(null)
  const [closed, setClosed] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!ask || closed) return null

  const say = (body: Parameters<typeof answerReviewAsk>[1]) => { answerReviewAsk(ask, body).catch(() => {}) }
  const choose = (a: 'like' | 'dislike') => { say({ answer: a }); setAnswer(a); setStep(a === 'like' ? 'like' : 'note') }
  const review = () => { say({ store: true }); openStore(); setStep('done') }
  const close = () => { if (!answer) say({ answer: 'later' }); setClosed(true) }
  const body = feedbackBody(message, '', appVersionLabel(Constants.expoConfig?.version, Constants.expoConfig?.android?.versionCode), Platform.OS)
  const send = async () => {
    if (!body) return
    setBusy(true); setErr(null)
    try {
      const { id } = await sendFeedback(body)
      say({ feedback_id: id })
      setStep('done')
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(false) }
  }
  const quiet = (label: string, onPress: () => void) => (
    <Text accessibilityRole="link" onPress={onPress} style={{ color: c.muted, fontSize: TYPE.small, textDecorationLine: 'underline' }}>{label}</Text>
  )

  return (
    <Card>
      <Row style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
        <T bold style={{ flex: 1 }}>
          {step === 'ask' ? t('Is {brand} a help to you?', { brand: BRAND.name })
            : step === 'like' ? t('Thank you. A review on Google Play helps other readers find {brand}.', { brand: BRAND.name })
            : step === 'note' ? answer === 'dislike' ? t('Thank you for saying. What would make {brand} better?', { brand: BRAND.name }) : t('A private note to the developer')
            : t('Thank you.')}
        </T>
        <Tap onPress={close} accessibilityRole="button" aria-label={t('Not now')} hitSlop={12}>
          <Icon name="x" size={18} color={c.muted} />
        </Tap>
      </Row>
      {step === 'ask' ? (
        <Row>
          <Button small lead="like" title={t('Yes')} onPress={() => choose('like')} />
          <Button small lead="dislike" title={t('Not really')} onPress={() => choose('dislike')} />
        </Row>
      ) : step === 'like' ? (
        <View style={{ gap: 10, alignItems: 'flex-start' }}>
          <Button primary small title={t('Leave a review')} onPress={review} />
          {quiet(t('Or send the developer a private note'), () => setStep('note'))}
        </View>
      ) : step === 'note' ? (
        <View style={{ gap: 10 }}>
          <T small muted>{t('Only the developer reads this.')}</T>
          <Input placeholder={t('Your message')} accessibilityLabel={t('Your message')} value={message} onChangeText={setMessage} maxLength={MESSAGE_MAX} multiline style={{ minHeight: 96, textAlignVertical: 'top' }} />
          {err ? <ErrorText>{err}</ErrorText> : null}
          <Row style={{ justifyContent: 'space-between' }}>
            {quiet(t('Leave a review on Google Play'), review)}
            <Button primary small title={busy ? t('Sending…') : t('Send')} onPress={() => { void send() }} disabled={busy || !body} />
          </Row>
        </View>
      ) : null}
    </Card>
  )
}
