import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Platform, Pressable, StyleSheet, View, type TextInputProps } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import type { Outline, OutlineItem, OutlineItemKind } from '@shared/types'
import { formatRef, parseRef, refKey } from '@shared/ref'
import { currentOutlineId, deleteOutline, isLocalId } from '../../../src/lib/library'
import { editorOpened, outlineOpening, savesPending, savesSettled, writesOn } from '../../../src/lib/outlineEditors'
import { DEFAULT_TIMEOUT_MS } from '../../../src/lib/api'
import { OutlineSaver, metaOf, type Meta, type SaveState } from '../../../src/lib/outlineSaver'
import {
  AUTOSAVE_MS, MAX_DEPTH, PRINT_STYLES, VISIBILITIES, confirmAsync, copyText, fetchVerseRows, itemRef, loadErrorText, noteRefs, openRef, shareUrl,
  useOutlineLoad, useVerseTexts, verseKeys, type VerseRow,
} from '../../../src/lib/outlines'
import { useAuth } from '../../../src/store/auth'
import { useColors } from '../../../src/hooks/useTheme'
import { Button, Card, Enter, ErrorText, H2, Input, Row, Screen, Segmented, Spinner, T, useKeyboardReveal } from '../../../src/components/ui'
import { MotionItem, useArrivals, useReduceMotion, type Nudge } from '../../../src/components/motion/community'
import { useSettled } from '../../../src/components/motion/nav'
import OutlineVerseText from '../../../src/components/OutlineVerseText'
import OutlinePrintSheet from '../../../src/components/OutlinePrintSheet'
import { offerTourControls, tourRef } from '../../../src/store/tour'
import { NOUN } from '@shared/brand'
import { t, tc } from '@shared/i18n'

/** Gap between item cards; also the extra distance a swapped card travels. */
const GAP = 12

/** Owner-only editor; anyone else lands on the read-only view. An outline kept on this device is the reader's own. */
export default function OutlineEdit() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user, ready } = useAuth()
  const router = useRouter()
  const local = isLocalId(id ?? '')
  // loaded again when the editor cannot know how its outline stands (a write from elsewhere that was never read back)
  const [again, setAgain] = useState(0)
  // This screen's claim on the outline begins here, before the wait and before the read below (this effect runs
  // before theirs), and ends when the screen goes, or when its load has failed and it will mount no editor: from
  // the first, an outline of this device is not moved to the account from under it (lib/outlineEditors.ts)
  const [failed, setFailed] = useState(false)
  useEffect(() => (failed ? undefined : outlineOpening(Number(id))), [id, failed])
  // a save of this one still on its way from an editor of this app (the one just left, closing) lands before it is
  // loaded, so the editor opens on the words just typed and is not behind them; for no longer than a request is given
  // (by the id the outline has now: one asked for by this device's id may be the account's since)
  const nid = currentOutlineId(Number(id))
  const [waiting, setWaiting] = useState(() => savesPending(nid))
  useEffect(() => {
    if (!savesPending(nid)) { setWaiting(false); return }
    setWaiting(true)
    let live = true
    void savesSettled(nid, DEFAULT_TIMEOUT_MS).then(() => { if (live) setWaiting(false) })
    return () => { live = false }
  }, [nid, again])
  const enabled = ready && (!!user || local) && !waiting
  // the writes made to it from elsewhere in the app when this load began: one made while it was on its way may not be
  // in what it brings (lib/outlineEditors.ts)
  const since = useRef(0)
  useEffect(() => { since.current = writesOn(nid) }, [nid, again, enabled])
  const load = useOutlineLoad({ id }, again, enabled)
  useEffect(() => { if (load.kind === 'error') setFailed(true) }, [load.kind])
  const mine = load.kind === 'ok' && (isLocalId(load.outline.id) || (!!user && load.outline.user_id === user.id))

  useEffect(() => {
    if (load.kind === 'ok' && user && !mine) router.replace({ pathname: '/outlines/[id]', params: { id: String(load.outline.id) } })
  }, [load, user, mine, router])

  if (ready && !user && !local) return (
    <Screen>
      <Stack.Screen options={{ title: t('Edit {one}', { one: NOUN.one }) }} />
      <Card><T muted>{t('Sign in to edit this {one}.', { one: NOUN.one })}</T><Row><Button primary small title={t('Sign in')} onPress={() => router.push('/login')} /><Button small title={t('View instead')} onPress={() => router.replace({ pathname: '/outlines/[id]', params: { id: String(id) } })} /></Row></Card>
    </Screen>
  )
  if (load.kind === 'loading') return <Screen><Stack.Screen options={{ title: t('Edit {one}', { one: NOUN.one }) }} /><Spinner /></Screen>
  if (load.kind === 'error') return (
    <Screen>
      <Stack.Screen options={{ title: t('Edit {one}', { one: NOUN.one }) }} />
      <Card><ErrorText>{loadErrorText(load)}</ErrorText><Row><Button small title={t('Back to {many}', { many: NOUN.many })} onPress={() => router.replace('/outlines')} /></Row></Card>
    </Screen>
  )
  if (!mine) return <Screen><Stack.Screen options={{ title: t('Edit {one}', { one: NOUN.one }) }} /><Spinner /></Screen>
  return <Editor key={load.outline.id} initial={load.outline} since={since.current} signedIn={!!user} reload={() => setAgain(n => n + 1)} />
}

function Editor({ initial, since, signedIn, reload }: { initial: Outline; since: number; signedIn: boolean; reload: () => void }) {
  const router = useRouter()
  /** The outline as it was loaded, or as a write from elsewhere in the app last left it. */
  const [whole, setWhole] = useState(initial)
  const [meta, setMeta] = useState<Meta>(metaOf(initial))
  const [items, setItems] = useState<OutlineItem[]>(initial.items ?? [])
  const [save, setSave] = useState<SaveState>('saved')
  /** A write from elsewhere in the app (Ask) has hold of this outline: for that moment nothing here takes input. */
  const [held, setHeld] = useState(false)
  /** A save was refused because this one was changed somewhere else: the editor is behind, and takes no input either. */
  const [changed, setChanged] = useState(false)
  const locked = held || changed
  const [copied, setCopied] = useState(false)
  const [printOpen, setPrintOpen] = useState(false)
  const tempId = useRef(-1)
  // ---- motion: swapped cards slide from their old slot, deleted cards collapse first, new cards open in ----
  const heights = useRef(new Map<number, number>())
  const nudgeSeq = useRef(0)
  const [nudges, setNudges] = useState<ReadonlyMap<number, Nudge>>(new Map())
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set())
  const [focusId, setFocusId] = useState<number | null>(null)
  const arrivals = useArrivals(items.map(it => it.id))

  // ---- autosave (lib/outlineSaver.ts): the whole item list is PUT, metadata is PATCHed; both debounced, both flushed on
  // unmount. A write from elsewhere in the app (Ask) takes hold of this editor for the moment it takes
  // (lib/outlineEditors.ts): nothing here takes input, what is held is saved first, and when the write has been read
  // back the editor shows it whole. So nothing is typed into lines that are being written, and neither is written
  // over the other. And every save names the stamp this editor last saw: one the server refuses, because the outline
  // was changed somewhere else, stops the editor, with what was typed left in sight and the outline to load again
  const leavingNow = useRef(leaving)
  leavingNow.current = leaving
  const saverRef = useRef<OutlineSaver | null>(null)
  saverRef.current ??= new OutlineSaver(initial.id, items, meta, initial.updated_at, {
    state: setSave,
    held: setHeld,
    stale: reload,
    changed: () => setChanged(true),
    // a line on its way out is out now: it is saved before the write, and not brought back by it
    holding: () => {
      const out = leavingNow.current, s = saverRef.current
      if (!s || out.size === 0) return
      const next = s.latest.items.filter(it => !out.has(it.id))
      s.latest.items = next
      setItems(next)
      setLeaving(new Set())
      s.touch('items')
    },
    took: o => {
      setWhole(o)
      setItems(o.items ?? [])
      setMeta(metaOf(o))
      setLeaving(new Set())
      setNudges(new Map())
      heights.current.clear()
    },
  }, AUTOSAVE_MS)
  const saver = saverRef.current
  const latest = saver.latest
  latest.items = items
  latest.meta = meta

  useEffect(() => {
    const before = () => saver.unload()
    if (Platform.OS === 'web') window.addEventListener('beforeunload', before)
    const gone = editorOpened(initial.id, saver, since)
    return () => {
      if (Platform.OS === 'web') window.removeEventListener('beforeunload', before)
      // its last save is asked for before it is counted gone: an outline with a save on its way is not free
      saver.close()
      gone()
    }
  }, [initial.id, saver, since])

  const changeItems = (fn: (prev: OutlineItem[]) => OutlineItem[]) => {
    if (saver.locked) return
    setItems(prev => { const next = fn(prev); latest.items = next; return next })
    saver.touch('items')
  }
  const changeMeta = (patch: Partial<Meta>) => {
    if (saver.locked) return
    setMeta(prev => { const next = { ...prev, ...patch }; latest.meta = next; return next })
    saver.touch('meta')
  }

  // ---- item operations (index based) ----
  const update = (idx: number, patch: Partial<OutlineItem>) => changeItems(p => p.map((it, i) => i === idx ? { ...it, ...patch } : it))
  const remove = (idx: number) => { const it = items[idx]; if (it && !saver.locked) setLeaving(s => new Set(s).add(it.id)) }
  const gone = (id: number) => {
    changeItems(p => p.filter(it => it.id !== id))
    setLeaving(s => { const n = new Set(s); n.delete(id); return n })
    heights.current.delete(id)
  }
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || saver.locked) return
    const a = items[from], b = items[to]
    if (a && b && Math.abs(to - from) === 1) {
      const dir = to - from, seq = ++nudgeSeq.current
      const ha = heights.current.get(a.id) ?? 0, hb = heights.current.get(b.id) ?? 0
      setNudges(new Map([[a.id, { from: -dir * (hb + GAP), seq, lift: true }], [b.id, { from: dir * (ha + GAP), seq }]]))
    }
    changeItems(p => {
      if (from >= p.length || to >= p.length) return p
      const next = [...p]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }
  const indent = (idx: number, delta: 1 | -1) => changeItems(p => p.map((it, i) => i === idx ? { ...it, depth: Math.max(0, Math.min(MAX_DEPTH, it.depth + delta)) } : it))
  const add = (partial: Pick<OutlineItem, 'kind'> & Partial<OutlineItem>) => {
    if (saver.locked) return
    const last = latest.items[latest.items.length - 1]
    const item: OutlineItem = {
      id: tempId.current--, outline_id: initial.id, position: latest.items.length, depth: last?.depth ?? 0,
      book: null, chapter: null, v1: null, v2: null, text: null, url: null, ...partial,
    }
    arrivals.expect(item.id)
    if (item.kind !== 'verse') setFocusId(item.id)
    changeItems(p => [...p, item])
  }

  const keys = useMemo(() => verseKeys(items), [items])
  const texts = useVerseTexts(keys)

  const onDevice = isLocalId(initial.id)
  const link = shareUrl({ share_code: whole.share_code, visibility: meta.visibility })
  const copyLink = async () => { if (link && await copyText(link)) { setCopied(true); setTimeout(() => setCopied(false), 1500) } }
  const destroy = async () => {
    if (saver.locked) return
    if (!await confirmAsync(t('Delete “{title}”?', { title: meta.title }), t('This cannot be undone.'))) return
    saver.discard()
    try { await deleteOutline(initial.id); router.replace('/outlines') } catch { setSave('error') }
  }
  const printable: Outline = { ...whole, ...meta, items }
  // the full tour opens the print sheet to show it
  useEffect(() => offerTourControls('editor', { print: setPrintOpen }), [])

  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: t('Edit {one}', { one: NOUN.one }) }} />
      <Enter style={{ gap: 12 }}>
        <Row>
          {changed ? null : held ? <T small muted>{t('Ask is writing here…')}</T> : <SaveBadge state={save} retry={() => { void saver.flush() }} />}
          <View style={{ flex: 1 }} />
          <Button small title={tc('verb', 'View')} onPress={() => router.push({ pathname: '/outlines/[id]', params: { id: String(initial.id) } })} />
          <Button small title={t('Print / PDF')} onPress={() => setPrintOpen(true)} />
        </Row>
        {changed ? (
          <Row style={{ flexWrap: 'nowrap' }}>
            <T small muted style={{ flex: 1 }}>{t('This {one} was changed somewhere else.', { one: NOUN.one })}</T>
            <Button small title={t('Load it again')} onPress={reload} />
          </Row>
        ) : null}

        <Card>
          <Input value={meta.title} maxLength={160} placeholder={t('Title')} editable={!locked} onChangeText={v => changeMeta({ title: v })} style={{ fontSize: 20, fontWeight: '600' }} />
          <AutoGrowInput value={meta.description ?? ''} maxLength={4000} placeholder={t('Description (optional)')} editable={!locked} onChangeText={v => changeMeta({ description: v || null })} />
          <View ref={tourRef('editor-visibility')} style={{ gap: 10, pointerEvents: locked ? 'none' : 'auto' }}>
          <H2>{t('Visibility')}</H2>
          {onDevice
            // signed in, it is the device's still while this editor is open on it: it is not moved under an editor
            ? <T small muted>{signedIn ? t('Kept on this device for now. It moves to your account when you leave the editor.') : t('Kept on this device. Sign in to keep it with your account and share it by link.')}</T>
            // one published before the public list was withdrawn is shared by its link, and shows so
            : <Segmented<Outline['visibility']> value={meta.visibility === 'public' ? 'link' : meta.visibility} options={[...VISIBILITIES]} onChange={v => changeMeta({ visibility: v })} />}
          {link ? (
            <Row style={{ flexWrap: 'nowrap' }}>
              <T small muted selectable numberOfLines={1} style={{ flex: 1 }}>{link}</T>
              <Button small title={copied ? t('Copied') : tc('verb', 'Copy')} onPress={() => { void copyLink() }} />
            </Row>
          ) : null}
          </View>
          <H2>{t('Print style')}</H2>
          <View style={{ pointerEvents: locked ? 'none' : 'auto' }}>
            <Segmented<Outline['print_style']> value={meta.print_style} options={[...PRINT_STYLES]} onChange={v => changeMeta({ print_style: v })} />
          </View>
          <Row style={{ justifyContent: 'flex-end', marginTop: 4 }}>
            <Button small danger title={t('Delete {one}', { one: NOUN.one })} disabled={locked} onPress={() => { void destroy() }} />
          </Row>
        </Card>
      </Enter>

      {texts.error ? <ErrorText>{texts.error}</ErrorText> : null}
      {items.length === 0 ? <T muted>{t('Nothing here yet. Add a passage, a note, a link or a heading below.')}</T> : null}
      {items.length > 0 ? (
        <View ref={tourRef('editor-items')} style={{ gap: GAP }}>
          {items.map((it, idx) => (
            <MotionItem key={it.id} {...arrivals.modeFor(it.id, idx)} gap={GAP} nudge={nudges.get(it.id) ?? null}
              leaving={leaving.has(it.id)} onGone={() => gone(it.id)} onHeight={h => { heights.current.set(it.id, h) }}>
              <ItemRow item={it} idx={idx} count={items.length} verses={texts.verses} loadingVerses={texts.loading} autoFocus={focusId === it.id} locked={locked}
                onChange={patch => update(idx, patch)} onRemove={() => remove(idx)} onMove={dir => reorder(idx, idx + dir)} onIndent={d => indent(idx, d)} />
            </MotionItem>
          ))}
        </View>
      ) : null}

      <AddBar onAdd={add} locked={locked} />
      <View style={{ height: 40 }} />
      <OutlinePrintSheet open={printOpen} onClose={() => setPrintOpen(false)} outline={printable} verses={texts.verses} loading={texts.loading} />
    </Screen>
  )
}

function SaveBadge({ state, retry }: { state: SaveState; retry: () => void }) {
  switch (state) {
    case 'saved': return <T small muted>{t('Saved')}</T>
    case 'dirty': return <T small muted>{t('Unsaved…')}</T>
    case 'saving': return <T small muted>{t('Saving…')}</T>
    case 'error': return <Button small danger title={t('Save failed. Retry')} onPress={retry} />
    default: { const _exhaustive: never = state; return _exhaustive }
  }
}

/** Multiline input that follows its content; RN-web reports scrollHeight (padding included), native excludes it. */
function AutoGrowInput(props: TextInputProps) {
  const [h, setH] = useState(44)
  return (
    <Input {...props} multiline scrollEnabled={false}
      onContentSizeChange={e => setH(Math.max(44, Math.ceil(e.nativeEvent.contentSize.height) + (Platform.OS === 'web' ? 2 : 22)))}
      style={[{ height: h, textAlignVertical: 'top' }, props.style]} />
  )
}

interface RowProps {
  item: OutlineItem; idx: number; count: number
  verses: Map<string, VerseRow[]>; loadingVerses: boolean; autoFocus: boolean
  /** A write from elsewhere has hold of the outline: the line takes no input for that moment. */
  locked: boolean
  onChange: (patch: Partial<OutlineItem>) => void; onRemove: () => void
  onMove: (dir: 1 | -1) => void; onIndent: (delta: 1 | -1) => void
}

const KIND_LABEL: Record<OutlineItemKind, () => string> = { verse: () => t('Passage'), note: () => tc('noun', 'Note'), link: () => t('Link'), heading: () => t('Heading') }

function ItemRow(p: RowProps) {
  const { item } = p
  const c = useColors()
  const depth = Math.min(item.depth, MAX_DEPTH)
  const indentStyle = useIndent(depth)
  return (
    <Animated.View style={[{ borderLeftColor: c.border }, indentStyle]}>
      <Card style={{ gap: 6 }}>
        <ItemBody item={item} verses={p.verses} loadingVerses={p.loadingVerses} onChange={p.onChange} autoFocus={p.autoFocus} locked={p.locked} />
        <View style={styles.controls}>
          <T small muted style={{ flex: 1 }}>{KIND_LABEL[item.kind]()}</T>
          <Button small iconName="up" title={t('Move up')} disabled={p.locked || p.idx === 0} onPress={() => p.onMove(-1)} />
          <Button small iconName="down" title={t('Move down')} disabled={p.locked || p.idx === p.count - 1} onPress={() => p.onMove(1)} />
          <Button small iconName="outdent" title={t('Outdent')} disabled={p.locked || item.depth <= 0} onPress={() => p.onIndent(-1)} />
          <Button small iconName="indent" title={t('Indent')} disabled={p.locked || item.depth >= MAX_DEPTH} onPress={() => p.onIndent(1)} />
          <Button small iconName="x" danger title={t('Delete item')} disabled={p.locked} onPress={p.onRemove} />
        </View>
      </Card>
    </Animated.View>
  )
}

/** Indent guide for `depth`; a change glides the margin, rule and padding instead of jumping. */
function useIndent(depth: number) {
  const reduce = useReduceMotion()
  const d = useRef(new Animated.Value(depth)).current
  const [moving, setMoving] = useState(false)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    if (reduce) { d.setValue(depth); return }
    setMoving(true)
    const a = Animated.timing(d, { toValue: depth, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: false })
    a.start(({ finished }) => { if (finished) setMoving(false) })
    return () => a.stop()
  }, [depth, reduce, d])
  if (!moving) return { marginLeft: 16 * depth, borderLeftWidth: depth ? 2 : 0, paddingLeft: depth ? 8 : 0 }
  const clamp = { inputRange: [0, 1], extrapolate: 'clamp' as const }
  return {
    marginLeft: Animated.multiply(d, 16),
    borderLeftWidth: d.interpolate({ ...clamp, outputRange: [0, 2] }),
    paddingLeft: d.interpolate({ ...clamp, outputRange: [0, 8] }),
  }
}

function ItemBody({ item, verses, loadingVerses, onChange, autoFocus, locked }: Pick<RowProps, 'item' | 'verses' | 'loadingVerses' | 'onChange' | 'autoFocus' | 'locked'>) {
  const c = useColors()
  switch (item.kind) {
    case 'verse': {
      const ref = itemRef(item)
      if (!ref) return <ErrorText>{t('Verse item without a reference')}</ErrorText>
      return (
        <>
          <Pressable onPress={() => openRef(ref)} accessibilityRole="link" style={{ alignSelf: 'flex-start' }}>
            <T small style={{ color: c.accent, fontWeight: '700' }}>{formatRef(ref)}</T>
          </Pressable>
          <OutlineVerseText rows={verses.get(refKey(ref))} loading={loadingVerses} />
        </>
      )
    }
    case 'note': {
      const refs = noteRefs(item.text ?? '')
      return (
        <>
          <AutoGrowInput placeholder={t('Note… (references like John 3:16 are linked automatically)')} value={item.text ?? ''} editable={!locked} onChangeText={v => onChange({ text: v })} autoFocus={autoFocus} />
          {refs.length > 0 ? (
            <Row>
              {refs.map(r => (
                <Pressable key={refKey(r)} onPress={() => openRef(r)} accessibilityRole="link" style={[styles.chip, { borderColor: c.border, backgroundColor: c.bg }]}>
                  <T small style={{ color: c.accent, fontWeight: '600' }}>{formatRef(r, 'abbr')}</T>
                </Pressable>
              ))}
            </Row>
          ) : null}
        </>
      )
    }
    case 'link':
      return (
        <>
          {/* every link's address is a field here, a paragraph's of the library too: the editor is where it is read and
              changed. Where a jotting is only read (its own view, Ask's proposal) such a line is its words alone */}
          <Input placeholder="https://…" value={item.url ?? ''} editable={!locked} onChangeText={t => onChange({ url: t || null })} autoCapitalize="none" autoCorrect={false} keyboardType="url" autoFocus={autoFocus} />
          <Input placeholder={t('Label (optional)')} value={item.text ?? ''} editable={!locked} onChangeText={v => onChange({ text: v || null })} />
        </>
      )
    case 'heading':
      return <Input placeholder={t('Heading')} value={item.text ?? ''} editable={!locked} onChangeText={v => onChange({ text: v || null })} style={{ fontSize: 18, fontWeight: '700' }} autoFocus={autoFocus} />
    default: { const _exhaustive: never = item.kind; return _exhaustive }
  }
}

/**
 * The passage field with a live preview. While typing, the preview keeps the last verses it showed (dimmed) until the
 * new reference's arrive, and the "not a reference yet" hint waits for a pause, so neither flickers keystroke by keystroke.
 */
function AddBar({ onAdd, locked }: { onAdd: (partial: Pick<OutlineItem, 'kind'> & Partial<OutlineItem>) => void; locked: boolean }) {
  const c = useColors()
  const [text, setText] = useState('')
  const settled = useSettled(text, 600)
  // the preview opens under the field as the reader types: with the keyboard up it would sit under the keyboard
  const card = useRef<View>(null)
  const revealIn = useKeyboardReveal()
  const reveal = () => { setTimeout(() => revealIn(card.current as unknown as Parameters<typeof revealIn>[0]), 30) }
  const [preview, setPreview] = useState<{ key: string; rows: VerseRow[] } | null>(null)
  const [previewErr, setPreviewErr] = useState('')
  const parsed = useMemo(() => (text.trim() ? parseRef(text) : null), [text])
  const key = parsed ? refKey(parsed) : ''

  useEffect(() => {
    if (!parsed || !key) { setPreview(null); setPreviewErr(''); return }
    let live = true
    const wait = setTimeout(() => {
      fetchVerseRows(parsed)
        .then(rows => { if (live) { setPreview({ key, rows }); setPreviewErr('') } })
        .catch((e: unknown) => { if (live) setPreviewErr(e instanceof Error ? e.message : t('Could not load preview')) })
    }, 200)
    return () => { live = false; clearTimeout(wait) }
    // parsed is derived from key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const submit = () => {
    if (!parsed || locked) return
    onAdd({ kind: 'verse', book: parsed.book, chapter: parsed.chapter, v1: parsed.v1 ?? null, v2: parsed.v2 ?? parsed.v1 ?? null })
    setText('')
  }
  const addKind = (kind: Exclude<OutlineItemKind, 'verse'>) => onAdd({ kind })

  return (
    <Card ref={el => { tourRef('editor-add')(el); card.current = el }}>
      <Row style={{ flexWrap: 'nowrap' }}>
        <Input placeholder={t('Add a passage, e.g. jn 3:16-18 or ps 23')} value={text} editable={!locked} onChangeText={setText} onSubmitEditing={submit} returnKeyType="done" submitBehavior="submit"
          autoCorrect={false} autoCapitalize="none" style={{ flex: 1, minWidth: 0 }} />
        <Button primary title={t('Add')} disabled={locked || !parsed} onPress={submit} />
      </Row>
      {text.trim() && !parsed && settled === text ? <Enter rise={4}><T small muted>{t('Not a reference yet: try “Rom 8:28” or “1 cor 13:4-7”')}</T></Enter> : null}
      {parsed ? (
        <Enter rise={4} style={[styles.preview, { borderColor: c.border, backgroundColor: c.bg }]} onLayout={reveal}>
          <T small style={{ color: c.accent, fontWeight: '700' }}>{formatRef(parsed)}</T>
          {previewErr ? <ErrorText>{previewErr}</ErrorText> : <OutlineVerseText rows={preview?.rows} loading numberOfLines={6} style={preview && preview.key !== key ? { opacity: 0.5 } : undefined} />}
        </Enter>
      ) : null}
      <Row>
        <Button small title={t('+ Note')} disabled={locked} onPress={() => addKind('note')} />
        <Button small title={t('+ Link')} disabled={locked} onPress={() => addKind('link')} />
        <Button small title={t('+ Heading')} disabled={locked} onPress={() => addKind('heading')} />
      </Row>
    </Card>
  )
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  preview: { padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed', gap: 4 },
})
