import { useState } from 'react'
import { View } from 'react-native'
import { Redirect, Stack } from 'expo-router'
import { Tag, UserLink } from '../../src/components/CommunityBits'
import { Button, Card, ErrorText, Row, Screen, Segmented, Spinner, T } from '../../src/components/ui'
import { BusyDots, MotionItem, Swap, TintLayer, useArrivals } from '../../src/components/motion/community'
import { confirmAsync, errMsg, fmtWhen, useLoad } from '../../src/lib/community'
import { KIND_LABEL, adminAct, adminReports, aiSummary, isReportKind, reasonLabel, type AdminFilter, type AdminReport, type ModerationAction } from '../../src/lib/moderation'
import { useAuth } from '../../src/store/auth'
import { useToast } from '../../src/store/toast'
import { useColors } from '../../src/hooks/useTheme'
import { NOUN } from '@shared/brand'

const FILTERS: { value: AdminFilter; label: string }[] = [{ value: 'pending', label: 'Pending' }, { value: 'all', label: 'All' }]
const CONFIRM: Record<ModerationAction, { title: string; message: string; ok: string } | null> = {
  allow: null,
  remove: { title: 'Remove this content?', message: `Posts and ${NOUN.many} are deleted; for a user report all of their content is hidden.`, ok: 'Remove' },
  ban: { title: 'Ban this user?', message: 'A nuke: the account is disabled and signed out, removed from every group and friendship, all of its content hidden, and its networks, devices and Google account blocked from signing up again.', ok: 'Ban' },
  unban: { title: 'Lift the ban?', message: 'The account works again and their content shows, except anything another report still holds.', ok: 'Unban' },
}
const DONE: Record<ModerationAction, string> = { allow: 'Allowed', remove: 'Removed', ban: 'Banned', unban: 'Ban lifted' }
/** Allowing what the judge banned for also lifts the ban (rs/src/moderation.rs, admin_act), so it asks first. */
const ALLOW_BANNED = { title: 'Allow and lift the ban?', message: 'The AI suspended this account for this content. Allowing it restores the account.', ok: 'Allow' }

/** Admin moderation queue. Non-admins are sent home; the server enforces the same rule on every call. */
export default function AdminReportsScreen() {
  const { user, ready } = useAuth()
  const isAdmin = !!user?.is_admin
  if (ready && !isAdmin) return <Redirect href="/" />
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: 'Moderation queue' }} />
      {isAdmin ? <Queue /> : <Spinner />}
    </Screen>
  )
}

function Queue() {
  const toast = useToast()
  const [filter, setFilter] = useState<AdminFilter>('pending')
  const { state, reload, mutate } = useLoad(() => adminReports(filter), [filter])
  const [busy, setBusy] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)
  // cards leaving the Pending view collapse first, then leave the data
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set())
  const arrivals = useArrivals(state.kind === 'ready' ? state.data.map(r => r.id) : null)
  const gone = (id: number) => {
    mutate(rs => rs.filter(x => x.id !== id))
    setLeaving(s => { const n = new Set(s); n.delete(id); return n })
  }

  const act = async (r: AdminReport, action: ModerationAction) => {
    const ask = action === 'allow' && r.ai_verdict === 'ban' && r.target?.author?.banned ? ALLOW_BANNED : CONFIRM[action]
    if (ask && !(await confirmAsync(ask.title, ask.message, ask.ok))) return
    setBusy(r.id); setErr(null)
    try {
      await adminAct(r.id, action)
      toast.show(DONE[action])
      // Pending drops the card; All keeps it and asks the server for the resolved row (statuses after an action are server-defined).
      if (filter === 'pending') setLeaving(s => new Set(s).add(r.id)); else reload()
    } catch (e) { setErr(errMsg(e)) } finally { setBusy(null) }
  }
  return (
    <>
      <Segmented<AdminFilter> value={filter} onChange={setFilter} options={FILTERS} />
      {err && <ErrorText>{err}</ErrorText>}
      {state.kind === 'loading' && <Spinner />}
      {state.kind === 'error' && <Card><ErrorText>{state.message}</ErrorText><Button small title="Retry" onPress={reload} style={{ alignSelf: 'flex-start' }} /></Card>}
      {state.kind === 'ready' && state.data.length === 0 && <T muted>{filter === 'pending' ? 'Nothing waiting for review.' : 'No reports yet.'}</T>}
      {state.kind === 'ready' && state.data.map((r, i) => (
        <MotionItem key={r.id} {...arrivals.modeFor(r.id, i)} gap={12} leaving={leaving.has(r.id)} onGone={() => gone(r.id)}>
          <ReportCard report={r} busy={busy === r.id} disabled={busy !== null || leaving.size > 0} onAct={a => { void act(r, a) }} />
        </MotionItem>
      ))}
    </>
  )
}

function ReportCard({ report: r, busy, disabled, onAct }: { report: AdminReport; busy: boolean; disabled: boolean; onAct: (a: ModerationAction) => void }) {
  const c = useColors()
  const ai = aiSummary(r)
  const kind = isReportKind(r.kind) ? KIND_LABEL[r.kind] : r.kind
  const target = r.target
  // the card's wash says where the report stands, and crossfades when an action moves it on
  const tone = r.status === 'hidden' ? c.danger : r.status === 'pending' || r.status === 'escalated' ? c.accent : null
  return (
    <Card>
      <TintLayer color={tone} strength={0.08} />
      <Row>
        <Tag accent label={kind} />
        <Tag label={reasonLabel(r.reason)} />
        <Swap k={r.status}><Tag label={r.status} /></Swap>
        {target && (target.hidden === 1 || target.hidden === true) && <Tag label="Content hidden" />}
        {target?.author?.banned ? <Tag label="Account suspended" /> : null}
        <View style={{ flex: 1 }} />
        <T small muted>{fmtWhen(r.created_at)}</T>
      </Row>
      <Row>
        <T small muted>Reported by</T>
        {r.reporter ? <UserLink handle={r.reporter.handle} name={`@${r.reporter.handle}`} small /> : <T small muted>unknown</T>}
        <T small muted>· report #{r.id}</T>
      </Row>
      {r.details ? <T>{r.details}</T> : <T small muted>No details given.</T>}

      <View style={{ gap: 2 }}>
        <T small bold>AI review</T>
        {ai.kind === 'pending' && <T small muted>Still running.</T>}
        {ai.kind === 'undecided' && <T small style={{ color: c.danger }}>{ai.text}</T>}
        {ai.kind === 'verdict' && <T small>Verdict: <T small bold>{ai.verdict}</T>{r.ai_category ? <T small muted> · {r.ai_category}</T> : null}</T>}
        {r.ai_reason ? <T small muted>{r.ai_reason}</T> : null}
      </View>

      <View style={{ gap: 2, borderLeftWidth: 2, borderLeftColor: c.border, paddingLeft: 10 }}>
        <Row>
          <T small bold>{kind} #{r.target_id}</T>
          {target?.author ? <><T small muted>by</T><UserLink handle={target.author.handle} name={`@${target.author.handle}`} small /></> : null}
        </Row>
        {target ? (target.preview ? <T numberOfLines={6}>{target.preview}</T> : <T small muted>No preview.</T>) : <T small muted>Content no longer available.</T>}
      </View>

      <Row>
        <Button title="Allow" small disabled={disabled} onPress={() => onAct('allow')} />
        <Button title="Remove" small danger disabled={disabled} onPress={() => onAct('remove')} />
        {target?.author?.banned
          ? <Button title="Unban" small disabled={disabled} onPress={() => onAct('unban')} />
          : <Button title="Ban" small danger disabled={disabled} onPress={() => onAct('ban')} />}
        {busy && <><BusyDots /><T small muted>Working…</T></>}
      </Row>
    </Card>
  )
}
