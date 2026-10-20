import { useState } from 'react'
import { Platform, Pressable, ScrollView, Text, View } from 'react-native'
import Constants from 'expo-constants'
import { sendFeedback } from '../lib/feedback'
import { copyText } from '../lib/outlines'
import { NOUN } from '@shared/brand'
import { t } from '@shared/i18n'

/**
 * The root error boundary's screen. It must work when the providers themselves are what failed, so it reads no
 * theme, prefs or auth: a fixed paper palette, plain components, and the feedback endpoint (which works signed out).
 */
const P = { bg: '#faf7f2', card: '#efe9df', text: '#2b2118', muted: '#6f6254', accent: '#7c2d12', accentText: '#fff8f0' }

export default function CrashScreen({ error, retry }: { error: Error; retry: () => Promise<void> | void }) {
  const [sent, setSent] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle')
  const [copied, setCopied] = useState(false)
  const version = `${Constants.expoConfig?.version ?? ''}${Constants.expoConfig?.android?.versionCode ? ` (${Constants.expoConfig.android.versionCode})` : ''}`
  const details = `${error?.name ?? 'Error'}: ${error?.message ?? String(error)}\n${(error?.stack ?? '').split('\n').slice(0, 14).join('\n')}`
  const send = async () => {
    setSent('sending')
    try { await sendFeedback({ message: `Crash report\n\n${details}`.slice(0, 1900), app_version: version, platform: Platform.OS }); setSent('sent') } catch { setSent('failed') }
  }
  const btn = (primary: boolean) => ({ paddingHorizontal: 18, height: 44, borderRadius: 22, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: primary ? P.accent : P.card })
  return (
    <View style={{ flex: 1, backgroundColor: P.bg, justifyContent: 'center', padding: 28, gap: 16 }}>
      <Text accessibilityRole="header" style={{ color: P.text, fontSize: 26, fontWeight: '700' }}>{t('Something went wrong')}</Text>
      <Text style={{ color: P.muted, fontSize: 16, lineHeight: 23 }}>{t('That screen hit an error. Your reading, bookmarks and {many} are safe.', { many: NOUN.many })}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Pressable accessibilityRole="button" onPress={() => { void retry() }} style={btn(true)}><Text style={{ color: P.accentText, fontWeight: '700' }}>{t('Try again')}</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={sent === 'sending' || sent === 'sent'} onPress={() => { void send() }} style={btn(false)}>
          <Text style={{ color: P.text, fontWeight: '600' }}>{sent === 'sent' ? t('Report sent') : sent === 'sending' ? t('Sending…') : sent === 'failed' ? t('Send again') : t('Send report')}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => { void copyText(details).then(ok => setCopied(ok)) }} style={btn(false)}><Text style={{ color: P.text, fontWeight: '600' }}>{copied ? t('Copied') : t('Copy details')}</Text></Pressable>
      </View>
      <ScrollView style={{ maxHeight: 160, backgroundColor: P.card, borderRadius: 14 }} contentContainerStyle={{ padding: 12 }}>
        <Text selectable style={{ color: P.muted, fontSize: 12, fontFamily: Platform.select({ android: 'monospace', default: 'monospace' }) }}>{details}</Text>
      </ScrollView>
    </View>
  )
}
