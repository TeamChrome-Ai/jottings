/**
 * Settings → Offline (native only): what is on the phone. The Bible and the dictionary always are; each ministry author
 * is a choice, one row with Download / Downloading… / On this phone, and a sheet with the one action that fits.
 * offlineMinistry.ts does the work; on the web (offlineSupported false) the section renders nothing.
 */
import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { useFocusEffect } from 'expo-router'
import { enabledAuthors } from '@shared/ministry'
import { useEdition } from '../lib/edition'
import { authorShown } from '../lib/editionCore'
import { cancel, download, fetchListing, offlineSupported, peekListing, remove, status, storedAuthors, subscribe } from '../lib/offlineMinistry'
import { formatBytes, statusDetail, type OfflineStatus, type PackAuthor } from '../lib/offlineMinistryCore'
import { useToast } from '../store/toast'
import { Button, Card, H2, ListRow, Sheet, T } from './ui'

interface Row { id: string; name: string; latest: PackAuthor | null | undefined; status: OfflineStatus }

/** The bundled Concise Bible Dictionary: data/cbd (index + articles) as shipped in the app. */
const DICTIONARY_BYTES = 3.5 * 1024 * 1024

/** The rows, from the registry (names), the server's listing (sizes) and the phone (statuses); live to every change. */
function useOfflineRows(): Row[] {
  const [rows, setRows] = useState<Row[]>([])
  // the authors the edition shows (editionCore.ts); one it leaves out has no row, and a download of theirs stays unread
  const edition = useEdition()
  const refresh = useCallback(async () => {
    const listing = peekListing()
    const stored = await storedAuthors()
    const out: Row[] = []
    for (const a of enabledAuthors().filter(x => authorShown(x.id, edition))) {
      const latest = listing === undefined ? undefined : listing?.authors.find(x => x.id === a.id) ?? null
      out.push({ id: a.id, name: stored.find(s => s.author.id === a.id)?.author.name ?? latest?.name ?? a.name, latest, status: await status(a.id) })
    }
    setRows(out)
  }, [edition])
  useFocusEffect(useCallback(() => {
    let live = true
    const run = () => { if (live) void refresh() }
    run()
    // sizes come once per session; a first listing (or a failed one) redraws the rows
    void fetchListing().then(run)
    const off = subscribe(run)
    return () => { live = false; off() }
  }, [refresh]))
  return rows
}

export default function OfflineSection() {
  if (!offlineSupported) return null
  return <OfflineRows />
}

function OfflineRows() {
  const rows = useOfflineRows()
  const [open, setOpen] = useState<string | null>(null)
  const current = rows.find(r => r.id === open) ?? null
  return (
    <>
      <H2>Offline</H2>
      <Card style={{ gap: 0, paddingVertical: 8 }}>
        <ListRow icon="book" label="Bible" detail="On this phone" />
        <ListRow icon="dictionary" label="Dictionary" detail={`On this phone · ${formatBytes(DICTIONARY_BYTES)}`} />
        {rows.map(r => <ListRow key={r.id} icon="companion" label={`${r.name}’s ministry`} detail={statusDetail(r.status, r.latest)} onPress={() => setOpen(r.id)} />)}
      </Card>
      <AuthorSheet row={current} onClose={() => setOpen(null)} />
    </>
  )
}

/** Download, Cancel or Remove for one author, with what the download gives. */
function AuthorSheet({ row, onClose }: { row: Row | null; onClose: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  // the row keeps its last shape while the sheet slides away
  const [shown, setShown] = useState<Row | null>(row)
  useEffect(() => { if (row) setShown(row) }, [row])
  const r = row ?? shown
  if (!r) return <Sheet open={false} onClose={onClose}>{null}</Sheet>
  const refs = r.status.kind === 'stored' ? r.status.refs : r.latest?.refs ?? true
  const what = `${r.name}’s works read offline in the library${refs ? ', and Ministry on a verse works too' : ''}.`
  const start = async () => {
    onClose()
    try { if (await download(r.id)) toast.show(`${r.name}’s ministry is on this phone`) }
    catch (e) { toast.show(e instanceof Error ? e.message : 'The download did not finish') }
  }
  const drop = async () => {
    setBusy(true)
    try { await remove(r.id); toast.show(`${r.name}’s ministry removed`) } finally { setBusy(false); onClose() }
  }
  return (
    <Sheet open={!!row} onClose={onClose} title={`${r.name}’s ministry`}>
      <View style={{ padding: 16, gap: 12 }}>
        {r.status.kind === 'downloading' ? <>
          <T>Downloading… {Math.round(r.status.fraction * 100)}%</T>
          <T small muted>{what}</T>
          <Button title="Cancel" onPress={() => { cancel(r.id); onClose() }} style={{ alignSelf: 'flex-start' }} />
        </> : r.status.kind === 'stored' ? <>
          <T>On this phone · {formatBytes(r.status.bytes)}</T>
          <T small muted>{what}{r.status.stale ? ' The server has newer text; download again to update.' : ''}</T>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {r.status.stale && r.latest ? <Button title="Update" primary onPress={() => { void start() }} /> : null}
            <Button title="Remove" danger disabled={busy} onPress={() => { void drop() }} />
          </View>
        </> : <>
          <T>{r.latest ? `Download · ${formatBytes(r.latest.bytes)}, ${formatBytes(r.latest.rawBytes)} on the phone` : r.latest === null ? 'Needs a connection to download' : 'Download'}</T>
          <T small muted>{what} Off until you choose it; remove it here any time.</T>
          <Button title="Download" primary disabled={!r.latest} onPress={() => { void start() }} style={{ alignSelf: 'flex-start' }} />
        </>}
      </View>
    </Sheet>
  )
}
