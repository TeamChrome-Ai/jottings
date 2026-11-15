// The other wordings against the real model (docs/SEARCH_EXPAND.md): the investigation's 16 questions asked of a server
// that has BEREAN_AI_KEY in its own environment. This script never reads a key; it asks BASE, twice per question.
//
//   BASE=… [QUERIES=queries.json] [SERVER_LOG=…] [OUT=…] node scripts/search-expand-live.mjs
//
// QUERIES is a JSON list of { q } (scratch/ai-search-probe/queries.json). SERVER_LOG, the server's log, gives the tokens
// of each model call and so the cost of a new question at Haiku 5.5's prices.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const queries = JSON.parse(readFileSync(process.env.QUERIES ?? '/home/ubuntu/work-dev/scratch/ai-search-probe/queries.json', 'utf8')).map(x => x.q)
const out = process.env.OUT ?? '/tmp/swarm-v2-23/owner'
mkdirSync(out, { recursive: true })
const PRICE_IN = 0.10 / 1e6, PRICE_OUT = 0.50 / 1e6
let passed = 0, failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (cond) passed++; else failed++ }
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN }
const ask = async q => {
  const t = performance.now()
  const r = await fetch(`${base}/api/ministry/expand?q=${encodeURIComponent(q)}`)
  const body = await r.json().catch(() => null)
  return { ms: performance.now() - t, body }
}
const logged = () => process.env.SERVER_LOG ? readFileSync(process.env.SERVER_LOG, 'utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter(l => l.includes('model call')) : []

const before = logged().length
const rows = []
for (const q of queries) {
  const first = await ask(q)
  const again = await ask(q)
  const e = first.body
  const found = [...(e?.phrases ?? []), ...(e?.verses ?? [])].some(i => i.total > 0)
  rows.push({ q, state: e?.state, found, newMs: first.ms, cachedMs: again.ms, phrases: e?.phrases ?? [], verses: e?.verses ?? [], related: e?.related ?? [] })
  console.log(`${found ? 'found' : 'none '} ${e?.state ?? 'no answer'} ${first.ms.toFixed(0)} ms, again ${again.ms.toFixed(0)} ms  ${q}`)
}
const hits = rows.filter(r => r.found).length
ok(`at least 15 of ${rows.length} questions find a phrase or a verse (${hits})`, rows.length === 16 && hits >= 15)
const newMs = median(rows.map(r => r.newMs)), cachedMs = median(rows.map(r => r.cachedMs))
ok(`a new question's median under 4000 ms (${newMs.toFixed(0)} ms)`, newMs < 4000)
ok(`a question asked again, median under 100 ms (${cachedMs.toFixed(1)} ms)`, cachedMs < 100)
if (process.env.SERVER_LOG) {
  const calls = logged().slice(before).map(l => ({ input: Number(/input_tokens=(\d+)/.exec(l)?.[1] ?? 0), output: Number(/output_tokens=(\d+)/.exec(l)?.[1] ?? 0) }))
  const cost = calls.length ? calls.reduce((s, c) => s + c.input * PRICE_IN + c.output * PRICE_OUT, 0) / calls.length : NaN
  ok(`${calls.length} model calls, mean cost of a new question under a fiftieth of a cent ($${cost.toFixed(6)}; ${calls.map(c => `${c.input}+${c.output}`).join(' ')})`, calls.length > 0 && cost < 0.0002)
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const html = `<!doctype html><meta charset="utf-8"><style>body{font:14px system-ui;margin:16px}td{vertical-align:top;padding:4px 8px;border-top:1px solid #ddd}.n{color:#777}</style>
<h3>${hits} of ${rows.length} questions find a phrase or a verse · new ${newMs.toFixed(0)} ms, again ${cachedMs.toFixed(1)} ms (medians)</h3><table>
${rows.map(r => `<tr><td>${r.found ? '✓' : '✗'}</td><td><b>${esc(r.q)}</b> <span class="n">${r.state}</span></td><td>${r.phrases.map(p => `${esc(p.text)} <span class="n">${p.total}</span>`).join('<br>')}</td><td>${r.verses.map(v => `${v.book}.${v.chapter}.${v.verse} <span class="n">${v.total}</span>`).join('<br>')}</td><td>${r.related.map(p => `${esc(p.text)} <span class="n">${p.total}</span>`).join('<br>')}</td></tr>`).join('\n')}
</table>`
writeFileSync(`${out}/live-16.html`, html)
writeFileSync(`${out}/live-16.json`, JSON.stringify(rows, null, 1))
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
await page.setContent(html)
await page.screenshot({ path: `${out}/live-16.png`, fullPage: true })
await browser.close()
console.log(`shot ${out}/live-16.png`)
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
