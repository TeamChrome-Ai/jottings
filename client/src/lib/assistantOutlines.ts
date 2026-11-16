/**
 * Ask's tools for the reader's own outlines (docs/ASSISTANT.md, "The reader's own studies"): list, read and open, and
 * the two that write, create and edit. They run here, with the reader's own session, through the functions the
 * outline screens themselves use (`OutlinesHost`, filled in by AssistantHost), so Ask can do nothing to an outline that
 * the reader could not do by hand in the editor, and nothing at all to another person's, or to one kept only on this
 * device.
 *
 * A write is planned first and written second. `planWrite` checks every line (a passage against the Bible's own
 * chapters and verses) and reads the outline an edit would change; it writes nothing. `applyPlan` writes the plan,
 * after reading the outline again: one that has changed since it was planned is left alone. When the server holds a
 * write (lib/assistant.ts), the plan is what the proposal shows, and Apply is what calls `applyPlan`.
 *
 * Every write comes with its Undo. Undo acts only while the outline is exactly as Ask left it (`Left`: the server's
 * `updated_at` and a sum of the title and the lines): the reader's own later work is never taken away.
 */
import { BOOKS } from '@shared/books'
import { BRAND } from '@shared/brand'
import { parseRef } from '@shared/ref'
import type { ParagraphRef } from '@shared/assistantTools'
import type { Outline, OutlineItem } from '@shared/types'
import { isPlace } from './backupFile'
import type { ActionContext, Change, Executor, Outcome } from './assistantActions'
import { newWriter } from './outlineEditors'
import { searchWords } from './outlineMatch'
import { paragraphAddress, paragraphLabel, paragraphRoute } from './paragraphLine'

/** A line as the editor saves it. */
export type Item = Omit<OutlineItem, 'id' | 'outline_id' | 'position'>
export interface Listed { id: number; title: string; updated_at: string }

/** The reader's own outlines as the app reaches them, signed in. Each function is one the outline screens use. */
export interface OutlinesHost {
  /** The account signed in, or null. */
  uid: () => number | null
  /** The account's outlines, newest first; with `words`, those that hold every word. */
  list: (words: string) => Promise<Listed[]>
  /** One outline with its lines, as the server has it. Throws when the account has none with that id. */
  get: (id: number) => Promise<Outline>
  /** Before an outline is read: every editor open on it has saved what it holds, so what is read is what the reader
   *  sees. Whether nothing is left unsaved (an editor that cannot save does not keep the reading back). */
  settle: (id: number) => Promise<boolean>
  /** Before the outlines are listed or searched: the same for every outline with an editor open. The ids of those
   *  whose editor could not save what it holds. */
  settleAll: () => Promise<number[]>
  /** Before an outline is written to: an editor open on it takes no input from here on and has saved what it holds,
   *  until the function returned is called. That function is given the outline as it was read back after the write,
   *  which the editor then shows; 'unchanged' when nothing was written; 'unknown' when something may have been and
   *  could not be read back, or the outline is gone. It must be called, once, whatever comes of the write. Throws,
   *  with nothing held, when the editor could not save what it holds. */
  hold: (id: number) => Promise<(now: Outline | 'unchanged' | 'unknown') => void>
  /** A new private outline with no lines. */
  create: (title: string) => Promise<Outline>
  /** Saves the lines, or the title. `by`: who is saving (a name made for this one write) and the `updated_at` the
   *  outline had when it was read. The save is then made only if nobody else has saved since (the outline still has
   *  that stamp, or its last save was this writer's), and throws with `status` 409, nothing changed, otherwise. Gives
   *  the outline's new `updated_at`, for the save that follows to name. */
  save: (id: number, items: readonly Item[], by?: { seen?: string; writer: string }) => Promise<string | undefined>
  rename: (id: number, title: string, by?: { seen?: string; writer: string }) => Promise<string | undefined>
  /** For Undo of a creation only: no tool removes an outline. */
  remove: (id: number) => Promise<void>
}

/** The bounds of the tools. `resultBytes` keeps a result under what the server takes for one (20,000 bytes). */
export const LIMITS = { list: 50, readChars: 12_000, resultBytes: 18_000, lines: 60, note: 2000, heading: 200, title: 160, url: 2000, depth: 3, items: 2000, editChars: 40_000 } as const

/** A line as the model reads and writes it: `passage` is the editor's Passage, a `verse` item. It writes one more
 *  kind, `paragraph` (a paragraph of the library by its id), which the app keeps as a link and so reads back as one. */
export interface Line { n?: number; kind: 'passage' | 'note' | 'link' | 'heading'; depth?: number; reference?: string; text?: string; url?: string; cut?: true }
/** The paragraph of the library with that id, when a library tool has given it in this conversation. */
type Given = (id: number) => ParagraphRef | undefined

/** What the jotting was when Ask had written it: Undo acts only on one that is still this. */
export interface Left { at: string; sum: string }
export type JottingUndo =
  | { kind: 'jotting-created'; id: number; left: Left }
  | { kind: 'jotting-edited'; id: number; left: Left; before: { title: string; items: Item[] } }
export type JottingLine =
  | { kind: 'jotting-created'; id: number; title: string; lines: number }
  | { kind: 'jotting-edited'; id: number; title: string; added: number; removed: number; replaced: number; moved: number; renamed: boolean }
/** What an Undo did: `changed` when the jotting was no longer as Ask left it, and nothing was written. `now`: the
 *  jotting as an Undo left it, which is how an earlier write of Ask's may have left it too. */
export type Undone = { did: 'undone'; now?: { id: number; left: Left } } | { did: 'changed' } | { did: 'failed' }

/** `n`: the number the line will have (add, move), or has now (replace, remove). */
export interface ProposalRow { mark: 'add' | 'remove' | 'replace' | 'move'; item: Item; was?: Item; n: number }
/** What a held write would do, for the reader to read before Apply. `renamed`: the title it has now. */
export interface Proposal { kind: 'create' | 'edit'; title: string; renamed?: string; rows: ProposalRow[] }

interface Was extends Left { title: string; items: Item[] }
export type Plan =
  | { kind: 'create'; title: string; items: Item[] }
  | { kind: 'edit'; id: number; was: Was; title: string; items: Item[]; rows: ProposalRow[]; counts: { added: number; removed: number; replaced: number; moved: number } }

const ONE = BRAND.noun.one
const said = (result: unknown, changes: Change[] = []): Outcome => ({ result, changes })
const no = (error: string, more: Record<string, unknown> = {}): Outcome => said({ error, ...more })
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
/** Words as they were handed over: the server has cleaned and trimmed the model's (rs/src/assistant.rs `written`), and
 *  the app changes no character of them. */
const words = (v: unknown) => (typeof v === 'string' ? v : '')
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const utf8 = (s: string) => { let n = 0; for (const ch of s) { const c = ch.codePointAt(0)!; n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4 } return n }
const SIGNED_OUT = `the reader is not signed in: Ask reaches only the ${BRAND.noun.many} kept with their account`
const NOT_READ = `the ${ONE} could not be read just now; nothing was written. Try again in a moment`

export const plain = (i: Item): Item => ({ kind: i.kind, book: i.book ?? null, chapter: i.chapter ?? null, v1: i.v1 ?? null, v2: i.v2 ?? null, text: i.text ?? null, url: i.url ?? null, depth: i.depth })
/** A sum of a title and its lines: two jottings with the same sum have the same title and lines. */
export function sum(title: string, items: readonly Item[]): string {
  const s = JSON.stringify([title, items.map(plain)])
  let a = 0xdeadbeef, b = 0x41c6ce57
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677) }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909)
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909)
  return `${s.length}.${(b >>> 0).toString(36)}.${(a >>> 0).toString(36)}`
}
const leftOf = (o: Outline): Left => ({ at: o.updated_at, sum: sum(o.title, o.items ?? []) })
const isLeft = (o: Outline, left: Left) => o.updated_at === left.at && sum(o.title, o.items ?? []) === left.sum

/** A passage's reference in English, as the model writes one and `parseRef` reads it back. */
export function reference(i: Pick<Item, 'book' | 'chapter' | 'v1' | 'v2'>): string {
  const b = BOOKS[(i.book ?? 0) - 1]
  if (!b || !i.chapter) return ''
  if (i.v1 == null) return `${b.nameEn} ${i.chapter}`
  return `${b.nameEn} ${i.chapter}:${i.v1}${i.v2 != null && i.v2 !== i.v1 ? `-${i.v2}` : ''}`
}
export function toLine(i: Item, n: number): Line {
  const line: Line = { n, kind: i.kind === 'verse' ? 'passage' : i.kind }
  if (i.depth) line.depth = i.depth
  if (i.kind === 'verse') line.reference = reference(i)
  else {
    if (i.text) line.text = i.text
    if (i.kind === 'link' && i.url) line.url = i.url
  }
  return line
}
/** A line the model wrote as the editor would save it, or why the editor would not have it. `given`: the paragraphs
 *  of the library this conversation has been given, for a line that is one of them. `has`: whether the outline being
 *  edited already has that very link (its address and its words), which an edit may carry over as it is. */
export function toItem(v: unknown, given: Given = () => undefined, has: (url: string, text: string | null) => boolean = () => false): Item | string {
  if (!isObj(v)) return 'a line is an object with a kind'
  const depth = v.depth === undefined ? 0 : v.depth
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0 || depth > LIMITS.depth) return `depth is a whole number from 0 to ${LIMITS.depth}`
  const none = { book: null, chapter: null, v1: null, v2: null, text: null, url: null }
  const text = words(v.text)
  switch (v.kind) {
    case 'passage': {
      const given = str(v.reference)
      if (!given) return 'a passage needs a reference, as Romans 8:1'
      if (text.trim() || str(v.url)) return 'a passage is its reference alone: put words in a note of their own'
      const r = parseRef(given, { english: true })
      if (!r) return `${given} is not a chapter, or verses of one chapter, of the Bible`
      if (!isPlace(r.book, r.chapter, r.v1 ?? null) || !isPlace(r.book, r.chapter, r.v2 ?? null)) return `the Bible has no ${given}`
      return { ...none, kind: 'verse', book: r.book, chapter: r.chapter, v1: r.v1 ?? null, v2: r.v2 ?? r.v1 ?? null, depth }
    }
    case 'note':
      if (!text.trim()) return 'a note needs its text'
      if (text.length > LIMITS.note) return `a note is at most ${LIMITS.note} characters: this one is ${text.length}`
      return { ...none, kind: 'note', text, depth }
    case 'heading':
      if (!text.trim()) return 'a heading needs its text'
      if (text.length > LIMITS.heading) return `a heading is at most ${LIMITS.heading} characters`
      return { ...none, kind: 'heading', text, depth }
    case 'link': {
      const url = words(v.url)
      if (!/^https?:\/\/[^\s<>"'`]+$/i.test(url) || url.length > LIMITS.url) return 'a link needs an http or https address in url'
      if (text.length > LIMITS.heading) return `a link's label is at most ${LIMITS.heading} characters`
      const label = text.trim() ? text : null
      // the app's own address of a paragraph of the library is shown and opened as a paragraph line is, whose words
      // are the app's: the model does not write one by hand, with words of its own. A line the outline already has
      // is another matter: an edit may put it back as it read it
      if (paragraphRoute(url) && !has(url, label)) return 'a link to a paragraph of the library is given as a paragraph line, by its id: the app writes its words'
      return { ...none, kind: 'link', url, text: label, depth }
    }
    // A paragraph of the library, by the id a library tool gave: the app writes the line (a link: the writer, the work
    // and the section for its words, the app's own address of the paragraph), so the model gives a writer no words
    // here. Only a paragraph this conversation was given: the model has read no other, and an id it made up is no
    // more a paragraph than Hezekiah 3:1 is a passage.
    case 'paragraph': {
      const id = v.paragraph
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return 'a paragraph needs its id, as a library tool gave it'
      if (text.trim() || str(v.url) || str(v.reference)) return 'a paragraph is its id alone: the app writes its line. Put words in a note of their own'
      const p = given(id)
      if (!p) return `no library tool gave a paragraph ${id} in this conversation: give an id search_library, ministry_on_verse or read_paragraph gave`
      // what is written is what the app reads back as a paragraph's address, or nothing is
      let url = ''
      try { url = paragraphAddress(p) } catch { /* a place that cannot be put in an address */ }
      if (!paragraphRoute(url)) return `the library gave paragraph ${id} no place the app can link to: leave the line out`
      return { ...none, kind: 'link', url, text: paragraphLabel(p), depth }
    }
    default: return 'kind is one of passage, note, link, heading, paragraph'
  }
}

const NONE_SUCH = `the reader has no ${ONE} with that id; list_jottings gives the ids`
/** Whether `id` can be the id of a jotting kept with an account: one below 1 is kept on this device, out of Ask's reach. */
const anId = (id: unknown): id is number => typeof id === 'number' && Number.isInteger(id) && id >= 1
/** The account's own jotting with that id as the server has it, or why there is none for Ask. No editor is asked to
 *  save first: a write and its read-back use this while they have hold of the editor. */
async function owned(id: number, ctx: ActionContext): Promise<Outline | string> {
  const uid = ctx.jottings.uid()
  if (uid === null) return SIGNED_OUT
  let o: Outline
  try { o = await ctx.jottings.get(id) } catch (e) {
    const status = (e as { status?: number }).status
    return status === 403 || status === 404 ? NONE_SUCH : NOT_READ
  }
  return o.id === id && o.user_id === uid ? o : NONE_SUCH
}
/** The account's own jotting with that id, or why there is none for Ask: read after an editor open on it has saved
 *  what it holds, so what Ask reads is what the reader sees. */
async function mine(id: unknown, ctx: ActionContext): Promise<Outline | string> {
  if (ctx.jottings.uid() === null) return SIGNED_OUT
  if (!anId(id)) return NONE_SUCH
  await ctx.jottings.settle(id)
  return owned(id, ctx)
}
type Held = Awaited<ReturnType<OutlinesHost['hold']>>
/** Writes lines and a title on the outline as it was read (`cur`), under a writer's name made for this one write,
 *  which no editor shares: so the server makes neither on an outline that someone else has saved since (from another
 *  device, between the reading and the save), and an editor that has not taken what this write read back is, after
 *  it, behind. 'refused': someone had, and nothing was written. Otherwise what was written is what is read back. */
async function write(ctx: ActionContext, cur: Outline, items: readonly Item[] | null, title: string | null): Promise<'refused' | 'sent'> {
  const writer = newWriter()
  let stamp: string | undefined = cur.updated_at, wrote = false
  try {
    if (items) { stamp = await ctx.jottings.save(cur.id, items, { seen: stamp, writer }); wrote = true }
    if (title !== null) await ctx.jottings.rename(cur.id, title, { seen: stamp, writer })
  } catch (e) {
    if (!wrote && (e as { status?: number }).status === 409) return 'refused'
  }
  return 'sent'
}
const CHANGED_SINCE = `nothing was changed: the ${ONE} has changed since this edit was worked out. Read it again with read_jotting`
/** A write is not made beside words the reader typed in the editor that the server does not have. */
const UNSAVED = `nothing was changed: the ${ONE} is open in the editor, which could not save what the reader has typed there just now. Try again in a moment`
/** Whether the jotting read back has this title and these lines. */
const reads = (o: Outline, title: string, items: readonly Item[]) => sum(o.title, o.items ?? []) === sum(title, items)

// ---------- planning a write ----------

function planCreate(args: Record<string, unknown>, given: Given): { plan: Plan } | { refused: Outcome } {
  const title = words(args.title)
  if (!title.trim() || title.length > LIMITS.title) return { refused: no(`nothing was made: a title of 1 to ${LIMITS.title} characters is needed`) }
  if (!Array.isArray(args.lines)) return { refused: no('nothing was made: lines is a list of lines') }
  if (args.lines.length > LIMITS.lines) return { refused: no(`nothing was made: at most ${LIMITS.lines} lines at once, and this has ${args.lines.length}. Make it with the first of them and add the rest with edit_jotting`) }
  const items: Item[] = [], refused: { line: number; reason: string }[] = []
  args.lines.forEach((v, k) => { const it = toItem(v, given); if (typeof it === 'string') refused.push({ line: k + 1, reason: it }); else items.push(it) })
  if (refused.length) return { refused: no('nothing was made: the lines named in refused cannot be kept. Put them right, or leave them out, and call again', { refused }) }
  return { plan: { kind: 'create', title, items } }
}

async function planEdit(args: Record<string, unknown>, ctx: ActionContext): Promise<{ plan: Plan } | { refused: Outcome }> {
  const nothing = (why: string, more: Record<string, unknown> = {}) => ({ refused: no(`nothing was changed: ${why}`, more) })
  const o = await mine(args.id, ctx)
  if (typeof o === 'string') return { refused: no(o) }
  const was = (o.items ?? []).map(plain)
  if (JSON.stringify(was).length > LIMITS.editChars) return nothing(`this ${ONE} is longer than Ask edits; the reader can change it in the editor, which open_jotting leads to`)
  const n = was.length
  const list = (k: string): unknown[] | null => (args[k] === undefined ? [] : Array.isArray(args[k]) ? args[k] as unknown[] : null)
  const [add, replace, remove, move] = [list('add'), list('replace'), list('remove'), list('move')]
  if (!add || !replace || !remove || !move) return nothing('add, replace, remove and move are each a list')
  if (add.length > LIMITS.lines) return nothing(`at most ${LIMITS.lines} lines are added at once`)
  const title = args.title === undefined ? o.title : words(args.title)
  if (!title.trim() || title.length > LIMITS.title) return nothing(`a title is 1 to ${LIMITS.title} characters`)
  // a line's number is the number it had when the jotting was read, wherever the edit gives one: to replace, remove
  // or move a line, and to say after which line one is added. So an edit that gives any is held to that reading: the
  // jotting as it is now may have other lines at those numbers (the reader's own edit since, or another call of the
  // same reply run before this one). The top (after 0) and the end are the same places whatever has changed.
  const numbered = replace.length + remove.length + move.length > 0 || add.some(v => isObj(v) && v.after !== undefined && v.after !== 0)
  if (numbered && str(args.updated) !== o.updated_at) {
    return nothing(str(args.updated) ? `the ${ONE} has changed since it was read, so its line numbers may be others now. Read it again with read_jotting` : 'to replace, remove or move a line, or to add one after a line by its number, read it first with read_jotting and give updated as it gave it')
  }
  const refused: { part: string; reason: string }[] = []
  /** A link the jotting already has, address and words: an edit may carry it over as it is (`toItem`). */
  const has = (url: string, text: string | null) => was.some(i => i.kind === 'link' && i.url === url && (i.text ?? null) === text)
  const at = (v: unknown, least: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= least && v <= n ? v : null)
  const range = n ? `it has lines 1 to ${n}` : 'it has no lines'
  const newer = new Map<number, Item>(), gone = new Set<number>(), going = new Map<number, number>()
  replace.forEach((v, k) => {
    const part = `replace ${k + 1}`
    const line = isObj(v) ? at(v.line, 1) : null
    if (line === null) return void refused.push({ part, reason: `line is the number of a line: ${range}` })
    if (newer.has(line)) return void refused.push({ part, reason: `line ${line} is replaced twice` })
    const it = toItem((v as Record<string, unknown>).with, ctx.paragraph, has)
    if (typeof it === 'string') return void refused.push({ part, reason: it })
    newer.set(line, it)
  })
  remove.forEach((v, k) => {
    const line = at(v, 1)
    if (line === null) return void refused.push({ part: `remove ${k + 1}`, reason: `each is the number of a line: ${range}` })
    if (newer.has(line)) return void refused.push({ part: `remove ${k + 1}`, reason: `line ${line} is replaced in the same edit` })
    gone.add(line)
  })
  move.forEach((v, k) => {
    const part = `move ${k + 1}`
    const line = isObj(v) ? at(v.line, 1) : null, after = isObj(v) ? at(v.after, 0) : null
    if (line === null || after === null) return void refused.push({ part, reason: `line is the number of a line and after the number of the line to put it after, or 0 for the top: ${range}` })
    if (gone.has(line) || going.has(line)) return void refused.push({ part, reason: `line ${line} is removed or moved already in the same edit` })
    if (after === line) return void refused.push({ part, reason: `line ${line} cannot go after itself` })
    going.set(line, after)
  })
  const adds: { after: number | null; item: Item }[] = []
  add.forEach((v, k) => {
    const part = `add ${k + 1}`
    if (!isObj(v)) return void refused.push({ part, reason: 'each is an object with a line, and after when it does not go at the end' })
    const after = v.after === undefined ? null : at(v.after, 0)
    if (v.after !== undefined && after === null) return void refused.push({ part, reason: `after is the number of the line to add it after, or 0 for the top: ${range}` })
    const it = toItem(v.line, ctx.paragraph, has)
    if (typeof it === 'string') return void refused.push({ part, reason: it })
    adds.push({ after, item: it })
  })
  // a line that is itself leaving its place cannot say where another goes
  const anchors: [string, number][] = [...[...going].map(([line, after]): [string, number] => [`the move of line ${line}`, after]), ...adds.flatMap((a, k): [string, number][] => (a.after === null ? [] : [[`add ${k + 1}`, a.after]]))]
  for (const [part, after] of anchors) if (gone.has(after) || going.has(after)) refused.push({ part, reason: `line ${after} is removed or moved in the same edit: name a line that stays where it is` })
  if (refused.length) return nothing('the parts named in refused cannot be done. Put them right, or leave them out, and call again', { refused })

  const rows: ProposalRow[] = [], items: Item[] = []
  const placed = new Map<number, { item: Item; mark: 'add' | 'move' }[]>()
  const place = (after: number, entry: { item: Item; mark: 'add' | 'move' }) => { placed.set(after, [...(placed.get(after) ?? []), entry]) }
  for (const [line, after] of going) place(after, { item: newer.get(line) ?? was[line - 1], mark: 'move' })
  for (const a of adds) if (a.after !== null) place(a.after, { item: a.item, mark: 'add' })
  const put = (after: number) => { for (const e of placed.get(after) ?? []) { items.push(e.item); rows.push({ mark: e.mark, item: e.item, n: items.length }) } }
  put(0)
  was.forEach((it, k) => {
    const line = k + 1
    if (gone.has(line)) rows.push({ mark: 'remove', item: it, n: line })
    else if (!going.has(line)) {
      const now = newer.get(line)
      items.push(now ?? it)
      if (now) rows.push({ mark: 'replace', item: now, was: it, n: line })
    }
    put(line)
  })
  for (const a of adds) if (a.after === null) { items.push(a.item); rows.push({ mark: 'add', item: a.item, n: items.length }) }
  if (items.length > LIMITS.items) return nothing(`a ${ONE} has at most ${LIMITS.items} lines`)
  if (title === o.title && JSON.stringify(items) === JSON.stringify(was)) return nothing(`the ${ONE} is already so`)
  const counts = { added: adds.length, removed: gone.size, replaced: [...newer.keys()].filter(line => !going.has(line)).length, moved: going.size }
  return { plan: { kind: 'edit', id: o.id, was: { ...leftOf(o), title: o.title, items: was }, title, items, rows, counts } }
}

/** A write as it would be made, with nothing written: every line checked, and for an edit the jotting read. */
export async function planWrite(name: string, args: Record<string, unknown>, ctx: ActionContext): Promise<{ plan: Plan } | { refused: Outcome }> {
  if (ctx.jottings.uid() === null) return { refused: no(SIGNED_OUT) }
  if (name === 'create_jotting') return planCreate(args, ctx.paragraph)
  if (name === 'edit_jotting') return planEdit(args, ctx).catch(() => ({ refused: no(NOT_READ) }))
  return { refused: no(`${name} writes no ${ONE}`) }
}

export const proposalOf = (plan: Plan): Proposal => plan.kind === 'create'
  ? { kind: 'create', title: plan.title, rows: plan.items.map((item, k) => ({ mark: 'add', item, n: k + 1 })) }
  : { kind: 'edit', title: plan.title, ...(plan.title !== plan.was.title ? { renamed: plan.was.title } : null), rows: plan.rows }

// ---------- writing ----------

/** How a write came to be made, as the model is told it. A write's result says that, the jotting's id and how many
 *  lines it has, and nothing of what the jotting says: the server does not count it as foreign text, so it must carry
 *  none (a jotting's title may be another person's). */
export const HOW = { once: 'at once', tap: 'when the reader tapped Apply on what the app showed them' } as const
/** What the model is told of a held write the reader did not apply. */
export const notApplied = (): Outcome => no('not applied: the app showed the reader what this would write, and they chose not to apply it. Nothing was written', { applied: false })

/** Writes a plan. An edit is written only to the jotting it was planned on: one that has changed since is left alone. */
export async function applyPlan(plan: Plan, ctx: ActionContext, how: keyof typeof HOW): Promise<Outcome> {
  const uid = ctx.jottings.uid()
  if (uid === null) return no(SIGNED_OUT)
  if (plan.kind === 'create') {
    let made: Outline
    try { made = await ctx.jottings.create(plan.title) } catch { return no(`the ${ONE} could not be made just now; nothing was written. Try again in a moment`) }
    // made on this device and not with the account (the session ended meanwhile): not Ask's to make
    if (made.id < 1 || made.user_id !== uid) { await ctx.jottings.remove(made.id).catch(() => {}); return no(SIGNED_OUT) }
    let now: Outline
    try {
      // the lines of a jotting made a moment ago, which nobody else has: this save names no stamp, and need not
      if (plan.items.length) await ctx.jottings.save(made.id, plan.items)
      now = await ctx.jottings.get(made.id)
    } catch {
      // its lines did not go in: an empty one with this title is not what was asked for
      await ctx.jottings.remove(made.id).catch(() => {})
      return no(`the ${ONE} could not be made just now; nothing was written. Try again in a moment`)
    }
    const lines = (now.items ?? []).length
    const change: Change = { line: { kind: 'jotting-created', id: now.id, title: now.title, lines }, undo: { kind: 'jotting-created', id: now.id, left: leftOf(now) } }
    // made is said of what was read back: the title and the lines asked for, and nothing else
    return reads(now, plan.title, plan.items)
      ? said({ id: now.id, lines, applied: HOW[how] }, [change])
      : said({ error: `the ${ONE} was made, but it is not as it was written: it has ${lines} lines. Read it with read_jotting before going on`, id: now.id }, [change])
  }
  // the editor, if the jotting is open in one, takes no input from here until this write has been read back, and has
  // saved what it holds: so nothing is typed into the lines while they are written, the read-back is of this write, and
  // the editor, which then takes it whole, never saves the lines of before over it
  let letGo: Held
  try { letGo = await ctx.jottings.hold(plan.id) } catch { return no(UNSAVED) }
  let now: Outline | null = null
  let after: Outline | 'unchanged' | 'unknown' = 'unchanged'
  try {
    const cur = await owned(plan.id, ctx)
    if (typeof cur === 'string') return no(cur)
    if (!isLeft(cur, plan.was)) return no(CHANGED_SINCE)
    after = 'unknown'
    const went = await write(ctx, cur, JSON.stringify(plan.items) !== JSON.stringify(plan.was.items) ? plan.items : null, plan.title !== plan.was.title ? plan.title : null)
    try { now = await ctx.jottings.get(plan.id) } catch { return no(`the ${ONE} could not be read back, so it is not known whether it was changed. Read it with read_jotting before going on`) }
    // the editor has the outline as it is now, whoever changed it
    after = now
    if (went === 'refused') return no(CHANGED_SINCE)
  } finally { letGo(after) }
  if (isLeft(now, plan.was)) return no(`the ${ONE} could not be changed just now; nothing was written. Try again in a moment`)
  // a part that was written is the reader's to undo, whether or not the rest followed it
  const renamed = now.title !== plan.was.title
  const change: Change = {
    line: { kind: 'jotting-edited', id: plan.id, title: now.title, ...plan.counts, renamed },
    undo: { kind: 'jotting-edited', id: plan.id, left: leftOf(now), before: { title: plan.was.title, items: plan.was.items } },
  }
  const lines = (now.items ?? []).length
  // applied is said of what was read back: the title and the lines of the plan, and nothing else
  return reads(now, plan.title, plan.items)
    ? said({ id: plan.id, lines, applied: HOW[how] }, [change])
    : said({ error: `the ${ONE} is not as this edit would have left it: only part of it was written, or it was changed from elsewhere meanwhile. It now has ${lines} lines. Read it with read_jotting before going on`, id: plan.id }, [change])
}

/** Undo of a write: only while the jotting is exactly as that write left it. It is undone when the jotting read back
 *  is as it was before the write, and not otherwise. */
export async function undoJotting(u: JottingUndo, ctx: ActionContext): Promise<Undone> {
  const uid = ctx.jottings.uid()
  if (uid === null) return { did: 'failed' }
  // as for a write: the editor open on it takes no input until what was put back has been read back
  let letGo: Held
  try { letGo = await ctx.jottings.hold(u.id) } catch { return { did: 'failed' } }
  let after: Outline | 'unchanged' | 'unknown' = 'unchanged'
  try {
    let cur: Outline
    try { cur = await ctx.jottings.get(u.id) } catch (e) {
      const status = (e as { status?: number }).status
      return { did: status === 403 || status === 404 ? 'changed' : 'failed' }
    }
    if (cur.user_id !== uid || !isLeft(cur, u.left)) return { did: 'changed' }
    after = 'unknown'
    if (u.kind === 'jotting-created') { await ctx.jottings.remove(u.id); return { did: 'undone' } }
    const went = await write(ctx, cur, JSON.stringify((cur.items ?? []).map(plain)) !== JSON.stringify(u.before.items) ? u.before.items : null, cur.title !== u.before.title ? u.before.title : null)
    const now = await ctx.jottings.get(u.id)
    after = now
    // changed from elsewhere between the reading and the save: nothing was put back
    if (went === 'refused') return { did: 'changed' }
    return reads(now, u.before.title, u.before.items) ? { did: 'undone', now: { id: u.id, left: leftOf(now) } } : { did: 'failed' }
  } catch { return { did: 'failed' } } finally { letGo(after) }
}

// ---------- the tools ----------

/** The reader's own jottings as a list gives them: each by id, title and day, the newest first, at most fifty and
 *  under what the server takes for a result; how many there are; and a word on any whose open editor could not save. */
function listing(all: readonly Listed[], behind: readonly number[]) {
  const jottings: { id: number; title: string; updated: string }[] = []
  let bytes = 0
  for (const o of all.slice(0, LIMITS.list)) {
    const row = { id: o.id, title: o.title.slice(0, LIMITS.title), updated: o.updated_at.slice(0, 10) }
    bytes += utf8(JSON.stringify(row)) + 1
    if (bytes > LIMITS.resultBytes) break
    jottings.push(row)
  }
  return {
    jottings, total: all.length,
    ...(all.length > jottings.length ? { more: 'only the newest are listed: give words to find the others' } : null),
    ...(behind.length ? { note: `${ONE} ${behind.join(', ')} is open in the editor with changes that could not be saved just now: its title here, and a search of its words, may be behind what the reader sees` } : null),
  }
}
/** The account's own jottings that hold every one of `words` (the server's search: in the title or in a line), after
 *  every open editor has saved: a title or a line typed a moment ago is on the server only then. `behind`: those
 *  whose editor could not save. Throws when they cannot be read. */
async function found(words: string, ctx: ActionContext): Promise<{ all: Listed[]; behind: number[] }> {
  const behind = (await ctx.jottings.settleAll().catch(() => [] as number[])).filter(id => id > 0)
  return { all: (await ctx.jottings.list(words)).filter(o => o.id > 0), behind }
}
const NOT_LISTED = `the ${BRAND.noun.many} could not be read just now. Try again in a moment`
/** The words of a title as the search takes them (lib/outlineMatch.ts `searchWords`, which is the server's
 *  `search_mine`): case aside, cut at whatever is not a letter, a figure, an apostrophe or a colon. All of them: the
 *  search itself keeps the first eight. */
const wordsOf = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}':]+/u).filter(Boolean)

/** One jotting as the model reads it: its title and its lines by number, cut at the bounds. */
function reading(o: Outline): Outcome {
  const items = (o.items ?? []).map(plain)
  const head = { id: o.id, title: o.title, updated: o.updated_at, ...(o.description ? { description: o.description.slice(0, 500) } : null) }
  const lines: Line[] = []
  let chars = (o.description ?? '').slice(0, 500).length, bytes = utf8(JSON.stringify(head)) + 200, cut = false
  for (const [k, it] of items.entries()) {
    const line = toLine(it, k + 1)
    const size = (line.reference ?? '').length + (line.text ?? '').length + (line.url ?? '').length
    if (chars + size > LIMITS.readChars) {
      // the line that crosses the bound is given as far as the bound, when what is left of it is worth reading
      const room = LIMITS.readChars - chars - (size - (line.text ?? '').length)
      if (line.text && room >= 200) { line.text = line.text.slice(0, room); line.cut = true } else { cut = true; break }
    }
    bytes += utf8(JSON.stringify(line)) + 1
    if (bytes > LIMITS.resultBytes) { cut = true; break }
    lines.push(line)
    chars += size
    if (line.cut) { cut = true; break }
  }
  return said({ ...head, lines, ...(cut ? { cut: `cut at ${LIMITS.readChars} characters: it has ${items.length} lines, and those after line ${lines.length} were not read` } : null) })
}

export const JOTTING_TOOLS: Record<string, Executor> = {
  list_jottings: async (args, ctx) => {
    if (ctx.jottings.uid() === null) return no(SIGNED_OUT)
    try { const { all, behind } = await found(str(args.words).slice(0, 200), ctx); return said(listing(all, behind)) } catch { return no(NOT_LISTED) }
  },
  /**
   * By its id; or, with none, by words of its title: the jotting the reader named ("my jotting on prayer"), read in
   * one call where a list and then a reading by id were two. The matching is the list's own, so a jotting found
   * there is found here: every word, in the title or in a line. Of several, the one alone in holding every word in
   * its title is the one the reader named (a jotting called Prayer, beside another whose note speaks of prayer).
   * Otherwise several are given as a list gives them, with no line of any, and the model reads one by its id; a list
   * that is full (fifty) may not be all of them, and is never taken for one match.
   */
  read_jotting: async (args, ctx) => {
    if (args.id !== undefined) { const o = await mine(args.id, ctx); return typeof o === 'string' ? no(o) : reading(o) }
    if (ctx.jottings.uid() === null) return no(SIGNED_OUT)
    const words = wordsOf(str(args.title).slice(0, 200))
    if (!words.length) return no('give the id a tool gave, or words of the title in title')
    // the search takes eight words and no more (lib/outlineMatch.ts `searchWords`, as the server's): a ninth would be
    // left out of the matching unseen, and the one outline holding the first eight read as if it held them all
    if (words.length > searchWords(words.join(' ')).length) return no('a title takes at most eight words: give the few that tell this one from the others')
    let all: Listed[], behind: number[]
    try { ({ all, behind } = await found(words.join(' '), ctx)) } catch { return no(NOT_LISTED) }
    if (!all.length) return no(`the reader has no ${ONE} with those words in its title or its lines; list_jottings lists them all`)
    const titled = all.filter(o => { const title = o.title.toLowerCase(); return words.every(w => title.includes(w)) })
    const one = all.length >= LIMITS.list ? null : titled.length === 1 ? titled[0] : all.length === 1 ? all[0] : null
    if (!one) return said({ ...listing(all, behind), several: `none was read: more than one of the reader's ${BRAND.noun.many} holds those words. Read the one the reader means by its id` })
    const o = await mine(one.id, ctx)
    return typeof o === 'string' ? no(o) : reading(o)
  },
  open_jotting: async (args, ctx) => {
    const o = await mine(args.id, ctx)
    if (typeof o === 'string') return no(o)
    ctx.navigate({ pathname: '/outlines/[id]', params: { id: String(o.id) } })
    // only that it opened: the model reads one with read_jotting, whose text is counted as foreign
    return said({ id: o.id, opened: true })
  },
  create_jotting: async (args, ctx) => { const p = await planWrite('create_jotting', args, ctx); return 'plan' in p ? applyPlan(p.plan, ctx, 'once') : p.refused },
  edit_jotting: async (args, ctx) => { const p = await planWrite('edit_jotting', args, ctx); return 'plan' in p ? applyPlan(p.plan, ctx, 'once') : p.refused },
}
