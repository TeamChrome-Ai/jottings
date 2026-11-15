// Ask's lanes and its cost on several models, one server each (docs/ASSISTANT.md, "Choosing the model"). It starts and
// restarts nothing: the root starts one server per model, each with BEREAN_CHAT_MODEL set and its own log, and names
// them here as model,base,log:
//
//   node scripts/assistant-models.mjs gpt-6.1-terra,http://127.0.0.1:8801,/tmp/terra.log gpt-6-luna,http://127.0.0.1:8802,/tmp/luna.log
//
// Each runs scripts/assistant-live.mjs (SEEDED, MESSAGES and the PRICE_ variables pass through). It prints each model's
// lanes passed, the mean cost of a reader message from the logged tokens, and the median times.
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'

const models = process.argv.slice(2).map(a => { const [model, base, log] = a.split(','); return { model, base, log } })
if (!models.length || models.some(m => !m.model || !m.base || !m.log)) { console.log('name each model as model,base,log'); process.exit(1) }
let passed = 0, failed = 0
const rows = []
for (const m of models) {
  const json = `/tmp/assistant-models-${m.model}.json`
  rmSync(json, { force: true })
  console.log(`\n== ${m.model} at ${m.base}`)
  const run = spawnSync(process.execPath, ['scripts/assistant-live.mjs'], { stdio: 'inherit', env: { ...process.env, BASE: m.base, SERVER_LOG: m.log, MODEL: m.model, JSON: json } })
  let s = null
  try { s = JSON.parse(readFileSync(json, 'utf8')) } catch { /* the run stopped before its summary */ }
  const ok = run.status === 0 && !!s
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${m.model}: every lane passed`)
  if (ok) passed++; else failed++
  rows.push({ model: m.model, s })
}
console.log('\nmodel               lanes passed        checks   $ / message   uncached in   cached in   out       first word   message')
for (const { model, s } of rows) {
  if (!s) { console.log(`${model.padEnd(19)} no summary`); continue }
  const lanes = Object.entries(s.lanes).map(([k, v]) => `${k}${v ? '' : '✗'}`).join(' ')
  console.log(`${model.padEnd(19)} ${lanes.padEnd(19)} ${`${s.passed}/${s.passed + s.failed}`.padEnd(8)} ${s.mean_cost_usd.toFixed(5).padEnd(13)} ${String(s.tokens.uncached).padEnd(13)} ${String(s.tokens.cached).padEnd(11)} ${String(s.tokens.completion).padEnd(9)} ${String(s.median_first_word_ms).padEnd(12)} ${s.median_message_ms}`)
}
console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
