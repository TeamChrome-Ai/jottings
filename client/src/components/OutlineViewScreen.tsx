import { shareText } from '../lib/share'
import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { forkOutline } from '../lib/library'
import type { ReportTarget } from '../lib/moderation'
import { copyText, fmtDateLong, isLocalOutline, loadErrorText, shareUrl, siteOrigin, useOutlineLoad, useVerseTexts, verseKeys, visibilityLabel } from '../lib/outlines'
import { useAuth } from '../store/auth'
import { useToast } from '../store/toast'
import { useColors } from '../hooks/useTheme'
import { Button, Card, Enter, ErrorText, H, Row, Screen, Spinner, T } from './ui'
import OutlineBody from './OutlineBody'
import OutlinePrintSheet from './OutlinePrintSheet'
import ReportSheet from './ReportSheet'
import { Tag } from './CommunityBits'
import Avatar from './Avatar'
import { NOUN } from '@shared/brand'
import { t, tc } from '@shared/i18n'
import { tr } from '../i18n'

/** `hidden: 1` rides on the author's own copy while a report is open (docs/API.md, Moderation); shared/types has no field for it. */
const underReview = (o: object): boolean => 'hidden' in o && (o.hidden === 1 || o.hidden === true)

/** Read-only outline, by id (`/outlines/:id`) or by share code (`/o/:code`). */
export default function OutlineViewScreen({ id, code }: { id?: string; code?: string }) {
  const { user, ready } = useAuth()
  const router = useRouter()
  const c = useColors()
  const toast = useToast()
  // a 403 for a signed-out visitor turns into a load once they sign in and come back
  const [reload, setReload] = useState(0)
  const prevUser = useRef<number | null | undefined>(undefined)
  useEffect(() => {
    if (prevUser.current !== undefined && prevUser.current !== (user?.id ?? null)) setReload(k => k + 1)
    prevUser.current = user?.id ?? null
  }, [user])
  const load = useOutlineLoad({ id, code }, reload, ready)

  const items = load.kind === 'ok' ? load.outline.items ?? [] : []
  const keys = useMemo(() => verseKeys(items), [items])
  const texts = useVerseTexts(keys)
  const [printOpen, setPrintOpen] = useState(false)
  const [forking, setForking] = useState(false)
  const [err, setErr] = useState('')
  const [report, setReport] = useState<ReportTarget | null>(null)

  const title = load.kind === 'ok' ? load.outline.title : NOUN.One
  if (load.kind === 'loading') return <Screen><Stack.Screen options={{ title }} /><Spinner /></Screen>
  if (load.kind === 'error') return (
    <Screen>
      <Stack.Screen options={{ title }} />
      <Card>
        <ErrorText>{loadErrorText(load)}</ErrorText>
        {load.status === 403 && !user ? <T small muted>{t('Sign in if this {one} is yours.', { one: NOUN.one })}</T> : null}
        <Row>
          {load.status === 403 && !user ? <Button primary small title={t('Sign in')} onPress={() => router.push('/login')} /> : null}
          <Button small title={t('Back to {many}', { many: NOUN.many })} onPress={() => router.replace('/outlines')} />
        </Row>
      </Card>
    </Screen>
  )

  const o = load.outline
  const local = isLocalOutline(o)
  const owner = local || (!!user && user.id === o.user_id)
  const link = shareUrl(o) ?? (code ? `${siteOrigin()}/o/${code}` : `${siteOrigin()}/outlines/${o.id}`)

  // signed out, the copy lands on this device
  const fork = async () => {
    setForking(true); setErr('')
    try {
      const f = await forkOutline(o)
      router.push({ pathname: '/outlines/[id]/edit', params: { id: String(f.id) } })
    } catch (e) { setErr(e instanceof Error ? e.message : t('Could not make a copy')) } finally { setForking(false) }
  }
  const share = async () => {
    const r = await shareText({ title: o.title, message: o.title, url: link })
    if (r === 'copied') toast.show(t('Link copied')); else if (r === 'failed' && await copyText(link)) toast.show(t('Link copied'))
  }

  // one entrance: the title block rises, then the first items follow it in turn
  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title }} />
      <Enter style={{ gap: 12 }}>
        <Row>
          {owner ? <Button primary small title={t('Edit')} onPress={() => router.push({ pathname: '/outlines/[id]/edit', params: { id: String(o.id) } })} /> : null}
          {!owner ? <Button small title={forking ? t('Copying…') : t('Make a copy')} disabled={forking} onPress={() => { void fork() }} /> : null}
          <Button small title={t('Print / PDF')} onPress={() => setPrintOpen(true)} />
          {!local ? <Button small title={t('Share link')} onPress={() => { void share() }} /> : null}
          {!owner && user ? <Button small title={tc('verb', 'Report')} onPress={() => setReport({ kind: 'outline', id: o.id, label: NOUN.one })} /> : null}
        </Row>
        {owner && underReview(o) ? <Row><Tag label={t('Under review')} /><T small muted>{t('A report on this {one} is being looked at; only you can see it meanwhile.', { one: NOUN.one })}</T></Row> : null}
        {err ? <ErrorText>{err}</ErrorText> : null}

        <View style={{ gap: 4 }}>
          <H>{o.title}</H>
          {o.visibility === 'public' && o.owner_handle ? (
            <Row style={{ flexWrap: 'nowrap', gap: 10, marginVertical: 4 }}>
              <Avatar name={o.owner_display_name ?? o.owner_handle} avatar={o.owner_avatar} size={32} />
              <T small style={{ flex: 1 }}>{tr('by <b>{name}</b> <muted>@{handle}</muted>', { b: s => <T small bold>{s}</T>, muted: s => <T small muted>{s}</T> }, { name: o.owner_display_name ?? o.owner_handle, handle: o.owner_handle })}</T>
            </Row>
          ) : null}
          <Row>
            {o.owner_handle && o.visibility !== 'public' ? <T small muted>@{o.owner_handle}</T> : null}
            <T small muted>{o.owner_handle && o.visibility !== 'public' ? '· ' : ''}{t('Updated {date}', { date: fmtDateLong(o.updated_at) })}</T>
            {o.visibility !== 'private' ? <T small style={{ color: c.accent }}>· {visibilityLabel(o.visibility)}</T> : null}
            {local ? <T small muted>· {t('On this device')}</T> : null}
          </Row>
          {o.description ? <T muted style={{ marginTop: 4 }}>{o.description}</T> : null}
        </View>
      </Enter>

      {texts.error ? <ErrorText>{texts.error}</ErrorText> : null}
      {items.length === 0
        ? <T muted>{owner ? t('This {one} is empty. Edit it to add passages and notes.', { one: NOUN.one }) : t('This {one} is empty.', { one: NOUN.one })}</T>
        : <OutlineBody items={items} style={o.print_style} verses={texts.verses} loading={texts.loading} revealAfter={140} />}
      <View style={{ height: 24 }} />
      <OutlinePrintSheet open={printOpen} onClose={() => setPrintOpen(false)} outline={o} verses={texts.verses} loading={texts.loading} />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </Screen>
  )
}
