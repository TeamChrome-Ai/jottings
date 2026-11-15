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
import { toolRow, type AssistantState, type CapReached, type ChatMessage, type ParagraphRef, type Sentence, type ToolCall, type TurnRequest } from '@shared/assistantTools'
import { N_, t } from '@shared/i18n'
import { cachedGet, getApiBase, getToken, loadApiBase } from './api'
import { deviceId } from './device'
import { APP_TOOLS, undo, type ActionContext, type Change } from './assistantActions'
import { withVerses } from './askRefs'

/** What the screen shows, in order. */
export type Shown =
  | { kind: 'reader'; text: string }
  | { kind: 'answer'; sentences: Sentence[] }
  | { kind: 'change'; change: Change; undone: boolean }
  | { kind: 'cap'; cap: CapReached['cap']; resetsAt: string }
  | { kind: 'error'; text: string }
/** `places`: where each paragraph a library tool gave sits in the library, by id, for the citations and open_paragraph
 *  once the messages hold only the ids. */
export interface Conversation { messages: ChatMessage[]; shown: Shown[]; places: Record<string, ParagraphRef> }
/** A turn in flight: the words of the answer so far. `draft` is a feedback message waiting for the reader to read. */
export interface Live { asking: boolean; words: string; draft: string | null }

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
const EMPTY: Conversation = { messages: [], shown: [], places: {} }

let conv: Conversation = EMPTY
let live: Live = { asking: false, words: '', draft: null }
/** Whose conversation this is: another account signed in on the device starts with none. */
let owner: number | null = null
let loaded: Promise<void> | null = null
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

/** A tool's result once the reader has written again, as the server shows it to the model (rs/src/assistant.rs
 *  stand_in): the ids of the library paragraphs a server tool gave, or that it was done. */
export function standIn(name: string | undefined, content: string): string {
  let ids: number[] = []
  if (name && toolRow(name)?.runs === 'server') {
    try { ids = ((JSON.parse(content) as { paragraphs?: { id?: unknown }[] }).paragraphs ?? []).map(p => p.id).filter((id): id is number => Number.isInteger(id)) } catch { /* none */ }
  }
  return JSON.stringify(ids.length ? { paragraphs: ids.map(id => ({ id })) } : { done: true })
}
/** The conversation in the form the server keeps, which is the form kept on the device and the one posted: the reader
 *  messages of the window (up to SENT_MOST, the last SENT once there are more or they are more than SENT_BYTES) with
 *  what followed each, every tool's result before the latest reader message as its stand-in, the last KEPT reader
 *  messages on the screen, and the places of the paragraphs either still names. */
export function trimmed(c: Conversation): Conversation {
  const readers = c.messages.flatMap((m, i) => (m.role === 'user' ? [i] : []))
  const latest = readers[readers.length - 1] ?? 0
  const names = new Map(c.messages.flatMap(m => (m.role === 'assistant' ? m.tool_calls ?? [] : [])).map(call => [call.id, call.function.name]))
  const all = c.messages.map((m, i) => (m.role === 'tool' && i < latest ? { ...m, content: standIn(names.get(m.tool_call_id), m.content) } : m))
  // measured with the latest message's results as stand-ins too, as the next post has them: what is kept while a turn
  // runs is then the window the turn was posted with
  const posted = () => bytes(JSON.stringify(c.messages.map(m => (m.role === 'tool' ? { ...m, content: standIn(names.get(m.tool_call_id), m.content) } : m))))
  const cut = readers.length > SENT_MOST || (readers.length > SENT && posted() > SENT_BYTES)
  const messages = cut ? all.slice(readers[readers.length - SENT]) : all
  const shownReaders = c.shown.flatMap((s, i) => (s.kind === 'reader' ? [i] : []))
  const shownFrom = shownReaders.length > KEPT ? shownReaders[shownReaders.length - KEPT] : 0
  const shown = c.shown.slice(shownFrom)
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

/** The conversation kept on the device for account `uid`; one kept for another account is dropped. */
export function loadConversation(uid: number): Promise<void> {
  if (owner === uid && loaded) return loaded
  aborter?.abort()
  owner = uid
  conv = EMPTY
  setLive({ asking: false, words: '', draft: null })
  loaded = AsyncStorage.getItem(KEY).then(raw => {
    if (!raw) return
    try {
      const c = JSON.parse(raw) as Conversation & { uid?: number }
      if (c.uid !== uid) { AsyncStorage.removeItem(KEY).catch(() => {}); return }
      if (Array.isArray(c.messages) && Array.isArray(c.shown) && owner === uid) { conv = { messages: c.messages, shown: c.shown, places: c.places ?? {} }; emit() }
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
  conv = EMPTY
  setLive({ asking: false, words: '', draft: null })
  AsyncStorage.removeItem(KEY).catch(() => {})
}
export function stop() { aborter?.abort() }
export function closeDraft() { setLive({ draft: null }) }

export async function ask(text: string) {
  const content = text.trim()
  if (!content || live.asking || !loaded) return
  await loaded
  // posted as the server keeps it, so the hand-over's digest of what was posted is what the app goes on from
  commit(trimmed({ ...conv, messages: [...conv.messages, { role: 'user', content }], shown: [...conv.shown, { kind: 'reader', text: content }] }))
  await turn({ messages: conv.messages })
}

/** Undoes a change line's change, once. */
export async function undoShown(index: number) {
  const s = conv.shown[index]
  if (s?.kind !== 'change' || s.undone || !host) return
  await undo(s.change.undo, context())
  commit({ ...conv, shown: conv.shown.map((x, i) => (i === index ? { ...s, undone: true } : x)) })
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
  let next: TurnRequest | null = req
  const who = owner
  try {
    while (next) next = await post(next, ctl.signal, who)
  } catch (e) {
    if (!ctl.signal.aborted && owner === who) note({ kind: 'error', text: t('Ask could not be reached. Check your connection and try again.') })
  } finally {
    if (aborter === ctl) { aborter = null; setLive({ asking: false, words: '' }) }
  }
}
function note(s: Shown) { commit({ ...conv, shown: [...conv.shown, s] }) }

/** One post of the turn of account `who`. Once the reader stops, or another account opens Ask, no tool runs, nothing
 *  goes back to the server, and nothing is kept unless it is still `who`'s conversation. */
async function post(req: TurnRequest, signal: AbortSignal, who: number | null): Promise<TurnRequest | null> {
  const ours = () => owner === who
  const keep = (next: Conversation) => { if (ours()) commit(next) }
  const note = (s: Shown) => keep({ ...conv, shown: [...conv.shown, s] })
  await loadApiBase()
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const device = await deviceId()
  if (device) headers['x-jottings-device'] = device
  const send = Platform.OS === 'web' ? globalThis.fetch : (expoFetch as unknown as typeof globalThis.fetch)
  const res = await send(`${getApiBase()}/api/assistant/turn`, { method: 'POST', headers, body: JSON.stringify(req), signal })
  if (res.status === 429) {
    const cap = await res.json() as CapReached
    note({ kind: 'cap', cap: cap.cap, resetsAt: cap.resets_at })
    return null
  }
  if (!res.ok || !res.body) {
    note({ kind: 'error', text: res.status === 401 ? t('Ask needs you to be signed in.') : res.status === 413 ? t(TOO_LONG) : t('Ask could not answer just now. Try again in a moment.') })
    return null
  }
  let pending: { calls: ToolCall[]; token: string } | null = null
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
  const results: ChatMessage[] = []
  const changes: Shown[] = []
  for (const call of pending.calls) {
    if (signal.aborted || !ours()) break
    const run = APP_TOOLS[call.function.name]
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(call.function.arguments || '{}') } catch { /* the executor says what is missing */ }
    const out = run ? await run(args, context()).catch(() => ({ result: { error: 'the app could not do this' }, changes: [] })) : { result: { error: `there is no tool ${call.function.name}` }, changes: [] }
    results.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out.result) })
    changes.push(...out.changes.map((change): Shown => ({ kind: 'change', change, undone: false })))
  }
  // what did run is kept, its lines with their Undo, when the conversation is still this account's
  keep({ ...conv, messages: [...conv.messages, ...results], shown: [...conv.shown, ...changes] })
  return signal.aborted || !ours() ? null : { messages: conv.messages, token: pending.token }
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
