// A tick counts as a chapter read (reports #23, #37), end to end at phone width against a LOCAL plaintext server and
// the web export. Ruth reads a printed Bible: on Stats she taps Romans in Progress by book and ticks 5 to 8; the bar,
// the Bible percent, the Chapters tile and her group's chapter boards move, her streak, time and the calendar's minutes
// do not; a tap takes 8 back; a ticked chapter's end line offers the undo. Signed out the same sheet keeps the marks on
// the device and asks the server nothing; reading with a group, the books cannot be ticked.
//   BASE=http://127.0.0.1:8796 DB=/tmp/ticks/berean.db OUT=/tmp/ticks/shots node scripts/ticks-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const base = process.env.BASE ?? 'http://127.0.0.1:8796'
const dbPath = process.env.DB ?? '/tmp/ticks/berean.db'
const out = process.env.OUT ?? '/tmp/ticks/shots'
mkdirSync(out, { recursive: true })
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }
const api = async (path, init = {}, token) => {
  const r = await fetch(base + '/api' + path, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const stamp = Date.now() % 100000
const mk = async (handle, display_name) => {
  const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ handle, display_name, password: 'ticks-check-1' }) })
  if (r.status !== 200) throw new Error(`register ${handle}: ${JSON.stringify(r.body)}`)
  return { token: r.body.token, user: r.body.user }
}
const day = n => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10)
const ruth = await mk(`ruth${stamp}`, 'Ruth'), naomi = await mk(`naomi${stamp}`, 'Naomi')
const group = (await api('/groups', { method: 'POST', body: JSON.stringify({ name: 'Bethlehem' }) }, ruth.token)).body
await api('/groups/join', { method: 'POST', body: JSON.stringify({ invite_code: group.invite_code }) }, naomi.token)
const event = async (name, metric, extra = {}) => (await api(`/groups/${group.slug}/events`, { method: 'POST', body: JSON.stringify({ name, metric, starts_at: day(1), ends_at: day(-7), ...extra }) }, ruth.token)).body
const chaptersBoard = await event('Autumn chapters', 'chapters'), pagesBoard = await event('Autumn pages', 'pages')
const scoreBoard = await event('Autumn score', 'score', { time_weight: 1, page_weight: 10 })
const boardOf = async ev => (await api(`/groups/${group.slug}/events/${ev.id}/leaderboard`, {}, ruth.token)).body?.rows?.find(r => r.user_id === ruth.user.id)?.value ?? 0

// yesterday's reading in the app: a streak and some time, which the ticks must leave alone
const db = new DatabaseSync(dbPath)
db.prepare('INSERT INTO activity_days (user_id, date, active_seconds, pages, chapters) VALUES (?, ?, ?, ?, ?)').run(ruth.user.id, day(1), 900, 0, 0)
db.close()

const facts = async () => {
  const [s, reads, cal] = await Promise.all([api('/stats', {}, ruth.token), api('/stats/reads', {}, ruth.token), api(`/stats/calendar?from=${day(2)}&to=${day(-1)}`, {}, ruth.token)])
  const minutes = (Array.isArray(cal.body) ? cal.body : cal.body?.days ?? []).reduce((n, d) => n + (d.active_seconds ?? 0), 0)
  return { streak: s.body.streak.current, longest: s.body.streak.longest, time: s.body.total_active_seconds, chapters: s.body.chapters_read, romans: reads.body['45'] ?? [], minutes, boards: [await boardOf(chaptersBoard), await boardOf(pagesBoard), await boardOf(scoreBoard)] }
}
const romansRead = rs => rs.map((x, i) => (x > 0 ? i + 1 : 0)).filter(Boolean).join(',')

const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const errors = []
async function phone(who, theme = 'paper') {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([p, s]) => {
    localStorage.setItem('berean_prefs', JSON.stringify(p))
    if (s) { localStorage.setItem('berean_token', s.token); localStorage.setItem('berean_user', JSON.stringify(s.user)) }
  }, [{ ...prefs, theme, themeLight: theme }, who])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  const marks = []
  page.on('request', r => { if (r.url().includes('/api/me/marks')) marks.push(`${r.method()} ${new URL(r.url()).pathname}`) })
  return { ctx, page, marks }
}
const row = (page, words) => page.getByRole('button', { name: words, exact: true })
const cell = (page, name) => page.getByRole('button', { name, exact: true })
async function openBook(page, words) {
  const r = row(page, words)
  await r.scrollIntoViewIfNeeded()
  await r.click()
  await page.waitForTimeout(700)
}
const closeSheet = async page => { await page.keyboard.press('Escape'); await page.waitForTimeout(700) }
const until = async (ok, ms = 10000) => { const end = Date.now() + ms; while (!(await ok()) && Date.now() < end) await new Promise(r => setTimeout(r, 250)); return ok() }
const tile = async (page, label) => (await page.getByText(label, { exact: true }).first().locator('xpath=..').innerText()).replace(label, '').trim()

const before = await facts()
{
  const { ctx, page } = await phone(ruth)
  await page.goto(base + '/stats', { waitUntil: 'networkidle' })
  await page.getByText('Progress by book', { exact: true }).waitFor({ timeout: 20000 })
  check('Progress by book says the books can be ticked', await page.getByText('Tap a book to mark the chapters you have read.', { exact: true }).count() === 1)
  check('nothing of the Bible read yet', await page.getByText('0% of the Bible', { exact: true }).count() === 1)
  await openBook(page, 'Romans, 0 of 16 chapters read')
  check('Romans opens as a sheet of its 16 chapters', await cell(page, 'Romans 1').isVisible() && await cell(page, 'Romans 16').count() === 1)
  check('the sheet says what a mark counts for', await page.getByText('A chapter you mark counts as read; streaks and reading time still come from time spent reading.', { exact: true }).isVisible())
  for (const c of [5, 6, 7, 8]) { await cell(page, `Romans ${c}`).click(); await page.waitForTimeout(150) }
  check('5 to 8 carry the check at once', (await Promise.all([5, 6, 7, 8].map(c => cell(page, `Romans ${c}, marked as read`).count()))).every(n => n === 1))
  await page.screenshot({ path: `${out}/sheet-ticked.png` })
  check('the server has the four marks', await until(async () => (await api('/me/marks', {}, ruth.token)).body?.marks?.length === 4))
  await closeSheet(page)
  check('the bar: Romans 4 of 16', await row(page, 'Romans, 4 of 16 chapters read').count() === 1 && await page.getByText('4/16', { exact: true }).count() === 1)
  check('the Bible percent moved', await page.getByText('0.3% of the Bible', { exact: true }).count() === 1)
  check('the Chapters tile counts the four', await until(async () => (await tile(page, 'Chapters')) === String(before.chapters + 4)), await tile(page, 'Chapters'))
  await page.screenshot({ path: `${out}/stats-after.png` })

  const after = await facts()
  check('the account has Romans 5 to 8 read once each', romansRead(after.romans) === '5,6,7,8' && after.romans.every(x => x <= 1), JSON.stringify(after.romans))
  check('chapters read +4', after.chapters === before.chapters + 4, `${before.chapters} → ${after.chapters}`)
  check('the streak holds still', after.streak === before.streak && after.longest === before.longest, `${before.streak}/${before.longest} → ${after.streak}/${after.longest}`)
  check('reading time holds still', after.time === before.time, `${before.time} → ${after.time}`)
  check('the calendar’s minutes hold still', after.minutes === before.minutes, `${before.minutes} → ${after.minutes}`)
  check('the group’s chapters, pages and score boards move by 4, 4 and 40', after.boards[0] === before.boards[0] + 4 && after.boards[1] === before.boards[1] + 4 && after.boards[2] === before.boards[2] + 40, `${before.boards} → ${after.boards}`)

  await openBook(page, 'Romans, 4 of 16 chapters read')
  await cell(page, 'Romans 8, marked as read').click()
  check('a tap takes the mark on 8 back at once', await until(async () => await cell(page, 'Romans 8').count() === 1, 2000))
  check('the server has three marks', await until(async () => (await api('/me/marks', {}, ruth.token)).body?.marks?.length === 3))
  await closeSheet(page)
  check('the bar: Romans 3 of 16', await until(async () => await row(page, 'Romans, 3 of 16 chapters read').count() === 1))
  const undone = await facts()
  check('the undo takes the credit back, and the boards with it', romansRead(undone.romans) === '5,6,7' && undone.chapters === before.chapters + 3 && undone.boards[0] === before.boards[0] + 3, `${JSON.stringify(undone.romans)} ${undone.boards}`)
  check('the time still holds still', undone.time === before.time && undone.streak === before.streak)
  await ctx.close()
}

{
  const { ctx, page } = await phone(ruth)
  await page.goto(`${base}/read/45/5`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2500)
  check('a ticked chapter’s end line says "Marked as read · Undo"', await page.getByText('Marked as read', { exact: true }).count() >= 1 && await page.getByRole('button', { name: 'Undo', exact: true }).count() >= 1)
  await page.getByText('Marked as read', { exact: true }).first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${out}/end-line.png` })

  await page.getByRole('button', { name: 'More' }).first().click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: 'Read with…' }).click()
  await page.waitForTimeout(900)
  await page.getByText('Bethlehem', { exact: true }).last().click()
  await page.waitForTimeout(800)
  check('reading with Bethlehem', await page.getByRole('button', { name: 'Stop reading with Bethlehem' }).isVisible())
  await page.getByRole('tab', { name: /Stats/ }).or(page.getByRole('link', { name: /Stats/ })).first().click()
  await page.getByText('Progress by book', { exact: true }).waitFor({ timeout: 20000 })
  await page.waitForTimeout(600)
  check('reading with the group, the books are not offered for ticking', await page.getByText('Tap a book to mark the chapters you have read.', { exact: true }).count() === 0 && await row(page, 'Romans, 3 of 16 chapters read').count() === 0 && await page.getByLabel('Romans, 3 of 16 chapters read', { exact: true }).count() === 1)
  await ctx.close()
}

{
  const { ctx, page, marks } = await phone(null, 'slate')
  await page.goto(base + '/stats', { waitUntil: 'networkidle' })
  await page.getByText('Progress by book', { exact: true }).waitFor({ timeout: 20000 })
  check('signed out with nothing read, the books are there to tick', await row(page, 'Genesis, 0 of 50 chapters read').count() === 1)
  await openBook(page, 'Genesis, 0 of 50 chapters read')
  await cell(page, 'Genesis 1').click()
  await page.waitForTimeout(300)
  check('signed out, a tap ticks Genesis 1', await cell(page, 'Genesis 1, marked as read').count() === 1)
  await page.screenshot({ path: `${out}/sheet-signed-out-slate.png` })
  await closeSheet(page)
  check('the device’s own Stats count it', await row(page, 'Genesis, 1 of 50 chapters read').count() === 1 && (await tile(page, 'Chapters read here')) === '1')
  check('the server is never asked', marks.length === 0, marks.join(', '))
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByText('Progress by book', { exact: true }).waitFor({ timeout: 20000 })
  check('and the mark is still there after a reload', await row(page, 'Genesis, 1 of 50 chapters read').count() === 1)
  await page.screenshot({ path: `${out}/stats-signed-out.png` })
  await ctx.close()
}

check('no page errors', !errors.length, errors.join(' | '))
await browser.close()
console.log(failed ? `${failed} failed` : 'all ok')
process.exit(failed ? 1 : 0)
