import { useCallback } from 'react'
import { View } from 'react-native'
import { Redirect, Stack, useFocusEffect } from 'expo-router'
import { get } from '../../src/lib/api'
import { useLoad } from '../../src/lib/community'
import { lastHours, serverTotals, type Count, type LiveStats } from '../../src/lib/liveStats'
import { Card, ErrorText, H2, Row, Screen, Spinner, T } from '../../src/components/ui'
import { useColors } from '../../src/hooks/useTheme'
import { useAuth } from '../../src/store/auth'
import { BRAND, NOUN } from '@shared/brand'

/** How often the numbers are asked for again while the screen is open. */
const EVERY_MS = 15_000
const HOURS = 24

/** The admin's live numbers (GET /api/admin/live): store clicks, accounts, readers and the server, asked for again every
 *  15 seconds while the screen is in front. Non-admins are sent home; the server enforces the same rule. */
export default function AdminLiveScreen() {
  const { user, ready } = useAuth()
  const isAdmin = !!user?.is_admin
  if (ready && !isAdmin) return <Redirect href="/" />
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: 'Live numbers' }} />
      {isAdmin ? <Numbers /> : <Spinner />}
    </Screen>
  )
}

function Numbers() {
  const { state, reload } = useLoad(() => get<LiveStats>('/admin/live'), [])
  useFocusEffect(useCallback(() => {
    const t = setInterval(() => { reload() }, EVERY_MS)
    return () => clearInterval(t)
  }, [reload]))
  if (state.kind === 'loading') return <Spinner />
  if (state.kind === 'error') return <ErrorText>{state.message}</ErrorText>
  const s = state.data
  const now = new Date(s.now)
  const srv = serverTotals(s.server.by_hour)
  return (
    <>
      <T small muted>As of {now.toLocaleTimeString()}, refreshed every 15 seconds. Times are on this device’s clock.</T>
      <Row style={{ gap: 12, flexWrap: 'wrap' }}>
        <Tile label="Store clicks today" value={s.clicks.today} detail={`${s.clicks.total} in all`} />
        <Tile label="Accounts" value={s.accounts.total} detail={`${s.accounts.today} new today`} />
        <Tile label="Signed-in readers today" value={s.readers.today} detail={`${s.readers.minutes_today} minutes read`} />
        <Tile label="App opens" value={srv.opens} detail="since the server started" />
      </Row>

      <H2 hint={`${BRAND.host}/get, the link you hand out`}>Store clicks by hour</H2>
      <Card><Bars rows={lastHours(s.clicks.by_hour, now, HOURS)} /></Card>

      <H2 hint="Each time the app or site is opened or brought back to the front, signed in or not">App opens by hour</H2>
      <Card><Bars rows={lastHours(s.server.by_hour, now, HOURS, h => h.opens)} /></Card>

      <H2 hint={`Since the server last started, ${new Date(s.server.since).toLocaleString()}. Answer times leave out recordings being downloaded`}>Server</H2>
      <Card>
        <Line label="Requests" value={srv.requests.toLocaleString()} />
        <Line label="Server errors" value={String(srv.errors)} bad={srv.errors > 0} />
        <Line label="Average answer" value={`${srv.avgMs} ms`} />
        <Line label="95 in 100 answers within" value={s.server.p95_ms != null ? `${s.server.p95_ms} ms` : '—'} />
      </Card>

      <H2>Community</H2>
      <Card>
        <Line label="Reading groups" value={String(s.community.groups)} />
        <Line label={NOUN.Many} value={String(s.community.jottings)} />
        <Line label="Feedback messages" value={String(s.community.feedback)} />
        <Line label="Reports waiting" value={String(s.community.reports_pending)} bad={s.community.reports_pending > 0} />
      </Card>

      <H2>By day</H2>
      <Card>
        <Days title="Store clicks" rows={s.clicks.by_day} />
        <Days title="New accounts" rows={s.accounts.by_day} />
      </Card>
      <T small muted>Installs and reviews are Google’s figures: Play Console → Statistics. A reader without an account leaves no trace here beyond an app open.</T>
    </>
  )
}

function Tile({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <Card style={{ flexGrow: 1, flexBasis: 150, gap: 2 }}>
      <T small muted>{label}</T>
      <T bold style={{ fontSize: 34, lineHeight: 40, fontVariant: ['tabular-nums'] }}>{value.toLocaleString()}</T>
      <T small muted>{detail}</T>
    </Card>
  )
}

/** One bar an hour, the tallest filling the height; the count over each bar that has one, the hour under every third. */
function Bars({ rows }: { rows: { key: string; label: string; value: number }[] }) {
  const c = useColors()
  const top = Math.max(1, ...rows.map(r => r.value))
  const H = 120
  return (
    <View accessibilityLabel={rows.filter(r => r.value).map(r => `${r.label}:00, ${r.value}`).join('; ') || 'Nothing counted yet'}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: H + 18, gap: 2 }}>
        {rows.map(r => (
          <View key={r.key} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
            {r.value ? <T small muted style={{ fontSize: 9, lineHeight: 12, fontVariant: ['tabular-nums'] }}>{r.value}</T> : null}
            <View style={{ width: '100%', height: Math.max(r.value ? 3 : 1, Math.round(r.value / top * H)), borderRadius: 3, backgroundColor: r.value ? c.accent : c.border }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 2, marginTop: 4 }}>
        {rows.map((r, i) => <View key={r.key} style={{ flex: 1, alignItems: 'center' }}>{i % 3 === 0 ? <T small muted style={{ fontSize: 10, lineHeight: 12 }}>{r.label}</T> : null}</View>)}
      </View>
    </View>
  )
}

function Line({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  const c = useColors()
  return <Row><T style={{ flex: 1 }}>{label}</T><T bold style={{ fontVariant: ['tabular-nums'], ...(bad ? { color: c.danger } : null) }}>{value}</T></Row>
}

function Days({ title, rows }: { title: string; rows: Count[] }) {
  return (
    <View style={{ gap: 2 }}>
      <T bold>{title}</T>
      {rows.length ? rows.map(r => <Row key={r.key}><T small muted style={{ flex: 1 }}>{r.key}</T><T small style={{ fontVariant: ['tabular-nums'] }}>{r.n}</T></Row>) : <T small muted>None yet.</T>}
    </View>
  )
}
