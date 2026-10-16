import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Platform, Pressable, StyleSheet, View, type TextInputProps } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import type { Outline, OutlineItem, OutlineItemKind } from '@shared/types'
import { formatRef, parseRef, refKey } from '@shared/ref'
import { deleteOutline, isLocalId, patchOutline, saveOutlineItems } from '../../../src/lib/library'
import {
  AUTOSAVE_MS, MAX_DEPTH, PRINT_STYLES, VISIBILITIES, confirmAsync, copyText, fetchVerseRows, itemRef, loadErrorText, noteRefs, openRef, shareUrl, strip,
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

type SaveState = 'saved' | 'dirty' | 'saving' | 'error'
/** Gap between item cards; also the extra distance a swapped card travels. */
const GAP = 12
type Meta = Pick<Outline, 'title' | 'description' | 'visibility' | 'print_style'>

/** Owner-only editor; anyone else lands on the read-only view. An outline kept on this device is the reader's own. */
export default function OutlineEdit() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { user, ready } = useAuth()
  const router = useRouter()
  const local = isLocalId(id ?? '')
  const load = useOutlineLoad({ id }, 0, ready && (!!user || local))
  const mine = load.kind === 'ok' && (isLocalId(load.outline.id) || (!!user && load.outline.user_id === user.id))

  useEffect(() => {
    if (load.kind === 'ok' && user && !mine) router.replace({ pathname: '/outlines/[id]', params: { id: String(load.outline.id) } })
  }, [load, user, mine, router])

  if (ready && !user && !local) return (
    <Screen>
      <Stack.Screen options={{ title: `Edit ${NOUN.one}` }} />
      <Card><T muted>Sign in to edit this {NOUN.one}.</T><Row><Button primary small title="Sign in" onPress={() => router.push('/login')} /><Button small title="View instead" onPress={() => router.replace({ pathname: '/outlines/[id]', params: { id: String(id) } })} /></Row></Card>
    </Screen>
  )
  if (load.kind === 'loading') return <Screen><Stack.Screen options={{ title: `Edit ${NOUN.one}` }} /><Spinner /></Screen>
  if (load.kind === 'error') return (
    <Screen>
      <Stack.Screen options={{ title: `Edit ${NOUN.one}` }} />
      <Card><ErrorText>{loadErrorText(load)}</ErrorText><Row><Button small title={`Back to ${NOUN.many}`} onPress={() => router.replace('/outlines')} /></Row></Card>
    </Screen>
  )
  if (!mine) return <Screen><Stack.Screen options={{ title: `Edit ${NOUN.one}` }} /><Spinner /></Screen>
  return <Editor key={load.outline.id} initial={load.outline} />
}

function Editor({ initial }: { initial: Outline }) {
  const router = useRouter()
  const [meta, setMeta] = useState<Meta>({ title: initial.title, description: initial.description, visibility: initial.visibility, print_style: initial.print_style })
  const [items, setItems] = useState<OutlineItem[]>(initial.items ?? [])
  const [save, setSave] = useState<SaveState>('saved')
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

  // ---- autosave: the whole item list is PUT, metadata is PATCHed; both debounced, both flushed on unmount ----
  const latest = useRef({ items, meta, itemsDirty: false, metaDirty: false, version: 0 })
  latest.current.items = items
  latest.current.meta = meta
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(async (keepalive = false) => {
    const l = latest.current
    if (!l.itemsDirty && !l.metaDirty) return
    const version = l.version
    const doItems = l.itemsDirty, doMeta = l.metaDirty
    setSave('saving')
    try {
      const jobs: Promise<unknown>[] = []
      if (doItems) jobs.push(saveOutlineItems(initial.id, l.items.map(strip), keepalive))
      // an empty title is rejected by the server (min 1): keep the last saved title until the user types one
      if (doMeta) jobs.push(patchOutline(initial.id, { ...l.meta, title: l.meta.title.trim() || undefined }, keepalive))
      await Promise.all(jobs)
      if (latest.current.version === version) {
        if (doItems) latest.current.itemsDirty = false
        if (doMeta) latest.current.metaDirty = false
        setSave(latest.current.itemsDirty || latest.current.metaDirty ? 'dirty' : 'saved')
      }
    } catch { setSave('error') }
  }, [initial.id])

  const schedule = useCallback(() => {
    latest.current.version++
    setSave('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = null; void flush() }, AUTOSAVE_MS)
  }, [flush])

  useEffect(() => {
    const before = () => { if (latest.current.itemsDirty || latest.current.metaDirty) void flush(true) }
    if (Platform.OS === 'web') window.addEventListener('beforeunload', before)
    return () => {
      if (Platform.OS === 'web') window.removeEventListener('beforeunload', before)
      if (timer.current) clearTimeout(timer.current)
      void flush(true)
    }
  }, [flush])

  const changeItems = (fn: (prev: OutlineItem[]) => OutlineItem[]) => {
    setItems(prev => { const next = fn(prev); latest.current.items = next; return next })
    latest.current.itemsDirty = true
    schedule()
  }
  const changeMeta = (patch: Partial<Meta>) => {
    setMeta(prev => { const next = { ...prev, ...patch }; latest.current.meta = next; return next })
    latest.current.metaDirty = true
    schedule()
  }

  // ---- item operations (index based) ----
  const update = (idx: number, patch: Partial<OutlineItem>) => changeItems(p => p.map((it, i) => i === idx ? { ...it, ...patch } : it))
  const remove = (idx: number) => { const it = items[idx]; if (it) setLeaving(s => new Set(s).add(it.id)) }
  const gone = (id: number) => {
    changeItems(p => p.filter(it => it.id !== id))
    setLeaving(s => { const n = new Set(s); n.delete(id); return n })
    heights.current.delete(id)
  }
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return
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
    const last = latest.current.items[latest.current.items.length - 1]
    const item: OutlineItem = {
      id: tempId.current--, outline_id: initial.id, position: latest.current.items.length, depth: last?.depth ?? 0,
      book: null, chapter: null, v1: null, v2: null, text: null, url: null, ...partial,
    }
    arrivals.expect(item.id)
    if (item.kind !== 'verse') setFocusId(item.id)
    changeItems(p => [...p, item])
  }

  const keys = useMemo(() => verseKeys(items), [items])
  const texts = useVerseTexts(keys)

  const onDevice = isLocalId(initial.id)
  const link = shareUrl({ share_code: initial.share_code, visibility: meta.visibility })
  const copyLink = async () => { if (link && await copyText(link)) { setCopied(true); setTimeout(() => setCopied(false), 1500) } }
  const destroy = async () => {
    if (!await confirmAsync(`Delete “${meta.title}”?`, 'This cannot be undone.')) return
    latest.current.itemsDirty = false; latest.current.metaDirty = false
    if (timer.current) clearTimeout(timer.current)
    try { await deleteOutline(initial.id); router.replace('/outlines') } catch { setSave('error') }
  }
  const printable: Outline = { ...initial, ...meta, items }
  // the full tour opens the print sheet to show it
  useEffect(() => offerTourControls('editor', { print: setPrintOpen }), [])

  return (
    <Screen animate={false}>
      <Stack.Screen options={{ title: `Edit ${NOUN.one}` }} />
      <Enter style={{ gap: 12 }}>
        <Row>
          <SaveBadge state={save} retry={() => { void flush() }} />
          <View style={{ flex: 1 }} />
          <Button small title="View" onPress={() => router.push({ pathname: '/outlines/[id]', params: { id: String(initial.id) } })} />
          <Button small title="Print / PDF" onPress={() => setPrintOpen(true)} />
        </Row>

        <Card>
          <Input value={meta.title} maxLength={160} placeholder="Title" onChangeText={t => changeMeta({ title: t })} style={{ fontSize: 20, fontWeight: '600' }} />
          <AutoGrowInput value={meta.description ?? ''} maxLength={4000} placeholder="Description (optional)" onChangeText={t => changeMeta({ description: t || null })} />
          <View ref={tourRef('editor-visibility')} style={{ gap: 10 }}>
          <H2>Visibility</H2>
          {onDevice
            ? <T small muted>Kept on this device. Sign in to keep it with your account and share it by link.</T>
            // one published before the public list was withdrawn is shared by its link, and shows so
            : <Segmented<Outline['visibility']> value={meta.visibility === 'public' ? 'link' : meta.visibility} options={[...VISIBILITIES]} onChange={v => changeMeta({ visibility: v })} />}
          {link ? (
            <Row style={{ flexWrap: 'nowrap' }}>
              <T small muted selectable numberOfLines={1} style={{ flex: 1 }}>{link}</T>
              <Button small title={copied ? 'Copied' : 'Copy'} onPress={() => { void copyLink() }} />
            </Row>
          ) : null}
          </View>
          <H2>Print style</H2>
          <Segmented<Outline['print_style']> value={meta.print_style} options={[...PRINT_STYLES]} onChange={v => changeMeta({ print_style: v })} />
          <Row style={{ justifyContent: 'flex-end', marginTop: 4 }}>
            <Button small danger title={`Delete ${NOUN.one}`} onPress={() => { void destroy() }} />
          </Row>
        </Card>
      </Enter>

      {texts.error ? <ErrorText>{texts.error}</ErrorText> : null}
      {items.length === 0 ? <T muted>Nothing here yet. Add a passage, a note, a link or a heading below.</T> : null}
      {items.length > 0 ? (
        <View ref={tourRef('editor-items')} style={{ gap: GAP }}>
          {items.map((it, idx) => (
            <MotionItem key={it.id} {...arrivals.modeFor(it.id, idx)} gap={GAP} nudge={nudges.get(it.id) ?? null}
              leaving={leaving.has(it.id)} onGone={() => gone(it.id)} onHeight={h => { heights.current.set(it.id, h) }}>
              <ItemRow item={it} idx={idx} count={items.length} verses={texts.verses} loadingVerses={texts.loading} autoFocus={focusId === it.id}
                onChange={patch => update(idx, patch)} onRemove={() => remove(idx)} onMove={dir => reorder(idx, idx + dir)} onIndent={d => indent(idx, d)} />
            </MotionItem>
          ))}
        </View>
      ) : null}

      <AddBar onAdd={add} />
      <View style={{ height: 40 }} />
      <OutlinePrintSheet open={printOpen} onClose={() => setPrintOpen(false)} outline={printable} verses={texts.verses} loading={texts.loading} />
    </Screen>
  )
}

function SaveBadge({ state, retry }: { state: SaveState; retry: () => void }) {
  switch (state) {
    case 'saved': return <T small muted>Saved</T>
    case 'dirty': return <T small muted>Unsaved…</T>
    case 'saving': return <T small muted>Saving…</T>
    case 'error': return <Button small danger title="Save failed. Retry" onPress={retry} />
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
  onChange: (patch: Partial<OutlineItem>) => void; onRemove: () => void
  onMove: (dir: 1 | -1) => void; onIndent: (delta: 1 | -1) => void
}

const KIND_LABEL: Record<OutlineItemKind, string> = { verse: 'Passage', note: 'Note', link: 'Link', heading: 'Heading' }

function ItemRow(p: RowProps) {
  const { item } = p
  const c = useColors()
  const depth = Math.min(item.depth, MAX_DEPTH)
  const indentStyle = useIndent(depth)
  return (
    <Animated.View style={[{ borderLeftColor: c.border }, indentStyle]}>
      <Card style={{ gap: 6 }}>
        <ItemBody item={item} verses={p.verses} loadingVerses={p.loadingVerses} onChange={p.onChange} autoFocus={p.autoFocus} />
        <View style={styles.controls}>
          <T small muted style={{ flex: 1 }}>{KIND_LABEL[item.kind]}</T>
          <Button small iconName="up" title="Move up" disabled={p.idx === 0} onPress={() => p.onMove(-1)} />
          <Button small iconName="down" title="Move down" disabled={p.idx === p.count - 1} onPress={() => p.onMove(1)} />
          <Button small iconName="outdent" title="Outdent" disabled={item.depth <= 0} onPress={() => p.onIndent(-1)} />
          <Button small iconName="indent" title="Indent" disabled={item.depth >= MAX_DEPTH} onPress={() => p.onIndent(1)} />
          <Button small iconName="x" danger title="Delete item" onPress={p.onRemove} />
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

function ItemBody({ item, verses, loadingVerses, onChange, autoFocus }: Pick<RowProps, 'item' | 'verses' | 'loadingVerses' | 'onChange' | 'autoFocus'>) {
  const c = useColors()
  switch (item.kind) {
    case 'verse': {
      const ref = itemRef(item)
      if (!ref) return <ErrorText>Verse item without a reference</ErrorText>
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
          <AutoGrowInput placeholder="Note… (references like John 3:16 are linked automatically)" value={item.text ?? ''} onChangeText={t => onChange({ text: t })} autoFocus={autoFocus} />
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
          <Input placeholder="https://…" value={item.url ?? ''} onChangeText={t => onChange({ url: t || null })} autoCapitalize="none" autoCorrect={false} keyboardType="url" autoFocus={autoFocus} />
          <Input placeholder="Label (optional)" value={item.text ?? ''} onChangeText={t => onChange({ text: t || null })} />
        </>
      )
    case 'heading':
      return <Input placeholder="Heading" value={item.text ?? ''} onChangeText={t => onChange({ text: t || null })} style={{ fontSize: 18, fontWeight: '700' }} autoFocus={autoFocus} />
    default: { const _exhaustive: never = item.kind; return _exhaustive }
  }
}

/**
 * The passage field with a live preview. While typing, the preview keeps the last verses it showed (dimmed) until the
 * new reference's arrive, and the "not a reference yet" hint waits for a pause, so neither flickers keystroke by keystroke.
 */
function AddBar({ onAdd }: { onAdd: (partial: Pick<OutlineItem, 'kind'> & Partial<OutlineItem>) => void }) {
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
    const t = setTimeout(() => {
      fetchVerseRows(parsed)
        .then(rows => { if (live) { setPreview({ key, rows }); setPreviewErr('') } })
        .catch((e: unknown) => { if (live) setPreviewErr(e instanceof Error ? e.message : 'Could not load preview') })
    }, 200)
    return () => { live = false; clearTimeout(t) }
    // parsed is derived from key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const submit = () => {
    if (!parsed) return
    onAdd({ kind: 'verse', book: parsed.book, chapter: parsed.chapter, v1: parsed.v1 ?? null, v2: parsed.v2 ?? parsed.v1 ?? null })
    setText('')
  }
  const addKind = (kind: Exclude<OutlineItemKind, 'verse'>) => onAdd({ kind })

  return (
    <Card ref={el => { tourRef('editor-add')(el); card.current = el }}>
      <Row style={{ flexWrap: 'nowrap' }}>
        <Input placeholder="Add a passage, e.g. jn 3:16-18 or ps 23" value={text} onChangeText={setText} onSubmitEditing={submit} returnKeyType="done" submitBehavior="submit"
          autoCorrect={false} autoCapitalize="none" style={{ flex: 1, minWidth: 0 }} />
        <Button primary title="Add" disabled={!parsed} onPress={submit} />
      </Row>
      {text.trim() && !parsed && settled === text ? <Enter rise={4}><T small muted>Not a reference yet: try “Rom 8:28” or “1 cor 13:4-7”</T></Enter> : null}
      {parsed ? (
        <Enter rise={4} style={[styles.preview, { borderColor: c.border, backgroundColor: c.bg }]} onLayout={reveal}>
          <T small style={{ color: c.accent, fontWeight: '700' }}>{formatRef(parsed)}</T>
          {previewErr ? <ErrorText>{previewErr}</ErrorText> : <OutlineVerseText rows={preview?.rows} loading numberOfLines={6} style={preview && preview.key !== key ? { opacity: 0.5 } : undefined} />}
        </Enter>
      ) : null}
      <Row>
        <Button small title="+ Note" onPress={() => addKind('note')} />
        <Button small title="+ Link" onPress={() => addKind('link')} />
        <Button small title="+ Heading" onPress={() => addKind('heading')} />
      </Row>
    </Card>
  )
}

const styles = StyleSheet.create({
  controls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  preview: { padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed', gap: 4 },
})
