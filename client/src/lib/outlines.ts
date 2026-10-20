/**
 * Outlines: item helpers, verse text resolution (chapter files first), note auto-linking, loading by id or
 * share code, and the print/PDF document builder. Screens under app/outlines and app/o share everything here.
 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Clipboard from 'expo-clipboard'
import { router } from 'expo-router'
import type { Outline, OutlineItem, Verse } from '@shared/types'
import { formatRef, refKey, scanRefs, type Ref } from '@shared/ref'
import { ApiError, get, getApiBase } from './api'
import { fetchChapter } from './bible'
import { NotOnDevice, getOwnOutline, isLocalId, saveOutlineItems } from './library'
import { BRAND, NOUN } from '@shared/brand'
import { t, tc } from '@shared/i18n'
import { dateLocale } from '../i18n'
import { scanMinistry, scanTypedRefs, type MinistryAuthor, type MinistryTarget } from './noteLinks'

export type OutlineItemInput = Omit<OutlineItem, 'id' | 'outline_id' | 'position'>
export const strip = (i: OutlineItem): OutlineItemInput => ({ kind: i.kind, book: i.book ?? null, chapter: i.chapter ?? null, v1: i.v1 ?? null, v2: i.v2 ?? null, text: i.text ?? null, url: i.url ?? null, depth: i.depth })

/** Append verse items: contiguous runs become one range item, gaps become separate items; a `note` follows them as one
 *  note item. Whole list is written back. */
export async function addVersesToOutline(outlineId: number, book: number, chapter: number, verses: number[], note?: string): Promise<Outline> {
  const full = await getOwnOutline(outlineId)
  const items = (full.items ?? []).map(strip)
  const runs: number[][] = []
  for (const v of [...verses].sort((a, b) => a - b)) { const r = runs[runs.length - 1]; if (r && v === r[r.length - 1] + 1) r.push(v); else runs.push([v]) }
  for (const r of runs) items.push({ kind: 'verse', book, chapter, v1: r[0], v2: r[r.length - 1], text: null, url: null, depth: 0 })
  if (note?.trim()) items.push({ kind: 'note', book: null, chapter: null, v1: null, v2: null, text: note.trim(), url: null, depth: 0 })
  await saveOutlineItems(outlineId, items)
  return full
}

// ---------------- vocab ----------------
export const MAX_DEPTH = 3
export const AUTOSAVE_MS = 800

// each label is read in the reader's language when the screen shows it
export const PRINT_STYLES = [
  { value: 'verses-first', get label() { return t('Verses first') } },
  { value: 'inline', get label() { return tc('print style', 'Inline') } },
  { value: 'refs-only', get label() { return t('References only') } },
] as const satisfies readonly { value: Outline['print_style']; label: string }[]

export const VISIBILITIES = [
  { value: 'private', get label() { return tc('visibility', 'Private') } },
  { value: 'link', get label() { return t('Anyone with the link') } },
] as const satisfies readonly { value: Outline['visibility']; label: string }[]

export const isPrintStyle = (s: string): s is Outline['print_style'] => PRINT_STYLES.some(p => p.value === s)
export const isVisibility = (s: string): s is Outline['visibility'] => VISIBILITIES.some(v => v.value === s)
/** A once-published (`public`) outline reads as a link one: there is no public list. */
export const visibilityLabel = (v: Outline['visibility']) => VISIBILITIES.find(x => x.value === (v === 'public' ? 'link' : v))?.label ?? v

/** The scripture reference an item points at, or null for non-verse items. */
export function itemRef(i: Pick<OutlineItem, 'kind' | 'book' | 'chapter' | 'v1' | 'v2'>): Ref | null {
  if (i.kind !== 'verse' || !i.book || !i.chapter) return null
  const r: Ref = { book: i.book, chapter: i.chapter }
  if (i.v1 != null) {
    r.v1 = i.v1
    if (i.v2 != null && i.v2 !== i.v1) r.v2 = i.v2
  }
  return r
}

/** Distinct `book.chapter.v1-v2` keys for every verse item, in order. */
export function verseKeys(items: readonly OutlineItem[]): string[] {
  const seen = new Set<string>()
  for (const i of items) { const r = itemRef(i); if (r) seen.add(refKey(r)) }
  return [...seen]
}

/** Kept on this device (made while signed out): private, no link, no report, the reader is its owner. */
export const isLocalOutline = (o: Pick<Outline, 'id'>) => isLocalId(o.id)

/** Where a shared outline lives: same origin as the web app, the API host on native. */
export function siteOrigin(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) return window.location.origin
  return getApiBase()
}
export const shareUrl = (o: Pick<Outline, 'share_code' | 'visibility'>): string | null =>
  o.visibility !== 'private' && o.share_code ? `${siteOrigin()}/o/${o.share_code}` : null

export const fmtDateLong = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString(dateLocale(), { year: 'numeric', month: 'short', day: 'numeric' }) }

// ---------------- verse text ----------------
export type VerseRow = Pick<Verse, 'v' | 't' | 'h'>
const verseCache = new Map<string, VerseRow[]>()

/** Verses for one reference. Chapters come from the local chapter files when present, otherwise the static JSON. */
export async function fetchVerseRows(ref: Ref): Promise<VerseRow[]> {
  const k = refKey(ref)
  const hit = verseCache.get(k)
  if (hit) return hit
  const ch = await fetchChapter(ref.book, ref.chapter)
  const v1 = ref.v1 ?? 1, v2 = ref.v1 === undefined ? Number.MAX_SAFE_INTEGER : ref.v2 ?? ref.v1
  const rows = ch.verses.filter(v => v.v >= v1 && v.v <= v2).map(v => ({ v: v.v, t: v.t, h: v.h }))
  verseCache.set(k, rows)
  return rows
}
/** Resolve a set of ref keys (parsed back from `refKey`). Missing chapters do not fail the others. */
export async function fetchVerses(keys: readonly string[], onRow?: (key: string, rows: VerseRow[]) => void): Promise<Map<string, VerseRow[]>> {
  const out = new Map<string, VerseRow[]>()
  let firstError: Error | null = null
  await Promise.all(keys.map(async k => {
    const ref = keyToRef(k)
    if (!ref) { out.set(k, []); return }
    try { const rows = await fetchVerseRows(ref); out.set(k, rows); onRow?.(k, rows) } catch (e) { firstError ??= e as Error }
  }))
  if (firstError) throw firstError
  return out
}
export function keyToRef(k: string): Ref | null {
  const m = /^(\d+)\.(\d+)(?:\.(\d+)(?:-(\d+))?)?$/.exec(k)
  if (!m) return null
  const r: Ref = { book: +m[1], chapter: +m[2] }
  if (m[3]) { r.v1 = +m[3]; if (m[4]) r.v2 = +m[4] }
  return r
}

export interface VerseTexts { verses: Map<string, VerseRow[]>; loading: boolean; error: string }

/** Verse text for every key; rows arrive incrementally, refetched only when the key set changes. */
export function useVerseTexts(keys: readonly string[]): VerseTexts {
  const sig = keys.join(',')
  const [state, setState] = useState<VerseTexts>({ verses: new Map(), loading: keys.length > 0, error: '' })
  useEffect(() => {
    const list = sig ? sig.split(',') : []
    if (list.length === 0) { setState({ verses: new Map(), loading: false, error: '' }); return }
    let live = true
    setState(s => ({ verses: s.verses, loading: true, error: '' }))
    fetchVerses(list, (k, rows) => { if (live) setState(s => { const m = new Map(s.verses); m.set(k, rows); return { ...s, verses: m } }) })
      .then(verses => { if (live) setState({ verses, loading: false, error: '' }) })
      .catch((e: unknown) => { if (live) setState(s => ({ ...s, loading: false, error: e instanceof Error ? e.message : t('Could not load verses') })) })
    return () => { live = false }
  }, [sig])
  return state
}

// ---------------- loading an outline by id or share code ----------------
export type OutlineLoad =
  | { kind: 'loading' }
  | { kind: 'ok'; outline: Outline }
  | { kind: 'error'; status: number; message: string }

export const outlineApiPath = (p: { id?: string; code?: string }): string | null =>
  p.code ? `/outlines/shared/${encodeURIComponent(p.code)}` : p.id ? `/outlines/${encodeURIComponent(p.id)}` : null

/** The reader accepts the verse as a `v` query param (it scrolls once, then clears it), not the web `#v` hash. */
export const openRef = (r: Ref) => router.push({ pathname: '/read/[book]/[chapter]', params: { book: String(r.book), chapter: String(r.chapter), v: r.v1 !== undefined ? String(r.v1) : '' } })

/**
 * Loads the outline named by the route; `reloadKey` forces a refetch (sign-in turning a 403 into a load).
 * `enabled=false` holds the loading state: the first GET must wait for the auth store to restore the token,
 * otherwise a private outline 403s for its own owner.
 */
export function useOutlineLoad(p: { id?: string; code?: string }, reloadKey = 0, enabled = true): OutlineLoad {
  const path = outlineApiPath(p)
  const [state, setState] = useState<OutlineLoad>({ kind: 'loading' })
  useEffect(() => {
    if (!enabled) { setState({ kind: 'loading' }); return }
    if (!path) { setState({ kind: 'error', status: 404, message: t('No {one} requested', { one: NOUN.one }) }); return }
    let live = true
    setState({ kind: 'loading' })
    const local = !p.code && p.id !== undefined && isLocalId(p.id)
    ;(local ? getOwnOutline(Number(p.id)) : get<Outline>(path))
      .then(o => { if (live) setState({ kind: 'ok', outline: o }) })
      .catch((e: unknown) => {
        if (!live) return
        if (e instanceof ApiError || e instanceof NotOnDevice) setState({ kind: 'error', status: e.status, message: e.message })
        else setState({ kind: 'error', status: 0, message: e instanceof Error ? e.message : t('Could not load {one}', { one: NOUN.one }) })
      })
    return () => { live = false }
    // p.id and p.code are what `path` is built from
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, reloadKey, enabled])
  return state
}

export function loadErrorText(e: { status: number; message: string }): string {
  if (e.status === 403) return t('This {one} is private.', { one: NOUN.one })
  if (e.status === 404) return t('This {one} does not exist or has been deleted.', { one: NOUN.one })
  if (e.status === 0) return t('Could not reach the server.')
  return e.message || t('Something went wrong.')
}

// ---------------- note auto-linking ----------------
export type NoteSegment =
  | { kind: 'text'; text: string }
  | { kind: 'ref'; text: string; ref: Ref }
  | { kind: 'url'; text: string; href: string }
  /** Ministry named in the note: "JND on John 3", "Mr. Coates" (lib/noteLinks.ts). */
  | { kind: 'ministry'; text: string; target: MinistryTarget }

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g

/** Split note text into plain runs, scripture references (typed in lower case too), the ministry it names and bare URLs
 *  (in source order, never overlapping). `shown`: an author the edition hides is left as plain text. */
export function segmentNote(text: string, shown?: (a: MinistryAuthor) => boolean): NoteSegment[] {
  type Span = { start: number; end: number; seg: NoteSegment }
  const refs = scanTypedRefs(text)
  const spans: Span[] = refs.map(r => ({ start: r.start, end: r.end, seg: { kind: 'ref', text: text.slice(r.start, r.end), ref: r.ref } }))
  for (const m of scanMinistry(text, refs, shown)) spans.push({ start: m.start, end: m.end, seg: { kind: 'ministry', text: text.slice(m.start, m.end), target: m.target } })
  for (const m of text.matchAll(URL_RE)) {
    let raw = m[0]
    while (/[.,;:!?)\]]$/.test(raw)) raw = raw.slice(0, -1)
    const start = m.index ?? 0
    spans.push({ start, end: start + raw.length, seg: { kind: 'url', text: raw, href: raw } })
  }
  spans.sort((a, b) => a.start - b.start)
  const out: NoteSegment[] = []
  let pos = 0
  for (const s of spans) {
    if (s.start < pos) continue
    if (s.start > pos) out.push({ kind: 'text', text: text.slice(pos, s.start) })
    out.push(s.seg)
    pos = s.end
  }
  if (pos < text.length) out.push({ kind: 'text', text: text.slice(pos) })
  return out
}

/** Only the scripture references in a note, de-duplicated by key. */
export function noteRefs(text: string): Ref[] {
  const seen = new Map<string, Ref>()
  for (const r of scanRefs(text)) { const k = refKey(r.ref); if (!seen.has(k)) seen.set(k, r.ref) }
  return [...seen.values()]
}

// ---------------- small platform helpers ----------------
export async function copyText(text: string): Promise<boolean> {
  try { await Clipboard.setStringAsync(text); return true } catch { return false }
}

/** Native Alert / web confirm(); RN's Alert is a no-op on react-native-web. */
export function confirmAsync(title: string, message: string, ok = t('Delete')): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`))
  return new Promise(resolve => Alert.alert(title, message, [
    { text: t('Cancel'), style: 'cancel', onPress: () => resolve(false) },
    { text: ok, style: 'destructive', onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }))
}

/** Debounced value (public search box). */
export function useDebounced<V>(value: V, ms: number): V {
  const [v, setV] = useState(value)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; return }
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

// ---------------- print / PDF ----------------
export const PAPERS = [
  { id: 'bible', get label() { return t('Bible insert') }, size: '3.5 × 5.5 in', w: 3.5, h: 5.5 },
  { id: 'half', get label() { return t('Half letter') }, size: '5.5 × 8.5 in', w: 5.5, h: 8.5 },
  { id: 'a5', label: 'A5', size: '148 × 210 mm', w: 5.83, h: 8.27 },
  { id: 'letter', get label() { return tc('paper size', 'Letter') }, size: '8.5 × 11 in', w: 8.5, h: 11 },
  { id: 'a4', label: 'A4', size: '210 × 297 mm', w: 8.27, h: 11.69 },
] as const
export type PaperId = typeof PAPERS[number]['id']
export const isPaper = (s: string): s is PaperId => PAPERS.some(p => p.id === s)
export const paperById = (id: PaperId) => PAPERS.find(p => p.id === id) ?? PAPERS[0]

export interface PrintSettings { paper: PaperId; margin: number; font: number; columns: 1 | 2; style: Outline['print_style'] | '' }
export const PRINT_DEFAULTS: PrintSettings = { paper: 'bible', margin: 0.3, font: 9, columns: 1, style: '' }
export const MARGIN_MIN = 0, MARGIN_MAX = 1.5, FONT_PT_MIN = 8, FONT_PT_MAX = 14
const PRINT_KEY = 'berean_print'

export async function loadPrintSettings(): Promise<PrintSettings> {
  try {
    const raw: unknown = JSON.parse((await AsyncStorage.getItem(PRINT_KEY)) ?? '{}')
    if (!raw || typeof raw !== 'object') return PRINT_DEFAULTS
    const r = raw as Record<string, unknown>
    return {
      paper: typeof r.paper === 'string' && isPaper(r.paper) ? r.paper : PRINT_DEFAULTS.paper,
      margin: typeof r.margin === 'number' && r.margin >= MARGIN_MIN && r.margin <= MARGIN_MAX ? r.margin : PRINT_DEFAULTS.margin,
      font: typeof r.font === 'number' && r.font >= FONT_PT_MIN && r.font <= FONT_PT_MAX ? r.font : PRINT_DEFAULTS.font,
      columns: r.columns === 2 ? 2 : 1,
      style: typeof r.style === 'string' && isPrintStyle(r.style) ? r.style : '',
    }
  } catch { return PRINT_DEFAULTS }
}
export const savePrintSettings = (s: PrintSettings) => AsyncStorage.setItem(PRINT_KEY, JSON.stringify(s)).catch(() => {})

const esc = (s: string) => s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
/** `h` is the server's html variant (only `<i>` tags, entities already encoded); plain text is escaped. */
const verseHtml = (r: VerseRow) => (r.h && r.h.includes('<i>') ? r.h.replace(/<(?!\/?i>)[^>]*>/g, '') : esc(r.t))

function rowsHtml(rows: VerseRow[] | undefined, inline: boolean): string {
  if (!rows) return '<span class="muted">…</span>'
  if (rows.length === 0) return `<span class="muted">${esc(t('No text found for this reference.'))}</span>`
  const body = rows.map(r => `${rows.length > 1 ? `<sup class="vn">${r.v}</sup>` : ''}${r.t === '' ? '<i class="muted">[omitted]</i>' : verseHtml(r)}`).join(' ')
  return inline ? `<span class="verse-text">${body}</span>` : `<div class="verse-text">${body}</div>`
}
function noteHtml(text: string): string {
  return segmentNote(text).map(s => {
    switch (s.kind) {
      case 'text': return esc(s.text)
      case 'ref': return `<span class="ref">${esc(s.text)}</span>`
      case 'url': return `<a href="${esc(s.href)}">${esc(s.text)}</a>`
      case 'ministry': return esc(s.text)
      default: { const _x: never = s; return _x }
    }
  }).join('')
}
function itemHtml(it: OutlineItem, style: Outline['print_style'], verses: Map<string, VerseRow[]>): string {
  const depth = Math.min(it.depth, MAX_DEPTH)
  const cls = `item ${it.kind} depth-${depth}`
  switch (it.kind) {
    case 'verse': {
      const ref = itemRef(it)
      if (!ref) return ''
      const label = esc(formatRef(ref))
      const rows = verses.get(refKey(ref))
      if (style === 'refs-only') return `<div class="${cls}"><span class="ref-link">${label}</span></div>`
      if (style === 'inline') return `<div class="${cls}"><p class="inline-verse"><span class="ref-link">${label}</span><span class="dash"> — </span>${rowsHtml(rows, true)}</p></div>`
      return `<div class="${cls}"><div class="ref-link">${label}</div>${rowsHtml(rows, false)}</div>`
    }
    case 'note': return `<div class="${cls}"><div class="note">${noteHtml(it.text ?? '')}</div></div>`
    case 'link': return it.url ? `<div class="${cls}"><a class="ext-link" href="${esc(it.url)}">${esc(it.text || it.url)}</a></div>` : ''
    case 'heading': return `<div class="${cls}"><div class="hd">${esc(it.text ?? '')}</div></div>`
    default: { const _x: never = it.kind; return _x }
  }
}

/**
 * The printable document. `target` decides where the margins live: the browser honours `@page`, the
 * native PDF renderers draw edge to edge so the body carries the padding instead.
 */
export function buildPrintHtml(o: Outline, verses: Map<string, VerseRow[]>, s: PrintSettings, target: 'web' | 'native'): string {
  const paper = paperById(s.paper)
  const style = s.style || o.print_style
  const items = o.items ?? []
  const body = items.length ? items.map(it => itemHtml(it, style, verses)).join('\n') : `<p class="muted">${esc(t('This {one} is empty.', { one: NOUN.one }))}</p>`
  const meta = [o.owner_handle ? `@${esc(o.owner_handle)}` : '', fmtDateLong(o.updated_at), 'Darby'].filter(Boolean).join(' · ')
  const pageMargin = target === 'web' ? `${s.margin}in` : '0'
  const bodyPad = target === 'web' ? '0' : `${s.margin}in`
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(o.title)} — ${esc(BRAND.name)}</title>
<style>
@page { size: ${paper.w}in ${paper.h}in; margin: ${pageMargin}; }
html, body { margin: 0; background: #fff; color: #000; }
body { padding: ${bodyPad}; font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: ${s.font}pt; line-height: 1.35; -webkit-print-color-adjust: exact; }
a { color: inherit; text-decoration: none; }
.head { border-bottom: 1px solid #000; padding-bottom: .35em; margin-bottom: .6em; break-after: avoid; page-break-after: avoid; }
.head h1 { font-family: Georgia, "Times New Roman", serif; font-size: 1.35em; font-weight: 600; margin: 0 0 .15em; }
.meta { font-size: .8em; color: #444; letter-spacing: .04em; text-transform: uppercase; }
.desc { font-size: .9em; margin: .4em 0 0; white-space: pre-wrap; color: #222; }
.body { column-count: ${s.columns}; column-gap: .3in; column-fill: auto; orphans: 2; widows: 2; }
.item { display: block; padding: .15em 0 .35em; break-inside: avoid; page-break-inside: avoid; }
.item.verse { break-inside: auto; page-break-inside: auto; }
.verse .ref-link { display: block; font-size: .78em; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; margin-bottom: .1em; break-after: avoid; page-break-after: avoid; }
.inline-verse { margin: 0; }
.inline-verse .ref-link { display: inline; font-size: .85em; text-transform: none; letter-spacing: 0; margin: 0; font-weight: 700; }
.inline-verse .dash { color: #666; }
.verse-text { font-family: Georgia, "Times New Roman", serif; line-height: 1.35; text-align: left; }
.vn { font-size: .6em; color: #444; font-family: -apple-system, Helvetica, Arial, sans-serif; font-weight: 600; margin-right: .15em; line-height: 0; vertical-align: super; }
.note { font-size: .95em; white-space: pre-wrap; line-height: 1.4; }
.note .ref { font-weight: 600; }
.note a { text-decoration: underline; text-decoration-color: #999; }
.hd { font-weight: 700; font-size: 1.05em; margin-top: .45em; break-after: avoid; page-break-after: avoid; }
.ext-link { font-size: .9em; text-decoration: underline; word-break: break-all; }
.depth-1 { margin-left: 1em; } .depth-2 { margin-left: 2em; } .depth-3 { margin-left: 3em; }
.style-refs-only .item { padding: .05em 0; }
.style-refs-only .verse .ref-link { display: inline; text-transform: none; letter-spacing: 0; font-size: 1em; font-weight: 600; }
.muted { color: #666; }
</style></head>
<body class="style-${style}">
<div class="head"><h1>${esc(o.title)}</h1><div class="meta">${meta}</div>${o.description ? `<p class="desc">${esc(o.description)}</p>` : ''}</div>
<div class="body">
${body}
</div>
</body></html>`
}

export type PrintMode = 'pdf' | 'print'

/**
 * Web: the document goes into a new window (iframe when popups are blocked) and the browser print dialog
 * offers Save as PDF. Native: expo-print renders a PDF sized in points (inches × 72) that is handed to the
 * share sheet, or straight to the system print dialog.
 */
export async function printOutline(o: Outline, verses: Map<string, VerseRow[]>, s: PrintSettings, mode: PrintMode): Promise<void> {
  const paper = paperById(s.paper)
  if (Platform.OS === 'web') {
    const html = buildPrintHtml(o, verses, s, 'web')
    const w = window.open('', '_blank')
    if (w) {
      w.document.open(); w.document.write(html); w.document.close()
      setTimeout(() => { w.focus(); w.print() }, 300)
      return
    }
    const frame = document.createElement('iframe')
    frame.style.position = 'fixed'; frame.style.right = '0'; frame.style.bottom = '0'; frame.style.width = '0'; frame.style.height = '0'; frame.style.border = '0'
    document.body.appendChild(frame)
    const doc = frame.contentDocument
    if (!doc) { frame.remove(); throw new Error(t('Could not open the print view')) }
    doc.open(); doc.write(html); doc.close()
    await new Promise(r => setTimeout(r, 300))
    frame.contentWindow?.focus(); frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 60_000)
    return
  }
  const html = buildPrintHtml(o, verses, s, 'native')
  const width = Math.round(paper.w * 72), height = Math.round(paper.h * 72)
  // loaded when an outline is printed: this module is on every screen's path, printing is not
  const [Print, Sharing] = await Promise.all([import('expo-print'), import('expo-sharing')])
  if (mode === 'print') { await Print.printAsync({ html, width, height }); return }
  const { uri } = await Print.printToFileAsync({ html, width, height })
  if (!(await Sharing.isAvailableAsync())) throw new Error(t('Sharing is not available on this device'))
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: o.title })
}
