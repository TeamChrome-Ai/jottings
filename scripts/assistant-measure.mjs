// What a library message costs Ask in bytes and in time, measured with no real model (docs/ASSISTANT.md, "Cost"). The
// script starts stand-ins for the three APIs and a server of its own:
//
//   BIN=rs/target/release/berean QUERIES=… EXPANSIONS=… node scripts/assistant-measure.mjs bytes
//   BIN=rs/target/release/berean [RUNS=20] [DELAY=300] node scripts/assistant-measure.mjs time
//
// bytes: each question of QUERIES ([{ q }]) is asked once. The stand-in model calls search_library with it, the
// expansion's stand-in answers what EXPANSIONS keeps for the question ([{ q, phrases, verses, related }]: a model's
// answers saved from an earlier run), and no question is embedded, so the ten paragraphs are the expansion's first.
// Printed for each: the result as the app is sent it (JSON) and as the model is shown it, in bytes of the text.
//
// time: RUNS library messages, each a question not asked before, so each makes the four calls: the model, the
// expansion, the embedding (data/ministry_vec.bin beside the library, or MINISTRY_VEC), the model again. Every
// stand-in waits DELAY ms before it answers. Printed: the median and the range of a whole message, the connections the
// server opened to each stand-in, and the calls each saw against the lines of the server's log.
//
// The chat model and the embedder share one stand-in and the expansion has another, as their real hosts are two.
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

const MODE = process.argv[2]
if (MODE !== 'bytes' && MODE !== 'time') { console.error('usage: node scripts/assistant-measure.mjs bytes|time'); process.exit(2) }
const BIN = resolve(process.env.BIN ?? 'rs/target/release/berean')
const MINISTRY_DB = resolve(process.env.MINISTRY_DB ?? 'data/ministry.db')
const MINISTRY_VEC = resolve(process.env.MINISTRY_VEC ?? 'data/ministry_vec.bin')
const WORK = resolve(process.env.WORK ?? '/tmp/assistant-measure')
const RUNS = Number(process.env.RUNS ?? 20)
const DELAY = MODE === 'time' ? Number(process.env.DELAY ?? 300) : 0
const DIMS = 1536
const sleep = ms => new Promise(r => setTimeout(r, ms))
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)) }) })
const keyOf = q => q.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}]+$/u, '')
const bytes = s => Buffer.byteLength(s, 'utf8')

// ---------- the stand-ins ----------

const kept = new Map(MODE === 'bytes' ? JSON.parse(readFileSync(process.env.EXPANSIONS, 'utf8')).map(e => [keyOf(e.q), { phrases: e.phrases, verses: e.verses, related: e.related }]) : [])
const GRACE = { phrases: ['the grace of God', 'grace reigns', 'by grace are ye saved'], verses: ['Ephesians 2:8', 'Romans 5:21', 'Titus 2:11'], related: ['the God of all grace'] }
// one vector for every question: which paragraphs come first is not what is timed
const VECTOR = Buffer.from(new Float32Array(DIMS).map((_, k) => Math.sin(k + 1)).buffer).toString('base64')
const seen = { chat: [], embedding: 0, expansion: 0 }
const opened = { openai: 0, anthropic: 0 }
/** A stand-in on a port of its own: `answer(url, body, res)` after DELAY ms, every connection opened to it counted. */
async function standIn(name, answer) {
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', async () => { await sleep(DELAY); answer(req.url, JSON.parse(raw || '{}'), res) })
  })
  server.on('connection', () => { opened[name]++ })
  const port = await freePort()
  await new Promise(r => server.listen(port, '127.0.0.1', r))
  return { server, url: `http://127.0.0.1:${port}` }
}
const json = (res, v) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
const openai = await standIn('openai', (url, b, res) => {
  if (url === '/v1/embeddings') { seen.embedding++; return json(res, { object: 'list', data: [{ object: 'embedding', index: 0, embedding: VECTOR }], model: b.model, usage: { prompt_tokens: 9, total_tokens: 9 } }) }
  // the model a library question meets: it searches for the reader's words, then answers
  const u = b.messages.map(m => m.role).lastIndexOf('user')
  const results = b.messages.slice(u + 1).filter(m => m.role === 'tool')
  seen.chat.push({ asked: b.messages[u].content, results: results.map(m => m.content) })
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = v => res.write(`data: ${JSON.stringify(v)}\n\n`)
  if (results.length) send({ choices: [{ index: 0, delta: { content: 'The paragraphs are read.' } }] })
  else send({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search_library', arguments: JSON.stringify({ question: b.messages[u].content }) } }] } }] })
  send({ choices: [{ index: 0, delta: {}, finish_reason: results.length ? 'stop' : 'tool_calls' }] })
  send({ choices: [], usage: { prompt_tokens: 2400, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 1920 } } })
  res.end('data: [DONE]\n\n')
})
const anthropic = await standIn('anthropic', (_, b, res) => {
  seen.expansion++
  const raw = kept.get(keyOf(b.messages?.[0]?.content ?? '')) ?? (MODE === 'time' ? GRACE : { phrases: [], verses: [], related: [] })
  json(res, { type: 'message', role: 'assistant', model: b.model, content: [{ type: 'text', text: JSON.stringify(raw) }], stop_reason: 'end_turn', usage: { input_tokens: 437, output_tokens: 164 } })
})

// ---------- the server ----------

rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })
const port = await freePort()
const LOG = `${WORK}/server.log`
const env = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), NO_COLOR: '1', BEREAN_DB: `${WORK}/berean.db`, BEREAN_MINISTRY_DB: MINISTRY_DB,
  BEREAN_MINISTRY_VEC: MODE === 'time' ? MINISTRY_VEC : `${WORK}/none.bin`, BEREAN_AI_KEY: 'test-key', BEREAN_EXPAND_URL: anthropic.url,
  BEREAN_CHAT_KEY: 'test-chat-key', BEREAN_CHAT_URL: openai.url, BEREAN_CHAT_EACH: '1000', ...(MODE === 'time' ? { BEREAN_EMBED_KEY: 'test-embed-key', BEREAN_EMBED_URL: openai.url } : {}) }
const child = spawn(BIN, [], { env, stdio: ['ignore', openSync(LOG, 'w'), openSync(LOG, 'a')] })
process.on('exit', () => child.kill())
const root = `http://127.0.0.1:${port}`
let up = false
for (let i = 0; i < 480 && !up && child.exitCode === null; i++) { try { up = (await fetch(`${root}/api/edition`)).ok } catch {} if (!up) await sleep(250) }
if (!up) { console.error(`the server did not come up: ${LOG}`); process.exit(1) }
const who = await (await fetch(`${root}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: `measure${Date.now().toString(36).slice(-6)}`, display_name: 'Measure', password: 'ask-measure-12345' }) })).json()

/** One reader message through the API: its events, and how long the whole of it took. */
async function ask(question) {
  const t = performance.now()
  const r = await fetch(`${root}/api/assistant/turn`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${who.token}` }, body: JSON.stringify({ messages: [{ role: 'user', content: question }] }) })
  const raw = await r.text()
  const ms = performance.now() - t
  const events = raw.split('\n\n').map(block => ({ name: /^event: (.*)$/m.exec(block)?.[1], data: /^data: (.*)$/m.exec(block)?.[1] })).filter(e => e.name).map(e => ({ name: e.name, data: JSON.parse(e.data) }))
  if (r.status !== 200 || events.at(-1)?.name !== 'done') throw new Error(`"${question}": ${r.status} ${raw.slice(0, 300)}`)
  return { ms, events }
}
const spread = ns => { const s = [...ns].sort((a, b) => a - b); return { mean: s.reduce((a, b) => a + b, 0) / s.length, median: (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2, least: s[0], most: s.at(-1) } }
const logged = word => readFileSync(LOG, 'utf8').split('\n').filter(l => l.includes(word)).length

let failed = false
if (MODE === 'bytes') {
  const rows = []
  for (const { q } of JSON.parse(readFileSync(process.env.QUERIES, 'utf8'))) {
    const before = seen.chat.length
    const { events } = await ask(q)
    const app = events.find(e => e.name === 'message' && e.data.role === 'tool').data.content
    const model = seen.chat[before + 1].results.at(-1)
    const n = JSON.parse(app).paragraphs?.length ?? 0
    rows.push({ q, n, app: bytes(app), model: bytes(model), saved: bytes(app) - bytes(model) })
    console.log(`${String(n).padStart(2)} paragraphs  app ${String(bytes(app)).padStart(6)}  model ${String(bytes(model)).padStart(6)}  saved ${String(bytes(app) - bytes(model)).padStart(5)} (${((1 - bytes(model) / bytes(app)) * 100).toFixed(1)}%)  ${q}`)
  }
  const found = rows.filter(r => r.n > 0)
  const [saved, app, model, each] = [found.map(r => r.saved), found.map(r => r.app), found.map(r => r.model), found.map(r => r.saved / r.n)].map(spread)
  const say = (label, s, d = 0) => console.log(`${label}: mean ${s.mean.toFixed(d)}, median ${s.median.toFixed(d)}, range ${s.least.toFixed(d)} to ${s.most.toFixed(d)}`)
  console.log(`${found.length} of ${rows.length} questions found paragraphs`)
  say('bytes as the app is sent the result', app)
  say('bytes as the model is shown it', model)
  say('bytes saved a result', saved)
  say('bytes saved a paragraph', each, 1)
  console.log(`saved of all the bytes: ${((1 - model.mean / app.mean) * 100).toFixed(1)}%`)
  failed = found.length === 0
} else {
  const quiet = () => ({ ...opened })
  const start = quiet()
  const times = []
  for (let k = 1; k <= RUNS; k++) times.push((await ask(`what is the grace of God, asked for the ${k}th time ${Date.now().toString(36)}`)).ms)
  const t = spread(times)
  console.log(`${RUNS} library messages, each stand-in waiting ${DELAY} ms: median ${t.median.toFixed(0)} ms, range ${t.least.toFixed(0)} to ${t.most.toFixed(0)} ms, mean ${t.mean.toFixed(0)} ms`)
  console.log(`connections opened: ${opened.openai - start.openai} to the chat model and the embedder (${seen.chat.length} chat calls, ${seen.embedding} embedding calls), ${opened.anthropic - start.anthropic} to the expansion's model (${seen.expansion} calls)`)
  const lines = { chat: logged('chat call'), model: logged('model call'), embedding: logged('embedding call') }
  console.log(`the server's log: ${lines.chat} chat call, ${lines.model} model call, ${lines.embedding} embedding call lines`)
  failed = seen.chat.length !== 2 * RUNS || seen.expansion !== RUNS || seen.embedding !== RUNS || lines.chat !== seen.chat.length || lines.model !== seen.expansion || lines.embedding !== seen.embedding
  if (failed) console.log('FAIL: a library message is two chat calls, one expansion and one embedding, each logged once')
}
child.kill()
openai.server.close()
anthropic.server.close()
process.exit(failed ? 1 : 0)
