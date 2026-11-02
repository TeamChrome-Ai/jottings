// Reading with a group (report #33) and a book read again (Progress by book), end to end at phone width against a
// LOCAL plaintext server: two parents in a group "Luca", Stats' stacked bars and Bible percent, the group's Read
// together card, Continue into the reader with the pill on, "Read with…" from the reader's More sheet, and a chapter
// read through with it on going to the group's log and not to the reader. Real time: the server times beats by its clock.
//   BASE=http://127.0.0.1:8796 DB=/tmp/rw/berean.db OUT=/tmp/rw/shots node scripts/reading-with-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const base = process.env.BASE ?? 'http://127.0.0.1:8796'
const dbPath = process.env.DB ?? '/tmp/rw/berean.db'
const out = process.env.OUT ?? '/tmp/rw/shots'
mkdirSync(out, { recursive: true })
let failed = 0
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`) }
const api = async (path, init = {}, token) => {
  const r = await fetch(base + '/api' + path, { ...init, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const stamp = Date.now() % 100000
const mk = async (handle, display_name) => {
  const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ handle, display_name, password: 'reading-with-1' }) })
  if (r.status !== 200) throw new Error(`register ${handle}: ${JSON.stringify(r.body)}`)
  return { token: r.body.token, user: r.body.user }
}
const enzo = await mk(`enzo${stamp}`, 'Enzo'), maria = await mk(`maria${stamp}`, 'Maria')
const group = (await api('/groups', { method: 'POST', body: JSON.stringify({ name: 'Luca' }) }, enzo.token)).body
await api('/groups/join', { method: 'POST', body: JSON.stringify({ invite_code: group.invite_code }) }, maria.token)

const day = n => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10)
const db = new DatabaseSync(dbPath)
const read = db.prepare('INSERT INTO chapters_read (user_id, book, chapter, first_read_at, last_read_at, times) VALUES (?, ?, ?, ?, ?, ?)')
const own = [[43, 21, 1], [41, 16, 2], [1, 12, 1], [19, 150, 0]]
for (const [book, n, times] of own) for (let c = 1; c <= n; c++) if (times) read.run(enzo.user.id, book, c, `${day(30)}T07:00:00.000Z`, `${day(2)}T07:00:00.000Z`, times)
for (let c = 1; c <= 5; c++) db.prepare('UPDATE chapters_read SET times=2 WHERE user_id=? AND book=43 AND chapter=?').run(enzo.user.id, c)
read.run(enzo.user.id, 19, 23, `${day(30)}T07:00:00.000Z`, `${day(1)}T07:00:00.000Z`, 3)
const together = db.prepare('INSERT INTO group_reads (group_id, book, chapter, date, user_id, credited_at) VALUES (?, ?, ?, ?, ?, ?)')
for (const [c, ago, who] of [[1, 4, enzo], [2, 3, maria], [3, 2, enzo], [4, 1, maria]]) together.run(group.id, 41, c, day(ago), who.user.id, `${day(ago)}T19:30:00.000Z`)
together.run(group.id, 19, 23, day(5), enzo.user.id, `${day(5)}T19:00:00.000Z`)
db.close()

const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: true, align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch({ args: ['--no-sandbox'] })
const errors = []
async function phone(who, theme = 'paper') {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([p, s]) => { localStorage.setItem('berean_prefs', JSON.stringify(p)); localStorage.setItem('berean_token', s.token); localStorage.setItem('berean_user', JSON.stringify(s.user)) }, [{ ...prefs, theme, themeLight: theme }, who])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(e.message))
  const beats = []
  page.on('response', async r => { if (r.url().endsWith('/api/activity/beat')) try { beats.push({ sent: JSON.parse(r.request().postData() ?? '{}'), got: await r.json() }) } catch { /* closed */ } })
  return { ctx, page, beats }
}

for (const theme of ['paper', 'slate']) {
  const { ctx, page } = await phone(enzo, theme)
  await page.goto(base + '/stats', { waitUntil: 'networkidle' })
  const heading = page.getByText('Progress by book', { exact: true })
  await heading.waitFor({ timeout: 20000 })
  await heading.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  if (theme === 'paper') {
    check('the percent beside Progress by book counts chapters once (21 + 16 + 12 + 1 of 1,189)', await page.getByText('4.2% of the Bible', { exact: true }).isVisible())
    check('John: the second time, 5 of 21', await page.getByText('×2 5/21', { exact: true }).isVisible())
    check('Mark: read through twice', await page.getByText('×2 16/16', { exact: true }).isVisible())
    check('Genesis: the first time, 12 of 50', await page.getByText('12/50', { exact: true }).isVisible())
    check('Psalms: Psalm 23 three times is still the first time, 1 of 150', await page.getByText('1/150', { exact: true }).isVisible())
    check('John says it in words', await page.locator('[aria-label="John, read through once, and 5 of 21 chapters again"]').count() === 1)
  }
  await page.getByText('Rom', { exact: true }).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${out}/stats-${theme}-gospels.png` })
  await heading.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${out}/stats-${theme}-top.png` })
  await ctx.close()
}

{
  const { ctx, page } = await phone(enzo)
  await page.goto(base + '/paths', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  check('Paths shows the percent above the whole-Bible strip', await page.getByText('4.2% of the Bible', { exact: true }).count() >= 1)
  await page.screenshot({ path: `${out}/paths.png` })
  await ctx.close()
}

{
  const { ctx, page, beats } = await phone(maria)
  await page.goto(`${base}/groups/${group.slug}`, { waitUntil: 'networkidle' })
  await page.getByText('Read together', { exact: true }).waitFor({ timeout: 20000 })
  await page.getByText('Read together', { exact: true }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(900)
  check('the group counts 5 chapters read together, 0.4% of the Bible', await page.getByText('5 chapters read together', { exact: true }).isVisible() && await page.getByText('0.4% of the Bible', { exact: true }).isVisible())
  check('the last line names Mark 4 and Maria', await page.getByText(/^Last: Mark 4, .*, Maria$/).isVisible())
  await page.screenshot({ path: `${out}/group.png` })
  await page.getByRole('button', { name: 'Continue: Mark 5' }).click()
  await page.waitForURL(/\/read\/41\/5/)
  await page.waitForTimeout(2500)
  check('Continue opens Mark 5 with the pill on', await page.getByRole('button', { name: 'Stop reading with Luca' }).isVisible())
  await page.screenshot({ path: `${out}/reader-pill.png` })
  await page.waitForTimeout(16000)
  check('the reader’s beats name the group', beats.length > 0 && beats.every(b => b.sent.with_group === group.id), `${beats.length} beats, with_group ${[...new Set(beats.map(b => b.sent.with_group))]}`)
  await page.getByRole('button', { name: 'Stop reading with Luca' }).click()
  check('a tap on the pill turns it off', await page.getByRole('button', { name: 'Stop reading with Luca' }).count() === 0)
  await ctx.close()
}

{
  const { ctx, page, beats } = await phone(enzo)
  await page.goto(`${base}/read/19/117`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: 'More' }).first().click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: 'Read with…' }).click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/read-with-sheet.png` })
  await page.getByText('Luca', { exact: true }).last().click()
  await page.waitForTimeout(800)
  check('choosing Luca puts the pill up', await page.getByRole('button', { name: 'Stop reading with Luca' }).isVisible())
  const until = Date.now() + 90_000
  while (!beats.some(b => b.got.credited_with) && Date.now() < until) await page.waitForTimeout(500)
  const hit = beats.find(b => b.got.credited_with)
  check('Psalm 117 read through with Luca is credited to the group', hit?.got.credited_with?.book === 19 && hit?.got.credited_with?.chapter === 117 && hit.got.credited_with.group_id === group.id)
  check('and not to Enzo', beats.every(b => !b.got.credited))
  await page.waitForTimeout(400)
  check('the toast says so', await page.getByText('Read with Luca: Psalms 117', { exact: true }).count() === 1)
  check('no mark of the reader’s own is offered while reading with the group', await page.getByRole('button', { name: 'Mark as read' }).count() === 0)
  await page.screenshot({ path: `${out}/reader-credited.png` })
  await ctx.close()
}
const reads = (await api('/stats/reads', {}, enzo.token)).body
check('Enzo’s own reads have no Psalm 117', !(reads['19']?.[116] > 0))
const g = (await api(`/groups/${group.slug}`, {}, enzo.token)).body
check('the group’s log has Psalm 117 once', g.together?.reads['19']?.[116] === 1 && g.together.chapters === 6, JSON.stringify(g.together?.last))
check('no page errors', !errors.length, errors.join(' | '))
await browser.close()
console.log(failed ? `${failed} failed` : 'all ok')
process.exit(failed ? 1 : 0)
