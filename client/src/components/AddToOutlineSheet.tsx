import { useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import type { Outline } from '@shared/types'
import { createOutline, listOutlines } from '../lib/library'
import { addVersesToOutline } from '../lib/outlines'
import { jottingTitle } from '../lib/jot'
import { Button, Chip, ErrorText, Input, Sheet, T } from './ui'
import { NOUN } from '@shared/brand'

/**
 * Jot: the selected verses into a jotting, with a note. The note field is ready to type when the sheet opens and the
 * new jotting's title is already the passage's reference, so one tap and a sentence make a jotting; the note may stay
 * empty (the passage alone) and the title may be changed.
 *
 * Where it goes is a row of choices right under the note: a new jotting, or one of the reader's own, most recent
 * first. They were a list at the foot of the sheet, which the keyboard (open from the start, for the note) covered
 * on a phone, so nobody found them.
 */
const short = (t: string) => (t.length > 30 ? `${t.slice(0, 29).trimEnd()}…` : t)

export default function AddToOutlineSheet({ open, book, chapter, verses, onDone }: { open: boolean; book: number; chapter: number; verses: number[]; onDone: (o: Outline | null) => void }) {
  const [list, setList] = useState<Outline[]>([])
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  /** A jotting of the reader's own to add to, or null for a new one. */
  const [target, setTarget] = useState<Outline | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // a fresh sheet each time it opens: the reference as the title, an empty note
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setTitle(jottingTitle(book, chapter, verses)); setNote(''); setErr(''); setTarget(null); listOutlines().then(setList).catch(() => setList([])) } }, [open])
  const add = async (o: Outline) => {
    setBusy(true); setErr('')
    try { onDone(await addVersesToOutline(o.id, book, chapter, verses, note)) } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const create = async () => {
    if (!title.trim()) return
    setBusy(true); setErr('')
    try { await add(await createOutline({ title: title.trim() })) } catch (e) { setErr((e as Error).message); setBusy(false) }
  }
  return (
    <Sheet open={open} onClose={() => onDone(null)} title={NOUN.verb}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
        <Input placeholder="What strikes you about these verses?" accessibilityLabel="Note" value={note} onChangeText={setNote} multiline autoFocus
          style={{ minHeight: 96, textAlignVertical: 'top' }} />
        {list.length > 0 ? (
          <View style={{ gap: 6 }}>
            <T small muted>Add to</T>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
              <Chip tab label={`New ${NOUN.one}`} on={target === null} onPress={() => setTarget(null)} />
              {list.map(o => <Chip key={o.id} tab label={short(o.title)} accessibilityLabel={o.title} on={target?.id === o.id} onPress={() => setTarget(o)} />)}
            </ScrollView>
          </View>
        ) : null}
        {/* the button drops under the field when both do not fit (a small phone, large system text) */}
        {target ? (
          <View style={{ flexDirection: 'row' }}><Button primary title={`Add to “${short(target.title)}”`} accessibilityLabel={`Add to ${target.title}`} disabled={busy} onPress={() => { void add(target) }} style={{ maxWidth: '100%' }} /></View>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Input placeholder={`New ${NOUN.one} title`} value={title} onChangeText={setTitle} style={{ flexGrow: 1, flexBasis: 180 }} />
            <Button primary title="Create & add" disabled={busy || !title.trim()} onPress={create} />
          </View>
        )}
        {err ? <ErrorText>{err}</ErrorText> : null}
      </ScrollView>
    </Sheet>
  )
}
