// Passages by meaning against the real models (docs/SEARCH_EXPAND.md): the investigation's 16 questions asked of a
// server that has BEREAN_AI_KEY and BEREAN_EMBED_KEY in its own environment. This script never reads a key; it asks
// BASE, twice per question, and writes each question's ten paragraphs as `paras.id`s for the judge to grade.
//
//   BASE=… [QUERIES=queries.json] [MINISTRY_DB=data/ministry.db] [SERVER_LOG=…] [OUT=…] node scripts/passages-live.mjs
//
// QUERIES is a JSON list of { q } (scratch/ai-search-probe/queries.json). MINISTRY_DB is the server's library, read to
// turn each item back into its id; the server must not be under the cleanse, which renumbers the Synopsis's
// paragraphs. SERVER_LOG, the server's log, gives the tokens of each embedding call and so the cost of a new question.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const queries = JSON.parse(readFileSync(process.env.QUERIES ?? '/home/ubuntu/work-dev/scratch/ai-search-probe/queries.json', 'utf8')).map(x => x.q)
const out = process.env.OUT ?? '/tmp/v2-24/live'
mkdirSync(out, { recursive: true })
const PRICE = 0.02 / 1e6
let passed = 0, failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (cond) passed++; else failed++ }
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }
const lib = new DatabaseSync(process.env.MINISTRY_DB ?? 'data/ministry.db', { readOnly: true })
const idOf = lib.prepare('SELECT id FROM paras WHERE author = ? AND work = ? AND n = ? AND i = ?')
const ask = async q => {
  const t = performance.now()
  const r = await fetch(`${base}/api/ministry/passages?q=${encodeURIComponent(q)}`)
  const body = await r.json().catch(() => null)
  return { ms: performance.now() - t, body }
}
const logged = () => process.env.SERVER_LOG ? readFileSync(process.env.SERVER_LOG, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(l => l.includes('embedding call')) : []

const before = logged().length
const rows = []
for (const q of queries) {
  const first = await ask(q)
  const again = await ask(q)
  const p = first.body
  const ids = (p?.items ?? []).map(i => idOf.get(i.author, i.work.id, i.n, i.para)?.id ?? null)
  rows.push({ q, state: p?.state, by: p?.by, ids, newMs: first.ms, cachedMs: again.ms, same: JSON.stringify(again.body) === JSON.stringify(p) })
  console.log(`${p?.by ?? 'no answer'} ${p?.state ?? ''} ${ids.length} ${first.ms.toFixed(0)} ms, again ${again.ms.toFixed(1)} ms  ${q}`)
}
ok(`every question is answered by meaning (${rows.filter(r => r.by === 'meaning').length} of ${rows.length})`, rows.length === 16 && rows.every(r => r.state === 'ok' && r.by === 'meaning'))
ok(`no question is left without a passage (${rows.filter(r => !r.ids.length).length} without)`, rows.every(r => r.ids.length > 0))
ok(`every item is a paragraph of MINISTRY_DB (${rows.flatMap(r => r.ids).filter(i => i === null).length} not found)`, rows.every(r => r.ids.every(i => i !== null)))
ok(`asked again, every answer is the same (${rows.filter(r => !r.same).length} differ)`, rows.every(r => r.same))
const newMs = median(rows.map(r => r.newMs)), cachedMs = median(rows.map(r => r.cachedMs))
// a new question waits for the expansion's model call (1.4 s at the median when measured alone) and then, only if that
// found paragraphs, for the embedding: 1500 ms held only on a server that already had the expansions
ok(`a new question's median at most 2500 ms (${newMs.toFixed(0)} ms)`, newMs <= 2500)
ok(`a question asked again, median at most 150 ms (${cachedMs.toFixed(1)} ms)`, cachedMs <= 150)
if (process.env.SERVER_LOG) {
  const calls = logged().slice(before).map(l => Number(/tokens=(\d+)/.exec(l)?.[1] ?? NaN))
  const cost = calls.reduce((s, t) => s + t * PRICE, 0) / calls.length
  ok(`${calls.length} embedding calls, a new question's embedding at most a thousandth of a cent ($${cost.toFixed(8)}; tokens ${calls.join(' ')})`, calls.length === rows.length && cost <= 0.00001)
}
writeFileSync(`${out}/passages-16.json`, JSON.stringify(rows.map(({ q, by, ids }) => ({ q, by, ids })), null, 1))
writeFileSync(`${out}/passages-16-times.json`, JSON.stringify(rows, null, 1))
console.log(`wrote ${out}/passages-16.json`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
