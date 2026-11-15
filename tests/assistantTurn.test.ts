// Ask's turn on the device (client/src/lib/assistant.ts) against a stand-in server: once the reader stops, or another
// account opens Ask, no tool the server handed over runs, nothing goes back, and nothing is kept under the other account;
// and a conversation goes to the server in the form the server keeps, so a long session is never too long to post.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  store: new Map<string, string>(),
  posts: [] as unknown[],
  /** What each post of the turn answers: server-sent events, or a status and its body. */
  answers: [] as (string | { status: number; body: string })[],
}))
vi.mock('../client/node_modules/@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.store.get(k) ?? null, setItem: async (k: string, v: string) => { h.store.set(k, v) },
    removeItem: async (k: string) => { h.store.delete(k) },
  },
}))
vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web ?? o.default }, AppState: { addEventListener: () => ({ remove() {} }) }, I18nManager: {}, NativeModules: {} }))
vi.mock('../client/node_modules/expo/fetch', () => ({ fetch: () => { throw new Error('the web build uses the browser’s fetch') } }))
vi.mock('../client/src/lib/api', () => ({ cachedGet: async () => ({ on: true, each: 30 }), getApiBase: () => 'http://server', getToken: () => 'token', loadApiBase: async () => 'http://server' }))
vi.mock('../client/src/lib/device', () => ({ deviceId: async () => null }))

const { ask, loadConversation, newConversation, setActionHost, stop } = await import('../client/src/lib/assistant')
type Host = Parameters<typeof setActionHost>[0]

const sse = (events: [string, unknown][]) => events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')
const call = (id: string, ref: string) => ({ id, type: 'function', function: { name: 'add_bookmark', arguments: JSON.stringify({ reference: ref }) } })
const HANDED = sse([['message', { role: 'assistant', content: null, tool_calls: [call('c1', 'John 3:16'), call('c2', 'John 3:17')] }], ['pending', { calls: [call('c1', 'John 3:16'), call('c2', 'John 3:17')], token: 't' }], ['done', {}]])

/** An app whose first bookmark waits for `release`. */
function host() {
  const added: unknown[] = []
  let release!: () => void
  const first = new Promise<void>(r => { release = r })
  let reached!: () => void
  const waiting = new Promise<void>(r => { reached = r })
  const h: Host = {
    prefs: { get: () => ({}) as never, isLoaded: () => true, set: () => {}, reset: () => {}, subscribe: () => () => {} },
    navigate: () => {}, player: { start: () => {}, stop: () => {}, now: () => null }, place: async () => null,
    bookmarks: { find: async () => null, add: async b => { added.push(b); if (added.length === 1) { reached(); await first } return added.length }, remove: async () => {} },
    highlights: { get: async () => new Map(), set: async () => {} },
  }
  return { h, added, release, waiting }
}

beforeEach(() => {
  h.store.clear(); h.posts.length = 0; h.answers = [HANDED, sse([['answer', { sentences: [] }], ['done', {}]])]
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    h.posts.push(JSON.parse(String(init.body)))
    const a = h.answers.shift() ?? ''
    return typeof a === 'string' ? new Response(a, { status: 200, headers: { 'content-type': 'text/event-stream' } }) : new Response(a.body, { status: a.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
})

describe('the tools a turn handed over', () => {
  it('stop running when the reader stops, and nothing goes back to the server', async () => {
    const app = host()
    setActionHost(app.h)
    await loadConversation(1)
    const turn = ask('bookmark John 3:16 and 17')
    await app.waiting
    stop()
    app.release()
    await turn
    expect([app.added.length, h.posts.length]).toEqual([1, 1])
  })
  it('stop running when another account opens Ask, and nothing of the first is kept under the second', async () => {
    const app = host()
    setActionHost(app.h)
    await loadConversation(1)
    const turn = ask('bookmark John 3:16 and 17')
    await app.waiting
    await loadConversation(2)
    app.release()
    await turn
    const kept = JSON.parse(h.store.get('berean_assistant') ?? '{"uid":2,"messages":[]}')
    expect([app.added.length, h.posts.length, kept.uid === 2 ? kept.messages.length : 'kept for 1']).toEqual([1, 1, 0])
  })
})

/** One answer from the library as the server streams it: a search, its ten paragraphs of 1,500 characters, the answer. */
function answered(k: number): string {
  const paragraphs = Array.from({ length: 10 }, (_, j) => ({ id: 100 * k + j, author: 'darby', work: { id: 'cw-1', title: 'Collected Writings 1', collection: 'cw' }, n: 2, para: j, section: 'On grace', text: 'g'.repeat(1500) }))
  return sse([
    ['message', { role: 'assistant', content: null, tool_calls: [{ id: `s${k}`, type: 'function', function: { name: 'search_library', arguments: '{"question":"grace"}' } }] }],
    ['message', { role: 'tool', tool_call_id: `s${k}`, content: JSON.stringify({ paragraphs }) }],
    ['message', { role: 'assistant', content: `Grace reigns [${100 * k}].` }],
    ['answer', { sentences: [{ text: 'Grace reigns.', ids: [100 * k], supported: true }] }], ['done', {}]])
}
const posted = (n: number) => h.posts[n] as { messages: { role: string; content: string | null }[] }

describe('the conversation a reader message posts', () => {
  it('has each earlier tool result as its stand-in: the paragraphs’ ids, nothing of their text', async () => {
    const app = host()
    setActionHost(app.h)
    await loadConversation(1)
    newConversation()
    h.answers = [answered(1), answered(2)]
    await ask('what did Darby say of grace?')
    await ask('and more?')
    const earlier = posted(1).messages.find(m => m.role === 'tool')
    expect(earlier?.content).toBe(JSON.stringify({ paragraphs: Array.from({ length: 10 }, (_, j) => ({ id: 100 + j })) }))
  })
  it('stays well under what the server takes, however long the session', async () => {
    const app = host()
    setActionHost(app.h)
    await loadConversation(1)
    newConversation()
    h.answers = Array.from({ length: 30 }, (_, k) => answered(k + 1))
    for (let k = 0; k < 30; k++) await ask(`question ${k}`)
    const sizes = (h.posts as unknown[]).map(p => new TextEncoder().encode(JSON.stringify(p)).length)
    expect(Math.max(...sizes)).toBeLessThan(100_000)
  })
  it('keeps up to twelve reader messages, and cuts back to eight when the thirteenth comes', async () => {
    setActionHost(host().h)
    await loadConversation(1)
    newConversation()
    h.answers = Array.from({ length: 18 }, (_, k) => answered(k + 1))
    for (let k = 1; k <= 18; k++) await ask(`question ${k}`)
    const readers = (n: number) => posted(n - 1).messages.filter(m => m.role === 'user').map(m => m.content)
    expect([8, 9, 10, 11, 12, 13, 14, 17, 18].map(n => [readers(n).length, readers(n)[0]])).toEqual([[8, 'question 1'], [9, 'question 1'], [10, 'question 1'], [11, 'question 1'], [12, 'question 1'],
      [8, 'question 6'], [9, 'question 6'], [12, 'question 6'], [8, 'question 11']])
    // what is kept on the device is what was posted, with the answer since
    const kept = JSON.parse(h.store.get('berean_assistant') ?? '{}').messages as { role: string; content: string }[]
    expect(kept.filter(m => m.role === 'user').map(m => m.content)).toEqual(readers(18))
  })
  it('posts, from the ninth message to the twelfth, what it posted before with only more after it', async () => {
    setActionHost(host().h)
    await loadConversation(1)
    newConversation()
    h.answers = Array.from({ length: 14 }, (_, k) => answered(k + 1))
    for (let k = 1; k <= 14; k++) await ask(`question ${k}`)
    const sent = (n: number) => JSON.stringify(posted(n - 1).messages)
    // byte for byte the start of the next, which a provider's cache keeps; the cut at the thirteenth starts anew, once
    expect([9, 10, 11, 12, 13, 14].map(n => sent(n).startsWith(sent(n - 1).slice(0, -1)))).toEqual([true, true, true, true, false, true])
    for (let n = 9; n <= 14; n++) for (const m of posted(n - 1).messages.filter(m => m.role === 'tool')) expect(m.content).toMatch(/^\{"paragraphs":\[\{"id":\d+\}/)
  })
  it('keeps eight, as before, once twelve would be more than the server takes', async () => {
    setActionHost(host().h)
    await loadConversation(1)
    newConversation()
    const long = (k: number) => sse([['message', { role: 'assistant', content: `${'é'.repeat(4500)} ${k}` }], ['answer', { sentences: [] }], ['done', {}]])
    h.answers = Array.from({ length: 14 }, (_, k) => long(k + 1))
    for (let k = 1; k <= 14; k++) await ask(`question ${k}`)
    const readers = (n: number) => posted(n - 1).messages.filter(m => m.role === 'user').length
    expect([8, 9, 10, 11, 12, 13, 14].map(readers)).toEqual([8, 8, 8, 8, 8, 8, 8])
    const sizes = (h.posts as unknown[]).map(p => new TextEncoder().encode(JSON.stringify(p)).length)
    expect(Math.max(...sizes)).toBeLessThan(80_000)
  })
  it('keeps on the device, after a long library result, the window the turn was posted with', async () => {
    setActionHost(host().h)
    await loadConversation(1)
    newConversation()
    const said = (k: number) => sse([['message', { role: 'assistant', content: `${'x'.repeat(3800)} ${k}` }], ['answer', { sentences: [] }], ['done', {}]])
    const read = sse([
      ['message', { role: 'assistant', content: null, tool_calls: [{ id: 's10', type: 'function', function: { name: 'search_library', arguments: '{"question":"grace"}' } }] }],
      ['message', { role: 'tool', tool_call_id: 's10', content: JSON.stringify({ paragraphs: [{ id: 7, author: 'darby', work: { id: 'cw-1', title: 'Collected Writings 1', collection: 'cw' }, n: 1, para: 0, section: 'Grace', text: 'y'.repeat(12_000) }] }) }],
      ['message', { role: 'assistant', content: 'Grace reigns [7].' }], ['answer', { sentences: [{ text: 'Grace reigns.', ids: [7], supported: true }] }], ['done', {}]])
    h.answers = [...Array.from({ length: 9 }, (_, k) => said(k + 1)), read, said(11)]
    for (let k = 1; k <= 10; k++) await ask(`question ${k}`)
    // the result is whole on the device until the reader writes again, and is not counted whole against the window
    const kept = JSON.parse(h.store.get('berean_assistant') ?? '{}').messages as { role: string; content: string }[]
    expect(kept.filter(m => m.role === 'user').map(m => m.content)).toEqual(Array.from({ length: 10 }, (_, k) => `question ${k + 1}`))
    await ask('question 11')
    expect(posted(10).messages.filter(m => m.role === 'user').length).toBe(11)
  })
  it('does not move the window while a turn runs: what a hand-over posts begins with what the server signed', async () => {
    const app = host()
    app.release()
    setActionHost(app.h)
    await loadConversation(1)
    newConversation()
    // ten reader messages whose post is just under the bytes the window may be, so that the model's call, coming
    // during the turn, takes it over them
    const q = (k: number) => `what did Darby say about the sealing of the Spirit? ${k}`
    const size = (len: number) => new TextEncoder().encode(JSON.stringify(Array.from({ length: 10 }, (_, k) => [{ role: 'user', content: q(k + 1) }, ...(k < 9 ? [{ role: 'assistant', content: 'x'.repeat(len) }] : [])]).flat())).length
    const len = Math.floor((39_990 - size(0)) / 9)
    expect(size(len)).toBeGreaterThan(39_900)
    expect(size(len)).toBeLessThanOrEqual(40_000)
    const said = () => sse([['message', { role: 'assistant', content: 'x'.repeat(len) }], ['answer', { sentences: [] }], ['done', {}]])
    h.answers = [...Array.from({ length: 9 }, said), HANDED, sse([['message', { role: 'assistant', content: 'Done.' }], ['answer', { sentences: [] }], ['done', {}]])]
    for (let k = 1; k <= 10; k++) await ask(q(k))
    expect([posted(9).messages.length, posted(9).messages[0].content]).toEqual([19, q(1)])
    // the hand-over: all that was posted, the model's call, and the two results
    const handed = h.posts[10] as { messages: { role: string; content: string }[]; token?: string }
    expect([handed.token, handed.messages.length, handed.messages[0].content, handed.messages.slice(-3).map(m => m.role)]).toEqual(['t', 22, q(1), ['assistant', 'tool', 'tool']])
  })
  it('keeps every citation’s place once the paragraphs’ text is gone', async () => {
    const app = host()
    const opened: unknown[] = []
    app.h.navigate = href => { opened.push(href) }
    setActionHost(app.h)
    await loadConversation(1)
    newConversation()
    h.answers = [answered(1), sse([['message', { role: 'assistant', content: null, tool_calls: [{ id: 'o1', type: 'function', function: { name: 'open_paragraph', arguments: '{"id":103}' } }] }], ['pending', { calls: [{ id: 'o1', type: 'function', function: { name: 'open_paragraph', arguments: '{"id":103}' } }], token: 't' }], ['done', {}]]), sse([['answer', { sentences: [] }], ['done', {}]])]
    await ask('what did Darby say of grace?')
    await ask('open the fourth')
    expect(opened).toEqual([{ pathname: '/companion', params: { author: 'darby', work: 'cw-1', n: '2', p: '3' } }])
  })
  it('says, when the server finds it too long, to start a new conversation', async () => {
    setActionHost(host().h)
    await loadConversation(1)
    newConversation()
    h.answers = [{ status: 413, body: JSON.stringify({ error: 'the conversation is too long; start a new one' }) }]
    await ask('one more')
    const conv = JSON.parse(h.store.get('berean_assistant') ?? '{}')
    expect(conv.shown.at(-1)).toEqual({ kind: 'error', text: 'This conversation is too long for Ask. Start a new conversation to go on.' })
  })
})

describe('the words shown while an answer comes', () => {
  // the model sometimes writes markdown, which the app does not draw (the real model on 2026-11-15: "- **John 14:3:**
  // …" for a question about where the Bible says a thing). The server takes the asterisks out before it reads the
  // words for a name (rs/src/assistant.rs Filter); the app takes out a line's list mark and nothing else, so it never
  // joins what the server judged apart
  it('show no list dash and no bracket of ids, and leave every other mark to the server', async () => {
    const { streamed } = await import('../client/src/lib/assistant')
    expect(streamed('- John 14:3: “I am coming again”\n- 1 Thess')).toBe('John 14:3: “I am coming again”\n1 Thess')
    expect(streamed('• Grace reigns [12].\n  - Peace follows')).toBe('Grace reigns.\nPeace follows')
    expect(streamed('It is 3 - 2, and well-known.')).toBe('It is 3 - 2, and well-known.')
    expect(streamed('Open **AI** made this.')).toBe('Open **AI** made this.')
    expect(streamed('G**PT')).toBe('G**PT')
  })
})
