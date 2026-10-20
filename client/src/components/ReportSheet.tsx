import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { t, tc } from '@shared/i18n'
import { errMsg } from '../lib/community'
import { DETAILS_MAX, REASONS, submitReport, type ReportReason, type ReportTarget } from '../lib/moderation'
import { useToast } from '../store/toast'
import { SheetBody } from './CommunityBits'
import { Button, ErrorText, Input, Row, Segmented, Sheet, T } from './ui'

/**
 * Report a post, outline or user. Open while `target` is set; the caller clears it in `onClose`.
 * State resets on every open so a second report never inherits the previous reason or text.
 */
export default function ReportSheet({ target, onClose, onReported }: { target: ReportTarget | null; onClose: () => void; onReported?: (t: ReportTarget) => void }) {
  const toast = useToast()
  const [reason, setReason] = useState<ReportReason>('spam')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { if (target) { setReason('spam'); setDetails(''); setErr(null); setBusy(false) } }, [target])

  const submit = async () => {
    if (!target) return
    setBusy(true); setErr(null)
    try {
      await submitReport(target, reason, details)
      toast.show(t('Report sent'))
      onReported?.(target)
      onClose()
    } catch (e) {
      const m = errMsg(e)
      setErr(m); toast.show(t('Could not send the report: {error}', { error: m }))
    } finally { setBusy(false) }
  }
  const title = target?.label ? t('Report {target}', { target: target.label }) : tc('verb', 'Report')
  return (
    <Sheet open={target !== null} onClose={onClose} title={title}>
      <SheetBody>
        <T small muted>{t('Why are you reporting this?')}</T>
        <Segmented<ReportReason> value={reason} onChange={setReason} options={REASONS.map(r => ({ ...r, label: t(r.label) }))} />
        <View style={{ gap: 4 }}>
          <T small muted>{t('Details (optional)')}</T>
          <Input placeholder={t('Anything a moderator should know')} value={details} onChangeText={setDetails} maxLength={DETAILS_MAX} multiline style={{ minHeight: 70, textAlignVertical: 'top' }} />
          <T small muted style={{ textAlign: 'right' }}>{details.length} / {DETAILS_MAX}</T>
        </View>
        {err && <ErrorText>{err}</ErrorText>}
        <Row style={{ justifyContent: 'flex-end' }}>
          <Button title={t('Cancel')} small onPress={onClose} disabled={busy} />
          <Button title={busy ? t('Sending…') : t('Submit report')} primary small onPress={() => { void submit() }} disabled={busy} />
        </Row>
        <T small muted>{t('Reports are reviewed by a moderator. The person you report is not told who reported them.')}</T>
      </SheetBody>
    </Sheet>
  )
}
