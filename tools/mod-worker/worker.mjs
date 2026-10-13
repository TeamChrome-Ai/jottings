#!/usr/bin/env node
// Report judge for the app, run on a machine that has the `grok` CLI signed in with a subscription.
// Polls the app server for queued report jobs, asks Grok for a structured verdict, posts it back. The rules are the
// server's: every job carries the judge's instructions and the answer format (rs/moderation/rules.json), and the
// server alone decides which verdicts it honours (rs/src/moderation.rs, settle). There is no policy in this file.
// No API keys: the only secret is the worker token shared with the server (BEREAN_MOD_WORKER_TOKEN in /etc/berean.env).
//   env: BDB_WORKER_TOKEN=...  [BDB_API=the server; default: `site` of shared/brand.json]  [GROK_BIN=grok] [POLL_SECS=20]
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { promisify } from 'node:util'
const run = promisify(execFile)
const BRAND = JSON.parse(readFileSync(new URL('../../shared/brand.json', import.meta.url), 'utf8'))
const API = (process.env.BDB_API ?? BRAND.site).replace(/\/+$/, '')
const TOKEN = process.env.BDB_WORKER_TOKEN
const GROK = process.env.GROK_BIN ?? 'grok'
const POLL = Number(process.env.POLL_SECS ?? 20) * 1000
if (!TOKEN) { console.error('BDB_WORKER_TOKEN is required'); process.exit(1) }

const SCHEMA = JSON.stringify({ type: 'object', properties: { verdict: { type: 'string', enum: ['allow', 'hide', 'ban', 'escalate'] }, category: { type: 'string' }, reason: { type: 'string' }, confidence: { type: 'number' } }, required: ['verdict', 'category', 'reason', 'confidence'] })
// What a job from an older server lacks: one that sends no rules gets no verdict but escalate, and one that sends its
// rules without the answer format is asked for the category by the name its own rules give it.
const NO_RULES = `You have not been given the rules of the service this content was shared on: answer escalate.`
const ANSWER = `category: one lowercase word, the name the rules above give the rule that applies (none when nothing applies, other when no name fits). reason: one or two sentences a human moderator can act on. confidence 0..1.`

async function judge(job) {
  const prompt = `${job.rules ?? NO_RULES}\n${job.answer ?? ANSWER}\n\nReport kind: ${job.kind}\nReporter's reason: ${job.reason ?? ''}\nReporter's details: ${job.details ?? ''}\nAuthor: @${job.author ?? '?'}\nRule scanner said: ${job.scan ?? 'n/a'}\n\nContent under review:\n<<<\n${job.preview}\n>>>`
  const { stdout } = await run(GROK, ['-p', prompt, '--output-format', 'json', '--json-schema', SCHEMA, '--disable-web-search', '--no-subagents', '--no-plan', '--tools', '', '--permission-mode', 'dontAsk', '--max-turns', '1'], { timeout: 180_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, TERM: 'dumb' } })
  const out = JSON.parse(stdout)
  const v = out.structuredOutput ?? out
  if (!v || !['allow', 'hide', 'ban', 'escalate'].includes(v.verdict)) throw new Error('no structured verdict in grok output')
  return { verdict: v.verdict, category: String(v.category ?? 'other'), reason: String(v.reason ?? ''), confidence: Number(v.confidence ?? 0.5), judged_by: 'grok' }
}

async function api(path, init = {}) {
  const r = await fetch(`${API}${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}`, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } })
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${await r.text()}`)
  return r.json()
}

for (;;) {
  try {
    const jobs = await api('/api/mod/jobs')
    for (const job of jobs) {
      let verdict
      try { verdict = await judge(job) }
      catch (e) { verdict = { verdict: 'escalate', category: 'other', reason: `Grok judge failed: ${String(e.message ?? e).slice(0, 300)}`, confidence: 0, judged_by: 'grok-error' } }
      await api(`/api/mod/jobs/${job.id}/verdict`, { method: 'POST', body: JSON.stringify(verdict) })
      console.log(new Date().toISOString(), `job ${job.id} (${job.kind}) -> ${verdict.verdict} [${verdict.category}]`)
    }
  } catch (e) { console.error(new Date().toISOString(), 'poll failed:', e.message ?? e) }
  await new Promise(r => setTimeout(r, POLL))
}
