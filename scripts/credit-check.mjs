// Reading credit against a LOCAL plaintext server: a chapter counts only once its end is reached AND the time on it
// matches its length (shared/reading.ts; rs/src/activity.rs). Real time: the server times beats by its own clock.
// Also shoots the book picker with its testament labels at 412 px.
//   BASE=http://127.0.0.1:8799 BEREAN_DATA=/tmp/wt-credit/data OUT=/tmp/wt-credit node scripts/credit-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const base = process.env.BASE ?? 'http://127.0.0.1:8799'
const out = process.env.OUT ?? '/tmp/credit-check'
const dataDir = process.env.BEREAN_DATA ?? '/tmp/wt-credit/data'
mkdirSync(out, { recursive: true })

const failures = [], errors = []
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
const json = { 'content-type': 'application/json' }
const handle = `cr${Date.now().toString(36)}`
const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: json, body: JSON.stringify({ handle, display_name: 'Credit reader', password: 'credit-pw-12345' }) })
const { token, user } = await reg.json()
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch()
const credits = (book, chapter) => {
  const db = new DatabaseSync(`${dataDir}/berean.db`, { readOnly: true })
  const n = db.prepare('SELECT count(*) n FROM page_credits WHERE user_id=? AND book=? AND chapter=?').get(user.id, book, chapter).n
  db.close()
  return n
}
const dwell = (sid, book, chapter) => {
  const db = new DatabaseSync(`${dataDir}/berean.db`, { readOnly: true })
  const r = db.prepare('SELECT active_seconds, reached_end FROM chapter_dwell WHERE session_id=? AND book=? AND chapter=?').get(sid, book, chapter)
  db.close()
  return r
}

/** A fresh page (a new session id) on `book` `chapter`; its beats are recorded with the time since the page opened. */
async function open(name, book, chapter) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([p, d]) => { localStorage.setItem('berean_prefs', JSON.stringify(p)); localStorage.setItem('berean_token', d.token); localStorage.setItem('berean_user', JSON.stringify(d.user)) }, [prefs, { token, user }])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  const beats = []
  const t0 = Date.now()
  page.on('response', async r => {
    if (!r.url().endsWith('/api/activity/beat')) return
    try { beats.push({ at: (Date.now() - t0) / 1000, sent: JSON.parse(r.request().postData() ?? '{}'), got: await r.json() }) } catch { /* page closed */ }
  })
  await page.goto(`${base}/read/${book}/${chapter}`, { waitUntil: 'networkidle' })
  await page.waitForSelector(`[aria-label^="${name} chapter ${chapter}"]`)
  await page.waitForTimeout(1500)
  return { ctx, page, beats, t0, credited: () => beats.find(b => b.got.credited?.book === book && b.got.credited?.chapter === chapter) }
}
/** One wheel from the top straight to the bottom (a run begun away from the end never turns the chapter). */
async function blastToBottom(page) {
  await page.mouse.move(206, 400)
  await page.mouse.wheel(0, 60_000)
  await page.waitForTimeout(800)
  return page.evaluate(() => [...document.querySelectorAll('div')].some(d => { const r = d.getBoundingClientRect(); return d.scrollHeight > d.clientHeight + 50 && r.left >= 0 && r.left < 10 && r.width > 300 && getComputedStyle(d).overflowY !== 'visible' && d.scrollTop + d.clientHeight >= d.scrollHeight - 4 }))
}
const readMark = async (page, name, chapter) => (await page.locator(`[aria-label="${name} chapter ${chapter}, read"]`).count()) > 0

// A. John 1 (996 words: 149 s). Straight to the bottom, then 45 s there: the end is reached, the time is not.
{
  const { ctx, page, beats, credited } = await open('John', 43, 1)
  check(await blastToBottom(page), 'A: one wheel reached the bottom of John 1')
  await page.waitForTimeout(45_000)
  const sid = beats[0]?.sent.session_id
  const d = dwell(sid, 43, 1)
  check(beats.some(b => b.sent.reached_end), `A: beats say the end was reached (${beats.map(b => `${b.at.toFixed(0)}s:${b.sent.reached_end ? 'end' : '-'}`).join(' ')})`)
  check(!credited() && credits(43, 1) === 0, `A: scroll blast + 45 s is not credited (dwell ${d?.active_seconds} s of 149, reached_end ${d?.reached_end})`)
  check(!(await readMark(page, 'John', 1)), 'A: no read mark on John 1')
  await ctx.close()
}

// B. Revelation 15 (244 words: 37 s). 50 s at the top, never the bottom: the time is there, the end is not.
//    Then to the bottom: credited at once, the time already spent.
{
  const { ctx, page, beats, credited } = await open('Revelation', 66, 15)
  await page.waitForTimeout(50_000)
  const sid = beats[0]?.sent.session_id
  const d = dwell(sid, 66, 15)
  check(!!d && d.active_seconds >= 37 && d.reached_end === 0, `B: 50 s at the top: dwell ${d?.active_seconds} s ≥ 37, reached_end ${d?.reached_end}`)
  check(!credited() && credits(66, 15) === 0, 'B: a dwell without reaching the bottom is not credited')
  check(!(await readMark(page, 'Revelation', 15)), 'B: no read mark on Revelation 15')
  const before = Date.now()
  check(await blastToBottom(page), 'B: then scrolled to the bottom')
  while (!credited() && Date.now() - before < 20_000) await page.waitForTimeout(250)
  const c = credited()
  check(!!c && credits(66, 15) === 1, `B: the bottom reached after the time is credited (${((Date.now() - before) / 1000).toFixed(1)} s after the scroll)`)
  await page.waitForTimeout(800)
  check(await readMark(page, 'Revelation', 15), 'B: the read mark appears on Revelation 15')
  await ctx.close()
}

// C. 1 John 1 (247 words: 37 s). Bottom at once, then stay: credited once 37 s have passed, not before.
{
  const { ctx, page, beats, credited } = await open('1 John', 62, 1)
  check(await blastToBottom(page), 'C: at the bottom of 1 John 1')
  const until = Date.now() + 60_000
  while (!credited() && Date.now() < until) await page.waitForTimeout(250)
  const c = credited()
  const d = dwell(beats[0]?.sent.session_id, 62, 1)
  check(!!c && credits(62, 1) === 1, `C: bottom + dwell is credited (at ${c?.at.toFixed(1)} s after opening, dwell ${d?.active_seconds} s)`)
  check(!!c && c.at >= 37, `C: not before the 37 s the chapter asks (${c?.at.toFixed(1)} s; beats ${beats.map(b => `${b.at.toFixed(0)}s${b.got.credited ? '*' : ''}`).join(' ')})`)
  await page.waitForTimeout(800)
  check(await readMark(page, '1 John', 1), 'C: the read mark appears on 1 John 1')
  // the picker at 412 px: the books under their testament labels, the New Testament's with the accent wash
  await page.getByText('1 John 1 ▾').click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/picker-412.png` })
  check(await page.getByText('New Testament', { exact: true }).isVisible() && await page.getByText('Old Testament', { exact: true }).isVisible(), 'picker: both testament labels show')
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify({ out, errors, failures }, null, 1))
process.exit(failures.length || errors.length ? 1 : 0)
