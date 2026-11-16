/**
 * Ask's conversation (docs/ASSISTANT.md), kept on this device and nowhere else: the messages as the model sees them,
 * and what the screen shows of them. A turn posts the conversation to `/api/assistant/turn` and reads its events as
 * they stream; when the server hands over the app's tools, they run here (assistantActions.ts) and the conversation
 * goes back with the server's token. The store lives outside the screen, so a turn that opens another screen goes on.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { fetch as expoFetch } from 'expo/fetch'
import { useSyncExternalStore } from 'react'
import { CAN, WRITES, callNames, toolRow, type AssistantState, type CapReached, type ChatMessage, type ParagraphRef, type Sentence, type ToolCall, type TurnRequest } from '@shared/assistantTools'
import { N_, t } from '@shared/i18n'
import { cachedGet, getApiBase, getToken, loadApiBase } from './api'
import { deviceId } from './device'
import { APP_TOOLS, undo, type ActionContext, type Change, type Outcome } from './assistantActions'
import { applyPlan, notApplied, planWrite, proposalOf, type Proposal } from './assistantOutlines'
import { withVerses } from './askRefs'

/** What the screen shows, in order. `changed`: Undo found the reader's own later work there, and did nothing.
 *  `lapsed`: the reader answered a proposal after the server's hand-over of it had run out; what they chose stands,
 *  and the turn does not go on. */
export type Shown =
  | { kind: 'reader'; text: string }
  | { kind: 'answer'; sentences: Sentence[] }
  | { kind: 'change'; change: Change; undone: boolean; changed?: boolean }
  | { kind: 'cap'; cap: CapReached['cap']; resetsAt: string }
  | { kind: 'lapsed' }
  | { kind: 'error'; text: string }
/** `places`: where each paragraph a library tool gave sits in the library, by id, for the citations and open_paragraph
 *  once the messages hold only the ids. */
export interface Conversation { messages: ChatMessage[]; shown: Shown[]; places: Record<string, ParagraphRef> }
/** A turn in flight: the words of the answer so far. `draft` is a feedback message waiting for the reader to read;
 *  `proposal` is a write the server held, waiting for the reader's tap on Apply. Neither is kept: a proposal the reader
 *  never taps is never written. */
export interface Live { asking: boolean; words: string; draft: string | null; proposal: Proposal | null }

const KEY = 'berean_assistant'
/** Reader messages the screen keeps, and those whose messages are kept and posted: up to SENT_MOST, the most the server
 *  shows the model (rs/src/assistant.rs HISTORY), cut back to SENT when one more comes. The window moves in steps, not
 *  at every message: between two cuts each post begins with all of the post before it, which the model's provider keeps
 *  in its cache and reads at a tenth of the price. SENT_BYTES is the most the messages may be, every result as its
 *  stand-in, while more than SENT are kept: past it the window is SENT again, as it was before the steps, so a
 *  conversation of long answers is no sooner too long for the server. A request to the model is 96 KB at most: the
 *  server's prompt and tools are 13 KB of it and a message's two readings of the library up to 15 KB each, which
 *  leaves 53 KB for the conversation. */
const KEPT = 30
const SENT = 8
const SENT_MOST = 12
const SENT_BYTES = 40_000
/** The bytes of `s` in UTF-8. */
const bytes = (s: string) => { let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c < 0xe000) ? 2 : 3 } return n }
/** The characters of jottings as they were before Ask's edits that are kept for their Undo, newest first. */
const UNDO_CHARS = 400_000
const EMPTY: Conversation = { messages: [], shown: [], places: {} }
const IDLE: Live = { asking: false, words: '', draft: null, proposal: null }

let conv: Conversation = EMPTY
let live: Live = IDLE
/** Whose conversation this is: another account signed in on the device starts with none. */
let owner: number | null = null
let loaded: Promise<void> | null = null
/** Which conversation this is: New conversation begins another, and so does another account. Whatever is waited for
 *  (the stored conversation, a post, a tool, an Undo) belongs to the conversation it began in, and keeps nothing in
 *  the one that has taken its place: a tool's result there would answer no call, and the server takes no such
 *  conversation (rs/src/assistant.rs well_formed). */
let began = 0
let aborter: AbortController | null = null
let host: Omit<ActionContext, 'paragraph' | 'feedback'> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(l => l())
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

function commit(next: Conversation) {
  conv = next
  emit()
  AsyncStorage.setItem(KEY, JSON.stringify({ uid: owner, ...trimmed(next) })).catch(() => {})
}
function setLive(next: Partial<Live>) { live = { ...live, ...next }; emit() }

/** The tools whose result is about one jotting: once the reader has written again, its id is all that is kept of it. */
const ABOUT_ONE = ['read_jotting', 'open_jotting', ...WRITES]
/** A tool's result once the reader has written again, as the server shows it to the model (rs/src/assistant.rs
 *  stand_in): the ids of the library paragraphs a server tool gave, the id of the one jotting it was about, or that it
 *  was done. */
export function standIn(name: string | undefined, content: string): string {
  let v: { paragraphs?: { id?: unknown }[]; id?: unknown; jotting?: { id?: unknown } } | null = null
  try { v = JSON.parse(content) } catch { /* none */ }
  const ids = name && toolRow(name)?.runs === 'server' && Array.isArray(v?.paragraphs) ? v.paragraphs.map(p => p?.id).filter((id): id is number => Number.isInteger(id)) : []
  if (ids.length) return JSON.stringify({ paragraphs: ids.map(id => ({ id })) })
  // a result kept from an earlier message is its stand-in already: the id is read from that shape too
  const id = name && ABOUT_ONE.includes(name) ? [v?.id, v?.jotting?.id].find((x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0) : undefined
  return JSON.stringify(id ? { jotting: { id } } : { done: true })
}
/** The conversation in the form the server keeps, which is the form kept on the device and the one posted: the reader
 *  messages of the window (up to SENT_MOST, the last SENT once there are more or they are more than SENT_BYTES) with
 *  what followed each, every tool's result before the latest reader message as its stand-in, the last KEPT reader
 *  messages on the screen, and the places of the paragraphs either still names. */
export function trimmed(c: Conversation): Conversation {
  const readers = c.messages.flatMap((m, i) => (m.role === 'user' ? [i] : []))
  const latest = readers[readers.length - 1] ?? 0
  const names = callNames(c.messages)
  // before the latest reader message, a result is its stand-in, and a write of a jotting is left without its lines,
  // which the model wrote after whatever it had read (rs/src/assistant.rs prompt)
  const spent = (call: ToolCall): ToolCall => (WRITES.includes(call.function.name) ? { ...call, function: { ...call.function, arguments: '{}' } } : call)
  const past = (m: ChatMessage): ChatMessage => (m.role === 'tool' ? { ...m, content: standIn(names.get(m.tool_call_id), m.content) }
    : m.role === 'assistant' && m.tool_calls?.some(call => WRITES.includes(call.function.name)) ? { ...m, tool_calls: m.tool_calls.map(spent) }
    : m)
  const all = c.messages.map((m, i) => (i < latest ? past(m) : m))
  // measured with the latest message as it will be once it is past, as the next post has it: what is kept while a turn
  // runs is then the window the turn was posted with
  const posted = () => bytes(JSON.stringify(c.messages.map(past)))
  const cut = readers.length > SENT_MOST || (readers.length > SENT && posted() > SENT_BYTES)
  const messages = cut ? all.slice(readers[readers.length - SENT]) : all
  const shownReaders = c.shown.flatMap((s, i) => (s.kind === 'reader' ? [i] : []))
  const shownFrom = shownReaders.length > KEPT ? shownReaders[shownReaders.length - KEPT] : 0
  // a jotting as it was before an edit is kept for that edit's Undo: the newest UNDO_CHARS of them, and none for a line
  // already undone. A line whose jotting is no longer kept offers no Undo.
  let room = UNDO_CHARS
  const shown = c.shown.slice(shownFrom).reduceRight<Shown[]>((out, s) => {
    if (s.kind === 'change' && s.change.undo.kind === 'jotting-edited') {
      const size = JSON.stringify(s.change.undo.before).length
      if (s.undone || s.changed || size > room) s = { ...s, change: { ...s.change, undo: { kind: 'none' } } }
      else room -= size
    }
    out.unshift(s)
    return out
  }, [])
  const named = new Set([...shown.flatMap(s => (s.kind === 'answer' ? s.sentences.flatMap(x => x.ids) : [])), ...messages.flatMap(m => (m.role === 'tool' ? placesIn(m.content).map(p => p.id) : []))])
  return { messages, shown, places: Object.fromEntries(Object.entries(c.places).filter(([id]) => named.has(Number(id)))) }
}
/** The paragraphs a tool's result gives, with their places and without their text. */
function placesIn(content: string): ParagraphRef[] {
  try {
    return ((JSON.parse(content) as { paragraphs?: ParagraphRef[] }).paragraphs ?? []).filter(p => Number.isInteger(p.id))
      .map(({ id, author, work, n, para, section }) => ({ id, author, work, n, para, section }))
  } catch { return [] }
}

/** Whether every call has an id of its own and every tool message answers, once, a call made before it: what the server
 *  takes of a conversation. */
function sound(messages: readonly ChatMessage[]): boolean {
  const called = new Set<string>(), answered = new Set<string>()
  for (const m of messages) {
    if (m.role === 'assistant') for (const call of m.tool_calls ?? []) { if (!call.id || called.has(call.id)) return false; called.add(call.id) }
    else if (m.role === 'tool') { if (!called.has(m.tool_call_id) || answered.has(m.tool_call_id)) return false; answered.add(m.tool_call_id) }
  }
  return true
}

/** The conversation kept on the device for account `uid`; one kept for another account is dropped. */
export function loadConversation(uid: number): Promise<void> {
  if (owner === uid && loaded) return loaded
  aborter?.abort()
  owner = uid
  conv = EMPTY
  const here = ++began
  setLive(IDLE)
  loaded = AsyncStorage.getItem(KEY).then(raw => {
    if (!raw) return
    try {
      const c = JSON.parse(raw) as Conversation & { uid?: number }
      if (c.uid !== uid) { AsyncStorage.removeItem(KEY).catch(() => {}); return }
      // one kept by a build that could leave a result with no call in it (New conversation while a tool ran) is
      // shown as it was, and its messages begin again: the server would refuse them at every message
      if (Array.isArray(c.messages) && Array.isArray(c.shown) && began === here) { conv = { messages: sound(c.messages) ? c.messages : [], shown: c.shown, places: c.places ?? {} }; emit() }
    } catch { /* a conversation that cannot be read is gone */ }
  }, () => {})
  return loaded
}
export const useConversation = (): Conversation => useSyncExternalStore(subscribe, () => conv, () => conv)
export const useLive = (): Live => useSyncExternalStore(subscribe, () => live, () => live)

/** The app's part of the tools' context, kept fresh by the root (AssistantHost in app/_layout.tsx). */
export function setActionHost(h: typeof host) { host = h }

/** Where a paragraph a library tool gave in this conversation sits, by its id. */
export const placeOf = (c: Conversation, id: number): ParagraphRef | undefined => c.places[String(id)]
/** The words of an answer as they stream, its citations left for the finished answer. */
export const streamed = (words: string) => words.replace(/\s*\[[\d,; ]*\]?$/, '').replace(/\s*\[[\d,; ]+\]/g, '')
  // a line's list mark, markdown the model wrote though it is asked for plain prose (the answer's sentences come
  // without it too, rs/src/assistant.rs `sentences`). Nothing else is taken out here: the server takes the model's
  // asterisks out before it reads the words for a name, and the app must not join what the server judged apart
  .replace(/^[ \t]*[-•][ \t]+/gm, '')

const TOO_LONG = N_('This conversation is too long for Ask. Start a new conversation to go on.')

/** Starts a new conversation: the old one is gone from the device. */
export function newConversation() {
  aborter?.abort()
  began++
  conv = EMPTY
  setLive(IDLE)
  AsyncStorage.removeItem(KEY).catch(() => {})
}
export function stop() { aborter?.abort() }
export function closeDraft() { setLive({ draft: null }) }

/** The reader's answer to the proposal on screen: Apply writes it, once; anything else leaves it unwritten. */
let decide: ((tapped: 'apply' | 'dismiss') => void) | null = null
export function applyProposal() { decide?.('apply') }
export function dismissProposal() { decide?.('dismiss') }
/**
 * A write the server held (docs/ASSISTANT.md): worked out with nothing written, shown to the reader as a proposal,
 * and written only on their tap on Apply. Whether a write is held is the server's word in its own event; the call's
 * arguments are the model's and cannot say. Null when the turn ended first (Stop, another account, a new
 * conversation): nothing was written, and the call goes unanswered. A turn that ends after the tap, while the write is
 * being made, has its write all the same: the reader asked for it.
 */
async function hold(name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<Outcome | null> {
  if (!WRITES.includes(name)) return { result: { error: 'not applied: the app holds only a write for the reader to apply, and this is not one' }, changes: [] }
  const planned = await planWrite(name, args, context())
  if ('refused' in planned) return planned.refused
  if (signal.aborted) return null
  const tapped = await new Promise<'apply' | 'dismiss' | 'stopped'>(resolve => {
    decide = resolve
    signal.addEventListener('abort', () => resolve('stopped'), { once: true })
    setLive({ proposal: proposalOf(planned.plan) })
  })
  decide = null
  setLive({ proposal: null })
  if (tapped === 'stopped' || signal.aborted) return null
  return tapped === 'apply' ? applyPlan(planned.plan, context(), 'tap') : notApplied()
}

export async function ask(text: string) {
  const content = text.trim()
  if (!content || live.asking || !loaded) return
  const here = began
  await loaded
  if (began !== here) return
  // posted as the server keeps it, so the hand-over's digest of what was posted is what the app goes on from
  commit(trimmed({ ...conv, messages: [...conv.messages, { role: 'user', content }], shown: [...conv.shown, { kind: 'reader', text: content }] }))
  await turn({ messages: conv.messages })
}

/** Undoes a change line's change, once. A write of a jotting is undone only while the jotting is as Ask left it:
 *  otherwise the line says it has changed since, and nothing is written. */
export async function undoShown(index: number) {
  const s = conv.shown[index]
  if (s?.kind !== 'change' || s.undone || s.changed || !host) return
  const here = began
  const r = await undo(s.change.undo, context())
  if (began !== here || conv.shown[index] !== s) return
  if (r.did === 'failed') { note({ kind: 'error', text: t('That could not be undone just now. Check your connection and try again.') }); return }
  const now = r.did === 'undone' ? r.now : undefined
  commit({ ...conv, shown: conv.shown.map((x, i) => {
    if (i === index) return r.did === 'undone' ? { ...s, undone: true } : { ...s, changed: true }
    // the jotting is again as an earlier write of Ask's left it: that write's Undo holds for it as it is now
    const u = x.kind === 'change' && !x.undone && !x.changed ? x.change.undo : null
    return now && x.kind === 'change' && u && (u.kind === 'jotting-edited' || u.kind === 'jotting-created') && u.id === now.id && u.left.sum === now.left.sum
      ? { ...x, change: { ...x.change, undo: { ...u, left: now.left } } } : x
  }) })
}

function context(): ActionContext {
  if (!host) throw new Error('Ask has no app to act in')
  return { ...host, paragraph: id => placeOf(conv, id), feedback: message => setLive({ draft: message }) }
}

/** One post of the conversation and its stream, then the app's tools and the next post while the server hands any. */
async function turn(req: TurnRequest) {
  const ctl = new AbortController()
  aborter = ctl
  setLive({ asking: true, words: '' })
  let next: Next | null = { req, answered: false }
  const here = began
  try {
    while (next) next = await post(next.req, ctl.signal, here, next.answered)
  } catch (e) {
    if (!ctl.signal.aborted && began === here) note({ kind: 'error', text: t('Ask could not be reached. Check your connection and try again.') })
  } finally {
    if (aborter === ctl) { aborter = null; setLive({ asking: false, words: '', proposal: null }) }
  }
}
function note(s: Shown) { commit({ ...conv, shown: [...conv.shown, s] }) }

/** What a turn posts next. `answered`: among the calls it answers is a proposal the reader answered, however long
 *  after it was shown. */
interface Next { req: TurnRequest; answered: boolean }

/** One post of the turn begun in conversation `here`. Once the reader stops or starts a new conversation, or another
 *  account opens Ask, no further tool runs and nothing goes back to the server; and nothing is kept unless `here` is
 *  still the conversation. `answered`: this post goes on from a proposal the reader answered. */
async function post(req: TurnRequest, signal: AbortSignal, here: number, answered: boolean): Promise<Next | null> {
  const ours = () => began === here
  const who = owner
  const keep = (next: Conversation) => { if (ours()) commit(next) }
  const note = (s: Shown) => keep({ ...conv, shown: [...conv.shown, s] })
  await loadApiBase()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const device = await deviceId()
  if (device) headers['x-jottings-device'] = device
  const send = Platform.OS === 'web' ? globalThis.fetch : (expoFetch as unknown as typeof globalThis.fetch)
  const res = await send(`${getApiBase()}/api/assistant/turn`, { method: 'POST', headers, body: JSON.stringify({ ...req, can: CAN }), signal })
  if (res.status === 429) {
    const cap = await res.json() as CapReached
    note({ kind: 'cap', cap: cap.cap, resetsAt: cap.resets_at })
    return null
  }
  // the hand-over of a held write is good for an hour, and the reader may take longer over a proposal: what they
  // chose was done (the write has its line and its Undo), the server will not go on from it, and nothing went wrong
  if (res.status === 400 && answered) { note({ kind: 'lapsed' }); return null }
  if (!res.ok || !res.body) {
    note({ kind: 'error', text: res.status === 401 ? t('Ask needs you to be signed in.') : res.status === 413 ? t(TOO_LONG) : t('Ask could not answer just now. Try again in a moment.') })
    return null
  }
  let pending: { calls: ToolCall[]; token: string; held?: string[] } | null = null
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let end: number
    while ((end = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, end)
      buf = buf.slice(end + 2)
      const name = /^event: (.*)$/m.exec(block)?.[1]
      const data = block.split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('\n')
      if (!name || !data) continue
      const v = JSON.parse(data)
      if (name === 'text') setLive({ words: live.words + v.t })
      else if (name === 'message') {
        const m = v as ChatMessage
        const found = m.role === 'tool' ? Object.fromEntries(placesIn(m.content).map(p => [String(p.id), p])) : {}
        keep({ ...conv, messages: [...conv.messages, m], places: { ...conv.places, ...found } })
        if ((v as ChatMessage).role === 'assistant' && (v as { tool_calls?: unknown[] }).tool_calls?.length) setLive({ words: '' })
      // a sentence that gives a verse the Bible tools supplied for this message rests on it: settled here, while the
      // tools' results are still whole (lib/askRefs.ts)
      } else if (name === 'answer') { note({ kind: 'answer', sentences: withVerses(v.sentences, conv.messages) }); setLive({ words: '' }) }
      else if (name === 'pending') pending = v
      else if (name === 'error') note({ kind: 'error', text: v.too_long ? t(TOO_LONG) : t('Ask could not answer just now. Try again in a moment.') })
    }
  }
  if (!pending || signal.aborted) return null
  const held = new Set(Array.isArray(pending.held) ? pending.held : [])
  let proposed = false
  for (const call of pending.calls) {
    if (signal.aborted || !ours()) break
    const run = APP_TOOLS[call.function.name]
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(call.function.arguments || '{}') } catch { /* the executor says what is missing */ }
    const failed = (): Outcome => ({ result: { error: 'the app could not do this' }, changes: [] })
    const out = !run ? { result: { error: `there is no tool ${call.function.name}` }, changes: [] }
      : held.has(call.id) ? await hold(call.function.name, args, signal).catch(failed)
      : await run(args, context()).catch(failed)
    // a proposal the turn ended on: nothing was written, and nothing answers the call
    if (!out) break
    const lines = out.changes.map((change): Shown => ({ kind: 'change', change, undone: false }))
    if (ours()) {
      // kept as each tool ends: its result, and the line of what it changed with its Undo, which the reader sees at
      // once, while a proposal later in the same reply waits
      proposed ||= held.has(call.id)
      commit({ ...conv, messages: [...conv.messages, { role: 'tool', tool_call_id: call.id, content: JSON.stringify(out.result) }], shown: [...conv.shown, ...lines] })
    // the reader started a new conversation while this tool ran (a write they had tapped Apply on, a bookmark): it is
    // made all the same, so its line and its Undo are theirs to have, in the conversation they are now in. Nothing
    // else of the turn is kept there, and nothing at all under another account
    } else if (owner === who && lines.length) commit({ ...conv, shown: [...conv.shown, ...lines] })
  }
  return signal.aborted || !ours() ? null : { req: { messages: conv.messages, token: pending.token }, answered: proposed }
}

/** Whether Ask is on at this server: asked once a minute at most. */
export function useAssistantOn(): boolean | null {
  return useSyncExternalStore(subscribeOn, () => on, () => on)
}
let on: boolean | null = null
let onAsked = 0
const onListeners = new Set<() => void>()
function subscribeOn(l: () => void) {
  onListeners.add(l)
  if (Date.now() - onAsked > 60_000) {
    onAsked = Date.now()
    cachedGet<AssistantState>('/assistant', { ttlMs: 60_000 }).then(s => s.on, () => false).then(v => { if (v !== on) { on = v; onListeners.forEach(f => f()) } })
  }
  return () => { onListeners.delete(l) }
}
