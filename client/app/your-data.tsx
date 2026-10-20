import { useState } from 'react'
import { Platform, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useAuth } from '../src/store/auth'
import { useToast } from '../src/store/toast'
import { confirmAsync, errMsg } from '../src/lib/community'
import { DATA_CATEGORIES, deleteMyData, summarizeDeleted, type DataCategory } from '../src/lib/yourdata'
import { applyBackup, canSaveToFolder, describeRestore, pickBackupText, saveBackup, saveBackupToFolder } from '../src/lib/backup'
import { DARBY_APP_NOTES_TITLE, describeCounts, isEmptyBackup, parseBackup } from '../src/lib/backupFile'
import { describeMarks, readBackupMarks } from '../src/lib/backupMarks'
import { usePrefsStore } from '../src/store/prefs'
import { Button, Card, Enter, ErrorText, H, H2, Row, Screen, Spinner, SwitchRow, T } from '../src/components/ui'
import SignInCard from '../src/components/SignInCard'
import { NOUN } from '@shared/brand'
import { t, tn } from '@shared/i18n'

type Busy = { kind: 'idle' } | { kind: 'deleting' }

export default function YourData() {
  const { user, ready } = useAuth()
  return (
    <Screen>
      <Stack.Screen options={{ title: t('Your data') }} />
      <H>{t('Your data')}</H>
      {!ready ? <Spinner /> : (
        <>
          <Backup user={user} />
          {user ? <SignedIn /> : <SignInCard text={t('Nothing about you is kept on our server until you sign in: your bookmarks, highlights and {many} are on this device. With an account they follow you to any device, and this page also deletes what the server holds.', { many: NOUN.many })} />}
        </>
      )}
    </Screen>
  )
}

/**
 * Back up to a file and restore from one (docs/BACKUP.md), signed in or not. Signed in, the file is the whole account
 * export, so it is also the "download what is kept about me" of the privacy policy. One dialog reads both kinds of
 * file: the app's own backup and the old Darby Bible app's own `.setting` backup.
 */
function Backup({ user }: { user: { id: number } | null }) {
  const toast = useToast()
  const prefs = usePrefsStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [restoreErr, setRestoreErr] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // the label is also the state's sentinel: compared in the same language it was set in
  const preparing = t('Preparing your backup…')

  const save = async () => {
    setSaveErr(null); setBusy(preparing)
    try {
      const r = await saveBackup(!!user, prefs.get())
      toast.show(r === 'downloaded' ? t('Backup downloaded') : t('Backup ready to save or share'))
    } catch (e) {
      const m = errMsg(e); setSaveErr(m); toast.show(m)
    } finally { setBusy(null) }
  }

  const saveToFolder = async () => {
    setSaveErr(null); setBusy(preparing)
    try {
      const name = await saveBackupToFolder(!!user, prefs.get())
      if (name) toast.show(t('Saved as {name}', { name }), 5000)
    } catch (e) {
      const m = errMsg(e); setSaveErr(m); toast.show(m)
    } finally { setBusy(null) }
  }

  const restore = async () => {
    setRestoreErr(null); setDone(null)
    try {
      const text = await pickBackupText()
      if (text === null) return
      const parsed = parseBackup(text)
      // the chapters marked as read by hand, which the parsed backup does not carry (lib/backupMarks.ts)
      const marks = parsed.kind === 'jottings' ? readBackupMarks(text, new Date().toISOString()) : []
      if (isEmptyBackup(parsed) && !marks.length) { setRestoreErr(parsed.skipped ? t('Nothing in this file could be read.') : t('This backup is empty.')); return }
      const old = parsed.kind === 'darby-app'
      const c = parsed.content
      const notes = old ? (c.jottings[0]?.items.length ?? 0) / 2 : 0
      const holds = old
        ? [describeCounts({ bookmarks: c.bookmarks.length, highlights: c.highlights.length, jottings: 0 }), notes ? tn(notes, '{n} note', '{n} notes') : ''].filter(Boolean).join(', ')
        : [describeCounts({ bookmarks: c.bookmarks.length, highlights: c.highlights.length, jottings: c.jottings.length }), describeMarks(marks.length), c.position || c.prefs ? t('your place and reading settings') : '', parsed.history ? t('your streak and reading history') : ''].filter(Boolean).join(', ')
      const holdsLine = old ? t('This Darby Bible app backup holds {holds}.', { holds }) : t('This backup holds {holds}.', { holds })
      const added = user ? t('It is added to your account. Nothing already here is removed or replaced.') : t('It is added to this device. Nothing already here is removed or replaced.')
      const body = `${holdsLine}\n\n${added}${notes ? `\n\n${t('The notes arrive together as one {one}, “{title}”.', { one: NOUN.one, title: DARBY_APP_NOTES_TITLE })}` : ''}`
      if (!(await confirmAsync(old ? t('Import this backup?') : t('Restore this backup?'), body, old ? t('Import') : t('Restore')))) return
      setBusy(t('Restoring…'))
      const r = await applyBackup(parsed, user, prefs, setBusy, marks)
      const summary = describeRestore(r, parsed.skipped, describeCounts)
      setDone(summary); toast.show(summary, 6000)
    } catch (e) {
      const m = errMsg(e); setRestoreErr(m); toast.show(m)
    } finally { setBusy(null) }
  }

  return (
    <>
      <H2>{t('Back up')}</H2>
      <Card>
        {user ? (
          <T>{t('Save everything the server holds about you as one file: your profile and settings, reading activity and chapter credits, the chapters you marked as read, bookmarks, highlights, where you left off, your {many} with their items, group memberships and posts, reports you filed, your block list, and your friends, invites, reactions and contact fingerprints.', { many: NOUN.many })}</T>
        ) : (
          <T>{t('Save what is on this device as one file: your bookmarks, highlights, {many}, the chapters you marked as read, where you left off and your reading settings. Keep it somewhere safe; on a new phone, restore it below.', { many: NOUN.many })}</T>
        )}
        <T small muted>{Platform.OS === 'web' ? t('The file downloads in your browser.') : canSaveToFolder ? t('Save a backup file offers it to Drive, email or another app; Save to this phone writes it into a folder you choose.') : t('The file is offered to the share sheet, so you can save it to Files or Drive, or send it to yourself.')}</T>
        {busy === preparing ? <Spinner label={busy} /> : (
          <Row style={{ flexWrap: 'wrap' }}>
            <Button primary title={t('Save a backup file')} disabled={busy !== null} onPress={() => { void save() }} />
            {canSaveToFolder ? <Button title={t('Save to this phone')} disabled={busy !== null} onPress={() => { void saveToFolder() }} /> : null}
          </Row>
        )}
        {saveErr && <Enter><ErrorText>{saveErr}</ErrorText></Enter>}
      </Card>

      <H2>{t('Restore or import')}</H2>
      <Card>
        <T>{user
          ? t('Choose a backup file to put its bookmarks, highlights and {many} back into your account. Nothing already here is removed, and a file restored twice adds nothing the second time.', { many: NOUN.many })
          : t('Choose a backup file to put its bookmarks, highlights and {many} back on this device. Nothing already here is removed, and a file restored twice adds nothing the second time.', { many: NOUN.many })}</T>
        <T small muted>{t('From the Darby Bible app (by Bible apps for spirit): in that app open Settings, then Backup (Import/Export), and tap Export. Choose the file it saves (its name ends in .setting) here: its bookmarks, highlights and notes come over.')}</T>
        {user ? null : <T small muted>{t('A streak and reading history belong to an account: sign in first to restore those.')}</T>}
        {busy !== null && busy !== preparing ? <Spinner label={busy} /> : (
          <Row><Button title={t('Choose a backup file')} disabled={busy !== null} onPress={() => { void restore() }} /></Row>
        )}
        {done && <Enter><T small>{done}</T></Enter>}
        {restoreErr && <Enter><ErrorText>{restoreErr}</ErrorText></Enter>}
      </Card>
    </>
  )
}

function SignedIn() {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState<Busy>({ kind: 'idle' })
  const [selected, setSelected] = useState<ReadonlySet<DataCategory>>(new Set())
  const [deleteErr, setDeleteErr] = useState<string | null>(null)
  const [lastDeleted, setLastDeleted] = useState<string | null>(null)

  const toggle = (id: DataCategory, on: boolean) => setSelected(s => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  const chosen = DATA_CATEGORIES.filter(c => selected.has(c.id))

  const deleteSelected = async () => {
    if (chosen.length === 0) return
    const list = chosen.map(c => `• ${t(c.label)}: ${t(c.hint).toLowerCase()}`).join('\n')
    const ok = await confirmAsync(t('Delete selected data?'), t('This permanently deletes:\n{list}\n\nThere is no undo. Your account stays.', { list }), t('Delete'))
    if (!ok) return
    setDeleteErr(null); setLastDeleted(null); setBusy({ kind: 'deleting' })
    try {
      const counts = await deleteMyData(chosen.map(c => c.id))
      const summary = summarizeDeleted(counts)
      setLastDeleted(summary); setSelected(new Set()); toast.show(summary, 5000)
    } catch (e) {
      const m = errMsg(e); setDeleteErr(m); toast.show(m)
    } finally { setBusy({ kind: 'idle' }) }
  }

  const idle = busy.kind === 'idle'
  return (
    <>
      <H2>{t('Delete some of your data')}</H2>
      <Card style={{ gap: 0 }}>
        <T small muted style={{ paddingBottom: 4 }}>{t('Pick what to remove. Deletion is immediate and permanent; your account and anything not selected stay.')}</T>
        {DATA_CATEGORIES.map(c => (
          <SwitchRow key={c.id} label={t(c.label)} hint={t(c.hint)} value={selected.has(c.id)} onChange={on => toggle(c.id, on)} />
        ))}
        <View style={{ gap: 8, paddingTop: 8 }}>
          <T small muted>{chosen.length === 0 ? t('No categories selected') : tn(chosen.length, '{n} category selected', '{n} categories selected')}</T>
          {busy.kind === 'deleting' ? <Spinner label={t('Deleting…')} /> : (
            <Row><Button danger title={t('Delete selected')} disabled={!idle || chosen.length === 0} onPress={() => { void deleteSelected() }} /></Row>
          )}
          {lastDeleted && <Enter><T small>{lastDeleted}</T></Enter>}
          {deleteErr && <Enter><ErrorText>{deleteErr}</ErrorText></Enter>}
        </View>
      </Card>

      <H2>{t('What we keep')}</H2>
      <Card>
        <T small muted>{t('The Bible text is not personal data and is not tied to you. Preferences and offline chapters live only on this device and are removed when you uninstall the app. Data on the server is encrypted at rest and in transit.')}</T>
        <T small muted>{t('To remove everything, including the account itself, use Delete account in Settings.')}</T>
        <Row><Button small title={t('Open Settings')} onPress={() => router.push('/settings')} /></Row>
      </Card>
    </>
  )
}
