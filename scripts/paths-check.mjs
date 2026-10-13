// Paths on the web build (docs/PATHS.md), at 412 px (touch) and 1280 px, signed out: Home shows the Paths row; /paths
// lists the eight paths; Start The Gospels → Home's card reads "Matthew 1 · 1 of 89" over a strip of 66 books; a stored
// read of Matthew 1 (localStorage `berean_path_reads`, what the visit rule writes) moves it to "Matthew 2 · 2 of 89"; a
// target date gives an exact pace line with an honest standing; Stop brings Continue reading back. Then, signed in, a
// group walking The Gospels: the strip with member dots and the members listed. Screenshots at 412 px.
//   BASE=http://127.0.0.1:8791 OUT=/tmp/wt-pathsui node scripts/paths-check.mjs
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8791'
const out = process.env.OUT ?? '/tmp/wt-pathsui'
mkdirSync(out, { recursive: true })
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, align: 'center', width: 'medium', onboarded: true, toured: true }
const browser = await chromium.launch()
const errors = []
let failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++ }
const visible = (loc, ms = 8000) => loc.first().waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false)
const gone = (loc, ms = 8000) => loc.first().waitFor({ state: 'hidden', timeout: ms }).then(() => true, () => false)

async function open(width, session = null) {
  const touch = width < 720
  const ctx = await browser.newContext({ viewport: { width, height: touch ? 915 : 1000 }, deviceScaleFactor: 2, isMobile: touch, hasTouch: touch })
  await ctx.addInitScript(([p, s]) => {
    if (!sessionStorage.getItem('primed')) { localStorage.setItem('berean_prefs', JSON.stringify(p)); sessionStorage.setItem('primed', '1') }
    if (s) { localStorage.setItem('berean_token', s.token); localStorage.setItem('berean_user', JSON.stringify(s.user)) }
  }, [prefs, session])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${width}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|status of 404|when fetching the script/.test(m.text())) errors.push(`${width} console: ${m.text()}`) })
  page.on('dialog', d => d.accept())
  return { ctx, page }
}
const shot = async (page, name, wait = 900) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name) }

// the core's arithmetic, repeated here so the check is independent of the app's copy
const dayOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysBetween = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86_400_000)
const today = dayOf(new Date())
const eoy = (() => { const y = +today.slice(0, 4); const e = `${y}-12-31`; return e > today ? e : `${y + 1}-12-31` })()
const expectedPace = (done, total) => Math.ceil((total - done) / Math.max(1, daysBetween(today, eoy) + 1))
const expectedStanding = (done, total) => { const span = Math.max(1, daysBetween(today, eoy) + 1); const exp = Math.min(total, Math.round(total * 1 / span)); const d = done - exp; return d === 0 ? 'on track' : d > 0 ? `${d} ahead` : `${-d} behind` }

for (const width of [412, 1280]) {
  const { ctx, page } = await open(width)
  const W = `${width} px`
  // a place to continue from, so Home has a Continue tile to come back to after Stop
  await page.goto(`${base}/read/43/1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  ok(`${W}: Home shows Continue reading before any path`, await visible(page.getByText('Continue reading', { exact: true })))
  ok(`${W}: Home shows the Paths row`, await visible(page.getByText('Reading plans, no dates unless you set one')))

  await page.goto(`${base}/paths`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(600)
  const rows = await page.getByText(/ [\d,]+ chapters\.$/).count()
  ok(`${W}: /paths lists eight paths (${rows})`, rows === 8)
  ok(`${W}: /paths draws the whole Bible while no path is on`, (await page.locator('[data-testid="path-strip-segment"]').count()) === 66)
  await page.getByRole('button', { name: 'The Gospels', exact: true }).click()
  ok(`${W}: the Start sheet names the length`, await visible(page.getByText('89 chapters.')))
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  ok(`${W}: the sheet closes and the path card shows`, await visible(page.getByText('Next on your path')))
  if (width === 412) await shot(page, 'paths-active-412')

  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  ok(`${W}: Home's card reads Matthew 1`, await visible(page.getByText(/^Matthew 1 /)))
  ok(`${W}: … and 1 of 89`, await visible(page.getByText('1 of 89', { exact: true })))
  ok(`${W}: the compact strip has 66 books`, (await page.locator('[data-testid="path-strip-segment"]').count()) === 66)
  ok(`${W}: the reader's place is a dot`, (await page.locator('[data-testid="path-strip-place"]').count()) === 1)
  ok(`${W}: the Paths row now names the path`, await visible(page.getByText('The Gospels · 1 of 89')))
  // the fill grows from the left: the first Gospel's fill sits at the segment's left edge once anything is read
  await page.evaluate(() => localStorage.setItem('berean_path_reads', JSON.stringify([[40, 1, new Date().toISOString()]])))
  await page.reload({ waitUntil: 'networkidle' })
  ok(`${W}: a stored read of Matthew 1 moves the card to Matthew 2`, await visible(page.getByText(/^Matthew 2 /)))
  ok(`${W}: … and 2 of 89`, await visible(page.getByText('2 of 89', { exact: true })))
  await page.waitForTimeout(1200)
  const fill = await page.evaluate(() => {
    const segs = [...document.querySelectorAll('[data-testid="path-strip-segment"]')]
    const mt = segs[39], inner = mt.firstElementChild
    const a = mt.getBoundingClientRect(), b = inner.getBoundingClientRect()
    return { left: Math.abs(a.left - b.left), share: b.width / a.width }
  })
  ok(`${W}: Matthew's fill grows from its left edge (${fill.left.toFixed(2)} px off, ${(fill.share * 100).toFixed(1)}% of 1/28)`, fill.left < 0.75 && Math.abs(fill.share - 1 / 28) < 0.02)
  if (width === 412) await shot(page, 'home-path-card-412', 600)

  await page.goto(`${base}/paths`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Finish by', exact: true }).click()
  ok(`${W}: the Finish by sheet shows a month`, await visible(page.getByRole('tab', { name: 'By the end of the year' })))
  await page.getByRole('tab', { name: 'By the end of the year' }).click()
  const line = page.getByText(/^\d+ a day to finish by .+ · (on track|\d+ ahead|\d+ behind)$/)
  ok(`${W}: the pace line is exact`, await visible(line))
  const text = (await line.first().textContent()) ?? ''
  const pace = expectedPace(1, 89), stand = expectedStanding(1, 89)
  ok(`${W}: it says ${pace} a day and "${stand}" (${text})`, text.startsWith(`${pace} a day to finish by`) && text.endsWith(stand))
  ok(`${W}: the Pace control hides while a target is set`, !(await page.getByRole('radio', { name: '3 a week' }).count()))
  if (width === 412) await shot(page, 'paths-target-412')
  await page.getByRole('button', { name: 'Stop this path', exact: true }).click()
  ok(`${W}: Stop takes the card off /paths`, await gone(page.getByText('Next on your path')))
  await page.goto(`${base}/`, { waitUntil: 'networkidle' })
  ok(`${W}: Home is back to Continue reading`, await visible(page.getByText('Continue reading', { exact: true })) && !(await page.getByText('Next on your path').count()))
  await ctx.close()
}

// ---------------- a group walking a path ----------------
const json = { 'content-type': 'application/json' }
const api = async (path, init = {}, token) => {
  const headers = { ...json, ...(token ? { authorization: `Bearer ${token}` } : {}) }
  const r = await fetch(`${base}/api${path}`, { ...init, headers })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const stamp = Date.now().toString(36)
const register = async (h, name) => {
  const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ handle: h, password: 'paths-pw-1234', display_name: name }) })
  if (r.status !== 200) throw new Error(`register ${h}: ${JSON.stringify(r.body)}`)
  return { token: r.body.token, user: r.body.user }
}
const kyle = await register(`kyle_${stamp}`, 'Kyle Walker'), mara = await register(`mara_${stamp}`, 'Mara Reid')
const g = (await api('/groups', { method: 'POST', body: JSON.stringify({ name: `Gospels walk ${stamp}` }) }, kyle.token)).body
const detail = (await api(`/groups/${g.slug}`, {}, kyle.token)).body
await api('/groups/join', { method: 'POST', body: JSON.stringify({ invite_code: detail.invite_code }) }, mara.token)
const set = await api(`/groups/${g.slug}/path`, { method: 'PUT', body: JSON.stringify({ path_id: 'gospels', target_date: eoy }) }, kyle.token)
ok(`the server takes the group's path (${set.status})`, set.status === 200 && set.body?.path?.id === 'gospels')
{
  const { ctx, page } = await open(412, kyle)
  await page.goto(`${base}/groups/${g.slug}`, { waitUntil: 'networkidle' })
  ok('the group page shows the path', await visible(page.getByText('The Gospels', { exact: true })))
  ok('… with the strip', (await page.locator('[data-testid="path-strip-segment"]').count()) === 66)
  ok('… and both members at 0 of 89', (await page.getByText('0 of 89', { exact: true }).count()) === 2)
  ok('… the viewer at the 1st of 89', await visible(page.getByText('1 of 89', { exact: true })))
  ok('… naming Kyle and Mara', await visible(page.getByText(/^Kyle Walker/)) && await visible(page.getByText('Mara Reid')))
  ok('… and the target', await visible(page.getByText(/finish by 31 Dec/)))
  await page.waitForTimeout(600)
  const card = page.getByText('The Gospels', { exact: true }).locator('xpath=ancestor::div[contains(@style,"border-radius") or contains(@class,"r-")][1]')
  await shot(page, 'group-path-412', 400)
  await card.first().screenshot({ path: `${out}/group-path-card-412.png` }).catch(() => {})
  await page.goto(`${base}/groups`, { waitUntil: 'networkidle' })
  // the strip draws once its width is measured, a frame after the card lands
  await page.locator('[data-testid="path-strip-segment"]').first().waitFor({ timeout: 8000 }).catch(() => {})
  ok('the groups list shows the compact strip on the group', (await page.locator('[data-testid="path-strip-segment"]').count()) === 66)
  await ctx.close()
}

await browser.close()
console.log(JSON.stringify({ out, errors, failed }, null, 1))
if (failed || errors.length) process.exitCode = 1
