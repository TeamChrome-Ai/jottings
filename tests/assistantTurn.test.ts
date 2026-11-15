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
