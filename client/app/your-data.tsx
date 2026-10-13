import { useState } from 'react'
import { Platform, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useAuth } from '../src/store/auth'
import { useToast } from '../src/store/toast'
import { confirmAsync, errMsg } from '../src/lib/community'
import { DATA_CATEGORIES, deleteMyData, summarizeDeleted, type DataCategory } from '../src/lib/yourdata'
import { applyBackup, canSaveToFolder, describeRestore, pickBackupText, saveBackup, saveBackupToFolder } from '../src/lib/backup'
import { DARBY_APP_NOTES_TITLE, describeCounts, isEmptyBackup, parseBackup } from '../src/lib/backupFile'
import { usePrefsStore } from '../src/store/prefs'
import { Button, Card, Enter, ErrorText, H, H2, Row, Screen, Spinner, SwitchRow, T } from '../src/components/ui'
import SignInCard from '../src/components/SignInCard'
import { NOUN } from '@shared/brand'

type Busy = { kind: 'idle' } | { kind: 'deleting' }

export default function YourData() {
  const { user, ready } = useAuth()
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Your data' }} />
      <H>Your data</H>
      {!ready ? <Spinner /> : (
        <>
          <Backup user={user} />
          {user ? <SignedIn /> : <SignInCard text={`Nothing about you is kept on our server until you sign in: your bookmarks, highlights and ${NOUN.many} are on this device. With an account they follow you to any device, and this page also deletes what the server holds.`} />}
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
  const where = user ? 'your account' : 'this device'

  const save = async () => {
    setSaveErr(null); setBusy('Preparing your backup…')
    try {
      const r = await saveBackup(!!user, prefs.get())
      toast.show(r === 'downloaded' ? 'Backup downloaded' : 'Backup ready to save or share')
    } catch (e) {
      const m = errMsg(e); setSaveErr(m); toast.show(m)
    } finally { setBusy(null) }
  }

  const saveToFolder = async () => {
    setSaveErr(null); setBusy('Preparing your backup…')
    try {
      const name = await saveBackupToFolder(!!user, prefs.get())
      if (name) toast.show(`Saved as ${name}`, 5000)
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
      if (isEmptyBackup(parsed)) { setRestoreErr(parsed.skipped ? 'Nothing in this file could be read.' : 'This backup is empty.'); return }
      const old = parsed.kind === 'darby-app'
      const c = parsed.content
      const notes = old ? (c.jottings[0]?.items.length ?? 0) / 2 : 0
      const holds = old
        ? [describeCounts({ bookmarks: c.bookmarks.length, highlights: c.highlights.length, jottings: 0 }), notes ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : ''].filter(Boolean).join(', ')
        : [describeCounts({ bookmarks: c.bookmarks.length, highlights: c.highlights.length, jottings: c.jottings.length }), c.position || c.prefs ? 'your place and reading settings' : '', parsed.history ? 'your streak and reading history' : ''].filter(Boolean).join(', ')
      const body = `${old ? 'This Darby Bible app backup' : 'This backup'} holds ${holds}.\n\nIt is added to ${where}. Nothing already here is removed or replaced.${notes ? `\n\nThe notes arrive together as one ${NOUN.one}, “${DARBY_APP_NOTES_TITLE}”.` : ''}`
      if (!(await confirmAsync(old ? 'Import this backup?' : 'Restore this backup?', body, old ? 'Import' : 'Restore'))) return
      setBusy('Restoring…')
      const r = await applyBackup(parsed, user, prefs, setBusy)
      const summary = describeRestore(r, parsed.skipped, describeCounts)
      setDone(summary); toast.show(summary, 6000)
    } catch (e) {
      const m = errMsg(e); setRestoreErr(m); toast.show(m)
    } finally { setBusy(null) }
  }

  return (
    <>
      <H2>Back up</H2>
      <Card>
        {user ? (
          <T>Save everything the server holds about you as one file: your profile and settings, reading activity and chapter credits, bookmarks, highlights, where you left off, your {NOUN.many} with their items, group memberships and posts, reports you filed, your block list, and your friends, invites, reactions and contact fingerprints.</T>
        ) : (
          <T>Save what is on this device as one file: your bookmarks, highlights, {NOUN.many}, where you left off and your reading settings. Keep it somewhere safe; on a new phone, restore it below.</T>
        )}
        <T small muted>{Platform.OS === 'web' ? 'The file downloads in your browser.' : canSaveToFolder ? 'Save a backup file offers it to Drive, email or another app; Save to this phone writes it into a folder you choose.' : 'The file is offered to the share sheet, so you can save it to Files or Drive, or send it to yourself.'}</T>
        {busy === 'Preparing your backup…' ? <Spinner label={busy} /> : (
          <Row style={{ flexWrap: 'wrap' }}>
            <Button primary title="Save a backup file" disabled={busy !== null} onPress={() => { void save() }} />
            {canSaveToFolder ? <Button title="Save to this phone" disabled={busy !== null} onPress={() => { void saveToFolder() }} /> : null}
          </Row>
        )}
        {saveErr && <Enter><ErrorText>{saveErr}</ErrorText></Enter>}
      </Card>

      <H2>Restore or import</H2>
      <Card>
        <T>Choose a backup file to put its bookmarks, highlights and {NOUN.many} back {user ? 'into your account' : 'on this device'}. Nothing already here is removed, and a file restored twice adds nothing the second time.</T>
        <T small muted>From the Darby Bible app (by Bible apps for spirit): in that app open Settings, then Backup (Import/Export), and tap Export. Choose the file it saves (its name ends in .setting) here: its bookmarks, highlights and notes come over.</T>
        {user ? null : <T small muted>A streak and reading history belong to an account: sign in first to restore those.</T>}
        {busy !== null && busy !== 'Preparing your backup…' ? <Spinner label={busy} /> : (
          <Row><Button title="Choose a backup file" disabled={busy !== null} onPress={() => { void restore() }} /></Row>
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
    const list = chosen.map(c => `• ${c.label}: ${c.hint.toLowerCase()}`).join('\n')
    const ok = await confirmAsync('Delete selected data?', `This permanently deletes:\n${list}\n\nThere is no undo. Your account stays.`, 'Delete')
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
      <H2>Delete some of your data</H2>
      <Card style={{ gap: 0 }}>
        <T small muted style={{ paddingBottom: 4 }}>Pick what to remove. Deletion is immediate and permanent; your account and anything not selected stay.</T>
        {DATA_CATEGORIES.map(c => (
          <SwitchRow key={c.id} label={c.label} hint={c.hint} value={selected.has(c.id)} onChange={on => toggle(c.id, on)} />
        ))}
        <View style={{ gap: 8, paddingTop: 8 }}>
          <T small muted>{chosen.length === 0 ? 'No categories selected' : chosen.length === 1 ? '1 category selected' : `${chosen.length} categories selected`}</T>
          {busy.kind === 'deleting' ? <Spinner label="Deleting…" /> : (
            <Row><Button danger title="Delete selected" disabled={!idle || chosen.length === 0} onPress={() => { void deleteSelected() }} /></Row>
          )}
          {lastDeleted && <Enter><T small>{lastDeleted}</T></Enter>}
          {deleteErr && <Enter><ErrorText>{deleteErr}</ErrorText></Enter>}
        </View>
      </Card>

      <H2>What we keep</H2>
      <Card>
        <T small muted>The Bible text is not personal data and is not tied to you. Preferences and offline chapters live only on this device and are removed when you uninstall the app. Data on the server is encrypted at rest and in transit.</T>
        <T small muted>To remove everything, including the account itself, use Delete account in Settings.</T>
        <Row><Button small title="Open Settings" onPress={() => router.push('/settings')} /></Row>
      </Card>
    </>
  )
}
