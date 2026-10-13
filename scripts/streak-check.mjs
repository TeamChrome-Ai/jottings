// Stats screen, badge marks and the lit Stats tab against a LOCAL plaintext server (no BEREAN_DB_KEY), seeding a
// reader whose streak is alive today and who holds every milestone badge. First, the local-day proof: a browser pinned
// to America/Denver at 21:30 (already the next day in UTC) reads a chapter, and the day credited must be Denver's.
//   BASE=http://127.0.0.1:8799 BEREAN_DATA=/tmp/wt-streak-data OUT=/tmp/wt-streak/shots node scripts/streak-check.mjs
//   TZ_ONLY=1 runs the local-day proof alone.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const base = process.env.BASE ?? 'http://127.0.0.1:8799'
const out = process.env.OUT ?? '/tmp/streak-check'
const dataDir = process.env.BEREAN_DATA ?? '/tmp/wt-streak-data'
mkdirSync(out, { recursive: true })

const LOCKED = new Set(['pages_500', 'gospels', 'pentateuch', 'nt', 'ot', 'bible', 'group_joined'])
async function seed() {
  const json = { 'content-type': 'application/json' }
  const body = JSON.stringify({ handle: 'streaker', display_name: 'Streak reader', password: 'streak-pw-12345' })
  const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: json, body })
  const token = reg.ok ? (await reg.json()).token : (await (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: json, body })).json()).token
  const me = await (await fetch(`${base}/api/me`, { headers: { authorization: `Bearer ${token}` } })).json()
  const uid = me.user.id
  const db = new DatabaseSync(`${dataDir}/berean.db`)
  const day = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10) }
  const ins = db.prepare('INSERT OR REPLACE INTO activity_days (user_id, date, active_seconds, pages, chapters) VALUES (?, ?, ?, ?, ?)')
  for (let i = 0; i < 12; i++) ins.run(uid, day(i), 900 + i * 40, 3, 2)
  const codes = (await (await fetch(`${base}/api/stats`, { headers: { authorization: `Bearer ${token}` } })).json()).badges.map(b => b.code)
  const bd = db.prepare('INSERT OR REPLACE INTO badges (user_id, code, earned_at) VALUES (?, ?, ?)')
  codes.filter(c => !LOCKED.has(c)).forEach((c, i) => bd.run(uid, c, `${day(i % 12)}T09:30:00.000Z`))
  db.close()
  return { token, user: me.user }
}

// ---------------- local-day proof ----------------
const ZONE = 'America/Denver'
/** Minutes east of UTC that `zone` keeps at instant `t`. */
function zoneOffset(zone, t) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(new Date(t)).find(p => p.type === 'timeZoneName').value
  const m = name.match(/GMT([+-])(\d\d):(\d\d)/)
  return m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0
}
/** The instant a wall clock in `zone` reads `day` `hh:mm`. */
function wallClock(zone, day, hh, mm) {
  const naive = Date.parse(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`)
  let t = naive
  for (let i = 0; i < 2; i++) t = naive - zoneOffset(zone, t) * 60_000
  return t
}
const shiftDay = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

async function localDayCheck() {
  const failures = []
  const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what) }
  // The server keeps its real clock and judges "today" as its clock shifted by the reader's offset, so the pinned
  // Denver day must be the server's own Denver-local today, whatever the real UTC time is: the browser then reads
  // at 21:30 on that day, which is 03:30 (04:30 in winter) the NEXT day in UTC, and the credit must stay on it.
  const serverUtc = new Date().toISOString().slice(0, 10)
  const offsetNow = zoneOffset(ZONE, Date.now())
  const local = new Date(Date.now() + offsetNow * 60000).toISOString().slice(0, 10)
  const at = wallClock(ZONE, local, 21, 30)
  const offset = zoneOffset(ZONE, at)
  console.log(`browser: ${ZONE} ${local} 21:30 = ${new Date(at).toISOString()} (offset ${offset} min); server UTC date ${serverUtc}`)
  check(new Date(at).toISOString().slice(0, 10) === shiftDay(local, 1), 'the pinned instant is already the next day in UTC')

  const json = { 'content-type': 'application/json' }
  const handle = `tz${Date.now().toString(36)}`
  const reg = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: json, body: JSON.stringify({ handle, display_name: 'Denver reader', password: 'denver-pw-12345' }) })
  const { token, user } = await reg.json()

  const ctx = await browser.newContext({ viewport: { width: 390, height: 1400 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: ZONE })
  await ctx.clock.install({ time: at })
  await ctx.addInitScript(([p, d]) => { localStorage.setItem('berean_prefs', JSON.stringify(p)); localStorage.setItem('berean_token', d.token); localStorage.setItem('berean_user', JSON.stringify(d.user)) }, [prefs('paper', true), { token, user }])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`tz: ${e.message}`))
  const beats = []
  page.on('response', async r => {
    if (!r.url().endsWith('/api/activity/beat')) return
    try { beats.push({ sent: JSON.parse(r.request().postData() ?? '{}'), got: await r.json() }) } catch { /* page closed */ }
  })
  await page.goto(`${base}/read/43/3`, { waitUntil: 'networkidle' })
  const wall = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` })
  check(wall.startsWith(`${local} 21:3`), `the browser clock reads 21:3x on the local day (${wall})`)
  // beats every 15 s; 30 s earned shows as "1m" on the Stats screen
  const until = Date.now() + 100_000
  while (Date.now() < until && !beats.some(b => b.got.active_seconds_today >= 30)) { await page.mouse.wheel(0, 200); await page.waitForTimeout(2000) }
  const earning = beats.findLast(b => b.got.active_seconds_today > 0)
  check(beats.length > 0 && beats.every(b => b.sent.local_date === local && b.sent.tz_offset_min === offset), `every beat sent local_date ${local} and tz_offset_min ${offset} (${beats.length} beats: ${[...new Set(beats.map(b => `${b.sent.local_date}/${b.sent.tz_offset_min}`))].join(', ')})`)
  check(!!earning && earning.got.date === local && earning.got.streak.today === local, `the server credited ${local}, not UTC ${serverUtc} (got ${earning?.got.date}, ${earning?.got.active_seconds_today} s)`)

  const db = new DatabaseSync(`${dataDir}/berean.db`, { readOnly: true })
  const days = db.prepare('SELECT date, active_seconds FROM activity_days WHERE user_id=?').all(user.id)
  const stored = db.prepare('SELECT tz_offset_min FROM users WHERE id=?').get(user.id)
  db.close()
  check(days.length === 1 && days[0].date === local, `activity_days holds ${local} only (${JSON.stringify(days)})`)
  check(stored?.tz_offset_min === offset, `users.tz_offset_min = ${offset} (${stored?.tz_offset_min})`)

  // the Stats screen at the same moment: today is the Denver day, ringed in the week strip, with the seconds just read
  await page.goto(`${base}/stats`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const todayLabel = await page.locator('[aria-label*=", today"]').first().getAttribute('aria-label').catch(() => null)
  const weekday = new Date(`${local}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
  const expectName = weekday === 'Sunday' ? 'Lord’s day' : weekday
  check(!!todayLabel && todayLabel.startsWith(expectName), `the week strip rings ${expectName} (${todayLabel})`)
  const todayLine = await page.getByText(/ of .* today$/).first().textContent().catch(() => null)
  check(!!todayLine && todayLine.startsWith(`${Math.round(earning?.got.active_seconds_today / 60)}m of`) && !todayLine.startsWith('0m'), `the today line counts the Denver evening (${todayLine})`)
  await page.screenshot({ path: `${out}/stats-denver-2130.png` })
  const api = await (await fetch(`${base}/api/stats?tz=${offset}`, { headers: { authorization: `Bearer ${token}` } })).json()
  check(api.streak.today === local && api.streak.today_active_seconds > 0, `GET /stats?tz=${offset} judges ${local} (today ${api.streak.today}, ${api.streak.today_active_seconds} s)`)
  await ctx.close()
  return failures
}

const prefs = (theme, reduceMotion = false) => ({ theme, themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion, align: 'center', width: 'medium' })
const DARK = new Set(['midnight', 'black-white'])
const browser = await chromium.launch()
const errors = []
const tzFailures = await localDayCheck()
if (process.env.TZ_ONLY) {
  await browser.close()
  console.log(JSON.stringify({ out, errors, tzFailures }, null, 1))
  process.exit(tzFailures.length || errors.length ? 1 : 0)
}
const demo = await seed()
async function shot(name, path, theme, { signedIn = true, reduceMotion = false, wait = 2600, height = 2200, at } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: DARK.has(theme) ? 'dark' : 'light' })
  if (at) await ctx.clock.install({ time: at })
  await ctx.addInitScript(([p, d]) => { localStorage.setItem('berean_prefs', JSON.stringify(p)); if (d) { localStorage.setItem('berean_token', d.token); localStorage.setItem('berean_user', JSON.stringify(d.user)) } }, [prefs(theme, reduceMotion), signedIn ? demo : null])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`) })
  await page.goto(base + path, { waitUntil: 'networkidle' })
  if (Array.isArray(wait)) {
    for (const [i, ms] of wait.entries()) { await page.waitForTimeout(ms); await page.screenshot({ path: `${out}/${name}-${i}.png` }) }
  } else {
    await page.waitForTimeout(wait)
    await page.screenshot({ path: `${out}/${name}.png` })
  }
  const tab = page.getByRole('tab', { name: /Stats/ }).or(page.getByRole('link', { name: /Stats/ })).first()
  if (await tab.count()) await tab.screenshot({ path: `${out}/${name}-tab.png` })
  await ctx.close()
}

for (const t of ['paper', 'midnight', 'black-white']) await shot(`stats-${t}`, '/stats', t)
await shot('stats-paper-motion', '/stats', 'paper', { wait: [350, 250, 300] })
await shot('stats-paper-reduce', '/stats', 'paper', { reduceMotion: true, wait: 1500 })
await shot('home-paper', '/', 'paper', { height: 1000 })
await shot('home-midnight', '/', 'midnight', { height: 1000 })
await shot('home-signed-out', '/', 'paper', { signedIn: false, height: 1000 })
// the browser's clock on the next Lord's day: the header names it and the strip starts a fresh week
const sunday = new Date(); sunday.setUTCDate(sunday.getUTCDate() + ((7 - sunday.getUTCDay()) % 7 || 7)); sunday.setUTCHours(12, 0, 0, 0)
// Reduce animation keeps this shot independent of the faked timers (everything drawn at rest)
await shot('home-lordsday', '/', 'paper', { height: 1400, at: sunday, reduceMotion: true })
await browser.close()
console.log(JSON.stringify({ out, errors, tzFailures }, null, 1))
if (tzFailures.length) process.exitCode = 1
