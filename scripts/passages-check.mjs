// Passages by meaning (docs/SEARCH_EXPAND.md) against servers that ask local stand-ins for the Messages API and the
// embeddings API instead of Anthropic and OpenAI. The script starts the stand-ins and five servers itself:
//
//   BIN=rs/target/release/berean [VEC=data/ministry_vec.bin] [MINISTRY_DB=data/ministry.db] [CACHE=tools/cache/embed]
//     [ANSWERS=…] [JUDGED=…] [TRUNK_BIN=…] [OUT=…] node scripts/passages-check.mjs
//
// VEC is the vector file tools/embed_ministry.py built from MINISTRY_DB, CACHE the tool's cache it was built from (lane
// 7 rebuilds a copy). ANSWERS, a JSON list of { q, phrases, verses, related } (scratch/ai-search-probe/
// haiku_expansion.json), adds questions to the four the Messages stand-in knows; JUDGED (judged_openai.json) is the blind
// test those answers were graded in, whose "reranked" ten must be among the server's candidates. The order lane computes every answer
// again from MINISTRY_DB and VEC, apart from the server. The perf lane reads the server's resident memory, and that of
// TRUNK_BIN, a server built without passages, asked the same questions' expansions.
import http from 'node:http'
import net from 'node:net'
import { spawn, execFileSync } from 'node:child_process'
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const BIN = resolve(process.env.BIN ?? 'rs/target/release/berean')
const VEC = resolve(process.env.VEC ?? 'data/ministry_vec.bin')
const MINISTRY_DB = resolve(process.env.MINISTRY_DB ?? 'data/ministry.db')
const CACHE = resolve(process.env.CACHE ?? 'tools/cache/embed')
const OUT = resolve(process.env.OUT ?? '/tmp/v2-24/check')
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)) }) })
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

// Haiku 5.5's answers in the investigation of 2026-11-13 (scratch/ai-search-probe/haiku_expansion.json)
const ANSWERS = {
  'how can i be sure i am saved': { phrases: ['assurance of salvation', 'know that ye have eternal life', 'the witness of the Spirit', 'believing the record', 'the finished work of Christ'], verses: ['1 John 5:13', 'John 5:24', 'Romans 8:16', 'Ephesians 1:13', 'Hebrews 10:22'], related: ['the eternal security of the saint', 'the witness of the Spirit', 'the new birth'] },
  'what happens to a believer when he dies': { phrases: ['to depart and be with Christ', 'asleep in Jesus', 'absent from the body', 'present with the Lord', 'the resurrection of the just'], verses: ['Philippians 1:23', '1 Thessalonians 4:14', '2 Corinthians 5:8', 'Luke 23:43', 'John 11:25'], related: ['the coming of the Lord', 'the resurrection of the dead', 'the hope of glory'] },
  'why does god allow his children to suffer': { phrases: ['the chastening of the Lord', 'for our profit', 'the fellowship of his sufferings', 'the furnace of affliction', 'partakers of his sufferings'], verses: ['Hebrews 12:6', 'Romans 8:17', '1 Peter 4:19', 'Hebrews 12:11', '2 Corinthians 4:17'], related: ['the discipline of the Father', 'patience under trial', 'the path of suffering'] },
  'should a christian take part in politics or vote': { phrases: ['render unto Caesar', 'the powers that be', 'the kingdom not of this world', 'our citizenship in heaven', 'subject to the higher powers'], verses: ['Romans 13:1', 'Matthew 22:21', 'John 18:36', 'Philippians 3:20', '1 Peter 2:13'], related: ['the ordained powers', 'the heavenly citizenship', 'separation from the world'] },
}
const keyOf = q => q.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N}]+$/u, '')
if (process.env.ANSWERS) for (const a of JSON.parse(readFileSync(process.env.ANSWERS, 'utf8'))) ANSWERS[keyOf(a.q)] = a
const OTHER = { phrases: ['the love of God'], verses: ['John 3:16'], related: ['the grace of God'] }
const NOTHING = { phrases: ['quorbleflax zzyzx'], verses: ['Bitcoin 1:1'], related: ['the love of God'] }
const answerOf = q => /quorbleflax/i.test(q) ? NOTHING : ANSWERS[keyOf(q)] ?? OTHER

let passed = 0, failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (cond) passed++; else failed++ }
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------- the vector file, read as the server reads it ----------
function openVectors(path) {
  const fd = openSync(path, 'r')
  const head = Buffer.alloc(24)
  readSync(fd, head, 0, 24, 0)
  const dims = head.readUInt32LE(8), count = Number(head.readBigUInt64LE(12)), nameLen = head.readUInt32LE(20)
  const name = Buffer.alloc(nameLen)
  readSync(fd, name, 0, nameLen, 24)
  const idBytes = Buffer.alloc(count * 8)
  readSync(fd, idBytes, 0, idBytes.length, 24 + nameLen)
  const ids = Array.from({ length: count }, (_, k) => Number(idBytes.readBigInt64LE(k * 8)))
  const at = new Map(ids.map((id, k) => [id, k]))
  const rows = 24 + nameLen + count * 8
  const row = id => { const k = at.get(id); if (k === undefined) return null; const b = Buffer.alloc(dims); readSync(fd, b, 0, dims, rows + k * dims); return new Int8Array(b.buffer, b.byteOffset, dims) }
  return { fd, dims, count, model: name.toString(), ids, row, rows }
}
const vec = openVectors(VEC)

// ---------- the stand-ins ----------
const calls = { model: [], embed: [] }
const toward = new Map()
function seeded(text) {
  let h = 2166136261
  for (const ch of text) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0 }
  const v = new Float32Array(vec.dims)
  for (let i = 0; i < v.length; i++) { h = (h + 0x6d2b79f5) >>> 0; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); v[i] = (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1 }
  return v
}
/** What the embeddings stand-in answers for `text`: the row of the paragraph `toward` names for it, or a vector of its own. */
const vectorOf = text => { const id = toward.get(text); return id === undefined ? seeded(text) : Float32Array.from(vec.row(id), x => x / 127) }
const stub = http.createServer((req, res) => {
  const send = (status, v) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(v)) }
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    const b = JSON.parse(body || '{}')
    if (req.url === '/v1/messages') {
      const q = b.messages?.[0]?.content ?? ''
      calls.model.push(q)
      return send(200, { type: 'message', role: 'assistant', model: b.model, content: [{ type: 'thinking', thinking: '', signature: 'stub' }, { type: 'text', text: JSON.stringify(answerOf(q)) }], stop_reason: 'end_turn', usage: { input_tokens: 437, output_tokens: 164 } })
    }
    const m = /^(\/down|\/flaky)?\/v1\/embeddings$/.exec(req.url)
    if (!m) return send(404, { error: { message: 'no such route' } })
    const inputs = Array.isArray(b.input) ? b.input : [b.input]
    calls.embed.push({ way: m[1] ?? '', inputs, model: b.model, format: b.encoding_format, auth: req.headers.authorization === 'Bearer test-embed-key' })
    if (m[1] === '/flaky' && inputs.some(t => /politics/i.test(t))) return setTimeout(() => send(500, { error: { message: 'too late' } }), 10000)
    if (m[1]) return send(500, { error: { message: 'The server had an error while processing your request.', type: 'server_error' } })
    const tokens = inputs.reduce((n, t) => n + Math.ceil(t.length / 4), 0)
    send(200, { object: 'list', model: b.model, usage: { prompt_tokens: tokens, total_tokens: tokens }, data: inputs.map((t, index) => ({ object: 'embedding', index, embedding: Buffer.from(vectorOf(t).buffer).toString('base64') })) })
  })
})
await new Promise(r => stub.listen(0, '127.0.0.1', r))
const STUB = `http://127.0.0.1:${stub.address().port}`

// ---------- the servers ----------
function writeWrongSize(path) {
  const dims = 512, name = Buffer.from(vec.model)
  const fd = openSync(path, 'w')
  const head = Buffer.alloc(24)
  head.write('MVEC', 0); head.writeUInt32LE(1, 4); head.writeUInt32LE(dims, 8); head.writeBigUInt64LE(BigInt(vec.count), 12); head.writeUInt32LE(name.length, 20)
  writeSync(fd, head); writeSync(fd, name)
  const ids = Buffer.alloc(vec.count * 8)
  vec.ids.forEach((id, k) => ids.writeBigInt64LE(BigInt(id), k * 8))
  writeSync(fd, ids)
  const block = Buffer.alloc(dims * 4096)
  for (let start = 0; start < vec.count; start += 4096) {
    const n = Math.min(4096, vec.count - start)
    for (let k = 0; k < n; k++) readSync(vec.fd, block, k * dims, dims, vec.rows + (start + k) * vec.dims)
    writeSync(fd, block, 0, n * dims)
  }
  closeSync(fd)
}
const NONE = `${OUT}/none.bin`, WRONG = `${OUT}/wrong-size.bin`
writeWrongSize(WRONG)
const servers = {}
process.on('exit', () => { for (const s of Object.values(servers)) s?.child.kill() })
async function start(name, env, bin = BIN) {
  const port = await freePort()
  const log = `${OUT}/${name}.log`
  const fd = openSync(log, 'w')
  const base = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), NO_COLOR: '1', BEREAN_DB: `${OUT}/${name}.db`, BEREAN_MINISTRY_DB: MINISTRY_DB, BEREAN_MINISTRY_VEC: VEC,
    BEREAN_AI_KEY: 'test-key', BEREAN_EXPAND_URL: STUB, BEREAN_EMBED_KEY: 'test-embed-key', BEREAN_EMBED_URL: STUB }
  const child = spawn(bin, [], { env: Object.fromEntries(Object.entries({ ...base, ...env }).filter(([, v]) => v !== undefined)), stdio: ['ignore', fd, fd] })
  servers[name] = { child }
  const root = `http://127.0.0.1:${port}`
  let up = false
  for (let i = 0; i < 240 && !up && child.exitCode === null; i++) { try { up = (await fetch(`${root}/api/edition`)).ok } catch {} if (!up) await sleep(250) }
  ok(`${name}: the server is up (exit ${child.exitCode})`, up && child.exitCode === null)
  if (!up) console.log(readFileSync(log, 'utf8').split('\n').slice(-10).join('\n'))
  servers[name] = { root, log, pid: child.pid, child, db: `${OUT}/${name}.db` }
  return servers[name]
}
const trunkBin = process.env.TRUNK_BIN && resolve(process.env.TRUNK_BIN)
const [base, nokey, nofile, wrong, down, trunk] = await Promise.all([
  start('base', {}),
  start('nokey', { BEREAN_EMBED_KEY: undefined }),
  start('nofile', { BEREAN_MINISTRY_VEC: NONE }),
  start('wrong', { BEREAN_MINISTRY_VEC: WRONG }),
  start('down', { BEREAN_EMBED_URL: `${STUB}/flaky` }),
  trunkBin ? start('trunk', {}, trunkBin) : null,
])
const lines = s => readFileSync(s.log, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(Boolean)
const embeddingLines = s => lines(s).filter(l => l.includes('embedding call'))
const ask = async (s, q) => {
  const t = performance.now()
  try { const r = await fetch(`${s.root}/api/ministry/passages?q=${encodeURIComponent(q)}`); return { ms: performance.now() - t, status: r.status, body: await r.json().catch(() => null) } }
  catch (e) { return { ms: performance.now() - t, status: 0, body: null, error: String(e) } }
}
const keysOf = body => (body?.items ?? []).map(i => `${i.author}/${i.work.id}/${i.n}/${i.para}`)
const served = async (s, q) => (await (await fetch(`${s.root}/api/ministry/expand?q=${encodeURIComponent(q)}`)).json())
const rss = s => existsSync(`/proc/${s.pid}/status`) ? Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${s.pid}/status`, 'utf8'))?.[1] ?? NaN) / 1024 : NaN
const embedsFor = q => calls.embed.filter(c => c.inputs.includes(q)).length

// ---------- the order, computed again from ministry.db and the vector file ----------
const lib = new DatabaseSync(MINISTRY_DB, { readOnly: true })
const enabled = new Set(lib.prepare('SELECT p.id FROM paras p JOIN authors a ON a.id = p.author WHERE a.enabled = 1').all().map(r => r.id))
const placeOf = lib.prepare('SELECT p.author, p.work, p.n, p.i, w.collection FROM paras p JOIN works w ON w.author = p.author AND w.id = p.work WHERE p.id = ?')
const keyOfId = id => { const p = placeOf.get(id); return `${p.author}/${p.work}/${p.n}/${p.i}` }
const SMALL = new Set('a an and are as at be but by do for from had has have he her him his i if in is it me my no not of on or our she so that the thee their them then there they thou thy to unto us was we were what when which who will with ye you your said saith says say shall all this these those upon into also even'.split(' '))
const fold = s => s.replace(/['’]/g, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const wordsOf = s => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
/** The words search's "as typed" tier for a phrase (rs/src/ministry.rs TextQuery::read), null for one it reads otherwise. */
function asTyped(phrase) {
  if (/['’]/.test(phrase)) return null
  const w = wordsOf(phrase)
  if (!w.length || w.every(x => SMALL.has(x))) return null
  const last = w.length - 1
  const prefix = w[last].length >= 3 && !/^\p{N}+$/u.test(w[last]) && !SMALL.has(w[last])
  const split = w.map((x, i) => i).filter(i => w[i].length >= 4 && w[i].endsWith('s') && !w[i].endsWith('ss') && !SMALL.has(w[i])).slice(0, 2)
  const parted = (i, r) => split.includes(i) && ((r >> split.indexOf(i)) & 1) === 1
  return Array.from({ length: 1 << split.length }, (_, r) => `"${w.map((x, i) => parted(i, r) ? `${x.slice(0, -1)} s` : x).join(' ')}"${prefix && !parted(last, r) ? ' *' : ''}`).join(' OR ')
}
const matching = lib.prepare('SELECT rowid AS id FROM paras_fts WHERE paras_fts MATCH ?')
const citing = lib.prepare('SELECT DISTINCT para AS id FROM refs WHERE verse = ? AND note = 0')
/** The expansion's paragraphs in its own order (most phrases and verses, then more phrases, then reading order), at most `most`. */
function candidates(phrases, verses, phraseExpr, most = 3000) {
  const score = new Map()
  const add = (id, k) => { if (!enabled.has(id)) return; const s = score.get(id) ?? [0, 0]; s[k]++; score.set(id, s) }
  for (const p of phrases) { const expr = phraseExpr(p); if (expr === null) return null; for (const { id } of matching.all(expr)) add(id, 0) }
  for (const v of verses) for (const { id } of citing.all(v.book * 1e6 + v.chapter * 1e3 + v.verse)) add(id, 1)
  return [...score].sort(([a, x], [b, y]) => (y[0] + y[1]) - (x[0] + x[1]) || y[0] - x[0] || a - b).slice(0, most).map(([id]) => id)
}
const judgedCount = (phrases, verses) => candidates(phrases, verses, p => `"${(p.match(/[A-Za-z']+/g) ?? []).join(' ')}"`, Infinity)?.length
const halfEven = x => { const f = Math.floor(x), d = x - f; return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1) }
/** The question's vector as the server quantizes it, in single precision step by step (near.rs quantized). */
function quantized(v) {
  let s = 0
  for (const x of v) s = Math.fround(s + Math.fround(x * x))
  const norm = Math.fround(Math.sqrt(s))
  return Int8Array.from(v, x => Math.max(-127, Math.min(127, halfEven(Math.fround(Math.fround(x / norm) * 127)))))
}
function byMeaning(ids, v) {
  const q = quantized(v)
  const sim = new Map(ids.map(id => { const r = vec.row(id); let d = 0; if (r) for (let i = 0; i < q.length; i++) d += q[i] * r[i]; return [id, r ? d : -Infinity] }))
  return [...ids].sort((a, b) => sim.get(b) - sim.get(a))
}
const asked = q => q.split(/\s+/).filter(Boolean).join(' ')

// ---------- screenshots of what the endpoint answered ----------
const { chromium } = await import('playwright')
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
async function shot(name, title, rows) {
  const html = `<!doctype html><meta charset="utf-8"><style>body{font:13px system-ui;margin:16px}td{vertical-align:top;padding:3px 6px;border-top:1px solid #ddd}.n{color:#777}h3{margin:4px 0}</style>
<h3>${esc(title)}</h3>${rows.map(r => `<h3>${esc(r.label)} <span class="n">${esc(r.note ?? '')}</span></h3>${r.body ? `<table>${(r.body.items ?? []).map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.author)}</td><td>${esc(i.work.title)} · ${i.n}${i.section ? ` · ${esc(i.section)}` : ''} ¶${i.para}</td><td>${esc(i.snippet)}</td></tr>`).join('')}</table>` : ''}${r.text ? `<pre>${esc(r.text)}</pre>` : ''}`).join('')}`
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
  await page.setContent(html)
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
  await page.close()
  console.log(`shot ${OUT}/${name}.png`)
}
const note = r => `${r.body?.state} · by ${r.body?.by} · ${r.body?.items?.length} items · ${r.ms.toFixed(0)} ms`

const SAVED = 'how can I be sure I am saved', DIES = 'what happens to a believer when he dies', POLITICS = 'should a Christian take part in politics or vote'

{
  const before = rss(base), trunkBefore = trunk && rss(trunk)
  const fresh = ['what does the love of God mean for me', 'how do I know the love of God', 'what is the greatest love of all', 'is the love of God for everyone', 'why did God so love the world',
    'can I lose the love of God', 'how is the love of God shown', 'what is the love of God in the gospel', 'where do I see the love of God', 'does the love of God ever change']
  const newMs = [], cachedMs = []
  for (const q of fresh) newMs.push((await ask(base, q)).ms)
  for (const q of fresh) cachedMs.push((await ask(base, q)).ms)
  const after = rss(base)
  ok(`perf: resident memory ${before.toFixed(1)} MB before ten questions and ${after.toFixed(1)} MB after, ${(after - before).toFixed(1)} MB more (at most 30)`, after - before <= 30)
  if (trunk) {
    for (const q of fresh) await served(trunk, q)
    const trunkAfter = rss(trunk)
    ok(`perf: trunk ${trunkBefore.toFixed(1)} MB at start and ${trunkAfter.toFixed(1)} MB after the same ten expansions; head ${before.toFixed(1)} MB and ${after.toFixed(1)} MB, ${(after - trunkAfter).toFixed(1)} MB more than trunk (at most 30)`, after - trunkAfter <= 30)
  }
  console.log(`perf: median ${median(newMs).toFixed(0)} ms new (stand-ins, no network), ${median(cachedMs).toFixed(1)} ms asked again; ${statSync(VEC).size.toLocaleString('en')} bytes in ${VEC}`)
}

{
  const before = calls.embed.length, logged = embeddingLines(base).length, modelLogged = lines(base).filter(l => l.includes('model call')).length
  const first = await ask(base, SAVED), again = await ask(base, SAVED)
  ok(`lane 3: "${SAVED}" answers ten paragraphs by meaning (${note(first)})`, first.body?.state === 'ok' && first.body?.by === 'meaning' && first.body?.items?.length === 10)
  ok(`lane 3: … the same asked again (${again.ms.toFixed(1)} ms)`, JSON.stringify(again.body) === JSON.stringify(first.body))
  const added = embeddingLines(base).slice(logged)
  ok(`lane 3: the server log names one embedding call with its tokens (${added.map(l => l.replace(/^.*embedding call/, 'embedding call')).join(' | ')})`, added.length === 1 && /tokens=\d+/.test(added[0]) && !added[0].includes('model call'))
  ok(`lane 3: … and the stand-in saw one for the question (${embedsFor(SAVED)}, ${calls.embed.length - before} in all; model calls logged ${lines(base).filter(l => l.includes('model call')).length - modelLogged})`, embedsFor(SAVED) === 1 && calls.embed.length - before === 1)
  await shot('cached', 'Lane 3: one question asked twice', [{ label: `first: ${SAVED}`, note: note(first), body: first.body }, { label: 'again', note: note(again), body: again.body }, { text: added.join('\n'), label: 'the log' }])
}

const blind = process.env.JUDGED ? new Map(JSON.parse(readFileSync(process.env.JUDGED, 'utf8')).questions.map(x => [keyOf(x.q), x.arms.reranked.ids])) : new Map()
const order = []
{
  for (const q of Object.keys(ANSWERS)) {
    const a = asked(Object.values(ANSWERS).find(x => keyOf(x.q ?? '') === q)?.q ?? q)
    const [meaning, matches] = [await ask(base, a), await ask(nokey, a)]
    const input = calls.embed.find(c => c.way === '' && keyOf(c.inputs[0]) === q)?.inputs[0] ?? a
    const e = await served(base, a)
    const phrases = e.phrases.map(p => p.text), verses = e.verses
    const ranked = candidates(phrases, verses, asTyped)
    if (ranked === null) { console.log(`skip order: "${a}" has a phrase the reference does not read`); continue }
    const want = byMeaning(ranked, vectorOf(input)).slice(0, 10).map(keyOfId), wantMatches = ranked.slice(0, 10).map(keyOfId)
    const judged = candidates(phrases, verses, p => `"${(p.match(/[A-Za-z']+/g) ?? []).join(' ')}"`, Infinity)
    const judgeArm = byMeaning(judged, vectorOf(input)).slice(0, 10).map(keyOfId)
    const got = keysOf(meaning.body)
    order.push({ q: a, candidates: ranked.length, server: got, reference: want, judgeArmOverlap: judgeArm.filter(k => got.includes(k)).length })
    ok(`order: "${a}" by meaning is the order computed again from ministry.db and the vector file (${ranked.length} candidates; the judge's own phrase match shares ${judgeArm.filter(k => got.includes(k)).length} of 10)`, meaning.body?.by === 'meaning' && JSON.stringify(got) === JSON.stringify(want))
    ok(`lane 4: "${a}" without the key is the expansion's ten best (${note(matches)})`, matches.body?.by === 'matches' && JSON.stringify(keysOf(matches.body)) === JSON.stringify(wantMatches))
    const graded = blind.get(q)
    if (graded) {
      const among = graded.filter(id => ranked.includes(id)).length
      order.at(-1).judgedAmongCandidates = among
      ok(`order: the blind test's "reranked" ten for "${a}" are among the server's ${ranked.length} candidates (${among} of ${graded.length}; the judge's own phrase match had ${judgedCount(phrases, verses)})`, among === graded.length)
    }
  }
  writeFileSync(`${OUT}/order.json`, JSON.stringify(order, null, 1))
}

{
  const before = calls.embed.length
  const r = await ask(nokey, SAVED)
  const said = lines(nokey)
  ok(`lane 4: without BEREAN_EMBED_KEY the server answers by matches (${note(r)}) and asks no embedding (${calls.embed.length - before})`, r.body?.state === 'ok' && r.body?.by === 'matches' && r.body?.items?.length === 10 && calls.embed.length === before)
  ok(`lane 4: … logs no error (${said.filter(l => / (ERROR|WARN) /.test(l)).length} warnings or errors; "${said.find(l => l.includes('passages by meaning'))?.replace(/^.*passages/, 'passages')}")`, !said.some(l => / (ERROR|WARN) /.test(l)) && said.some(l => l.includes('passages by meaning off: no BEREAN_EMBED_KEY')))
  await shot('no-key', 'Lane 4: no BEREAN_EMBED_KEY', [{ label: SAVED, note: note(r), body: r.body }])
}

const fallback = async (s, name, lane, logWant, title) => {
  const before = calls.embed.length
  const r = await ask(s, SAVED), ref = await ask(nokey, SAVED)
  const named = lines(s).filter(l => l.includes(logWant))
  ok(`${lane}: the server answers the expansion's ten best (${note(r)})`, r.body?.by === 'matches' && JSON.stringify(keysOf(r.body)) === JSON.stringify(keysOf(ref.body)) && keysOf(r.body).length === 10)
  ok(`${lane}: … logs one line that names it (${named.map(l => l.replace(/^.*?(WARN|INFO) /, '')).join(' | ')})`, named.length === 1)
  ok(`${lane}: … and asks no embedding (${calls.embed.length - before})`, calls.embed.length === before)
  await shot(name, title, [{ label: SAVED, note: note(r), body: r.body }, { label: 'the log', text: named.join('\n') }])
}
await fallback(nofile, 'no-file', 'lane 5', NONE, 'Lane 5: no vector file')
await fallback(wrong, 'wrong-size', 'lane 8', `${WRONG} refused: 512 numbers a row`, 'Lane 8: a file of 512 numbers a row')

{
  const results = []
  for (const q of [SAVED, POLITICS]) {
    const r = await ask(down, q), ref = await ask(nokey, q)
    results.push({ label: q, note: note(r), body: r.body })
    ok(`lane 9: with the embedding endpoint ${/politics/i.test(q) ? 'hanging' : 'failing'}, "${q}" answers the expansion's ten best within 2 s (${note(r)})`, r.ms < 2000 && r.body?.by === 'matches' && JSON.stringify(keysOf(r.body)) === JSON.stringify(keysOf(ref.body)) && keysOf(r.body).length === 10)
  }
  ok(`lane 9: the stand-in saw both calls (${calls.embed.filter(c => c.way === '/flaky').length})`, calls.embed.filter(c => c.way === '/flaky').length === 2)
  await shot('embed-down', 'Lane 9: the embedding endpoint fails or hangs', results)
}

{
  const Q = 'tell me about the quorbleflax of zzyzx'
  const before = calls.embed.length, logged = embeddingLines(base).length
  const r = await ask(base, Q)
  ok(`lane 10: a question whose expansion finds nothing answers an empty list (${JSON.stringify(r.body)})`, r.body?.state === 'ok' && r.body?.by === 'matches' && r.body?.items?.length === 0)
  ok(`lane 10: … and makes no embedding call (${calls.embed.length - before} seen, ${embeddingLines(base).length - logged} logged)`, calls.embed.length === before && embeddingLines(base).length === logged)
  await shot('empty', 'Lane 10: an expansion that finds nothing', [{ label: Q, note: note(r), body: r.body }])
}

{
  const COATES = 'what does Coates say of the love of God', OTHERS = 'what do the other writings say of the love of God'
  const all = candidates(OTHER.phrases, [{ book: 43, chapter: 3, verse: 16 }], asTyped)
  const rowCount = new Map()
  for (const id of all) { const k = Buffer.from(vec.row(id)).toString('base64'); rowCount.set(k, (rowCount.get(k) ?? 0) + 1) }
  const alone = id => rowCount.get(Buffer.from(vec.row(id)).toString('base64')) === 1
  const coates = all.find(id => placeOf.get(id).author === 'coates' && alone(id))
  const other = all.find(id => ['other', 'misc'].includes(placeOf.get(id).collection) && !['coates', 'stoney', 'raven'].includes(placeOf.get(id).author) && alone(id))
  toward.set(COATES, coates)
  toward.set(OTHERS, other)
  const env = { ...process.env, BEREAN_DB: base.db, NO_COLOR: '1' }
  const cli = (...args) => execFileSync(BIN, args, { env, encoding: 'utf8' }).trim()
  const hidden = body => (body?.items ?? []).filter(i => ['coates', 'stoney', 'raven'].includes(i.author))
  const r1961 = await ask(base, COATES), o1961 = await ask(base, OTHERS)
  ok(`lane 6: in the 1961 edition Coates's paragraph is the nearest (${keysOf(r1961.body)[0]}, wanted ${keyOfId(coates)})`, keysOf(r1961.body)[0] === keyOfId(coates))
  console.log(cli('edition', 'set', '1890'))
  await sleep(11000)
  const r1890 = await ask(base, COATES)
  ok(`lane 6: in the 1890 edition no paragraph of a hidden author is answered (${hidden(r1890.body).length} of ${r1890.body?.items?.length}; ${note(r1890)})`, r1890.body?.by === 'meaning' && r1890.body?.items?.length === 10 && hidden(r1890.body).length === 0)
  ok(`lane 6: … the other writings still are in 1890 (${keysOf(o1961.body)[0]})`, keysOf(o1961.body)[0] === keyOfId(other) && keysOf((await ask(base, OTHERS)).body)[0] === keyOfId(other))
  console.log(cli('cleanse'))
  await sleep(11000)
  const cleansed = await ask(base, OTHERS)
  const hiddenCollections = (cleansed.body?.items ?? []).filter(i => ['other', 'misc'].includes(i.work.collection))
  ok(`lane 6: under the cleanse no paragraph of a hidden collection is answered (${hiddenCollections.length}; ${note(cleansed)})`, cleansed.body?.items?.length === 10 && hiddenCollections.length === 0 && hidden(cleansed.body).length === 0)
  console.log(cli('cleanse', 'undo'))
  console.log(cli('edition', 'set', '1961'))
  await shot('edition', 'Lane 6: the edition and the cleanse', [{ label: `1961: ${COATES}`, note: note(r1961), body: r1961.body }, { label: `1890: ${COATES}`, note: note(r1890), body: r1890.body }, { label: `cleanse: ${OTHERS}`, note: note(cleansed), body: cleansed.body }])
}

{
  const dir = `${OUT}/rebuild`
  mkdirSync(dir, { recursive: true })
  cpSync(MINISTRY_DB, `${dir}/ministry.db`)
  cpSync(CACHE, `${dir}/cache`, { recursive: true })
  const changed = new DatabaseSync(`${dir}/ministry.db`)
  const id = changed.prepare('SELECT min(p.id) AS id FROM paras p JOIN authors a ON a.id = p.author WHERE a.enabled = 1').get().id
  changed.prepare('UPDATE paras SET text = text || ? WHERE id = ?').run(` (changed ${Date.now()})`, id)
  changed.close()
  const before = calls.embed.length
  const tool = spawn('python3', ['tools/embed_ministry.py', '--db', `${dir}/ministry.db`, '--cache', `${dir}/cache`, '--out', `${dir}/vec.bin`, '--url', STUB], { env: { ...process.env, BEREAN_EMBED_KEY: 'test-embed-key' } })
  let said = ''
  tool.stdout.on('data', c => { said += c })
  tool.stderr.on('data', c => { said += c })
  const code = await new Promise(r => tool.on('close', r))
  console.log(said.trim())
  ok(`lane 7: the tool exits 0 (${code})`, code === 0)
  const sent = calls.embed.slice(before)
  ok(`lane 7: after one paragraph changed the tool embeds one paragraph and says so ("${/embedded .*$/m.exec(said)?.[0]}")`, /^embedded 1 paragraph \(1 texts\) in 1 requests: \d+ tokens, \$[0-9.]+$/m.test(said) && /, 1 to embed with /.test(said))
  ok(`lane 7: … the stand-in got one request of one text (${sent.map(c => c.inputs.length).join(', ')})`, sent.length === 1 && sent[0].inputs.length === 1 && sent[0].format === 'base64' && sent[0].auth)
  const rebuilt = existsSync(`${dir}/vec.bin`) ? openVectors(`${dir}/vec.bin`) : { count: 0, ids: [] }
  const differ = []
  if (rebuilt.count === vec.count && JSON.stringify(rebuilt.ids) === JSON.stringify(vec.ids)) for (const p of vec.ids) if (Buffer.compare(Buffer.from(vec.row(p)), Buffer.from(rebuilt.row(p))) !== 0) differ.push(p)
  ok(`lane 7: … and the file it writes differs from the first in that paragraph's row alone (${differ.length} rows differ: ${differ.slice(0, 3).join(', ')}; paragraph ${id})`, differ.length === 1 && differ[0] === id)
  await shot('rebuild', 'Lane 7: the vector file rebuilt after one paragraph changed', [{ label: 'tools/embed_ministry.py', text: said }, { label: 'rows that differ', text: differ.join(', ') }])
}

await browser.close()
stub.close()
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
