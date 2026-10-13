// Publishing an outline, a group streak, a group event with its options and preset avatars at phone width on a
// throwaway server: publish → it shows in Public outlines for someone else → unpublish takes it off; two members both
// meeting a day → group streak 1 (the kept moment); an admin makes an event with a book list, a description and an
// admins-only board, each option explained under its control; choosing an avatar shows on the profile. BASE = the
// server. Screenshots and videos to OUT.
import { chromium } from 'playwright'
import { mkdirSync, renameSync } from 'node:fs'
import { NOUN } from './brand.mjs'
const base = process.env.BASE ?? 'http://127.0.0.1:8795'
const out = process.env.OUT ?? '/tmp/wt-friends'
mkdirSync(out, { recursive: true })
const api = async (path, init = {}, token) => {
  const headers = { 'content-type': 'application/json', ...(init.headers ?? {}) }
  if (token) headers.authorization = `Bearer ${token}`
  const r = await fetch(base + '/api' + path, { ...init, headers })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) process.exitCode = 1 }
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, motionSpeed: 1, align: 'center', width: 'medium', onboarded: true, toured: true }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const stamp = Date.now() % 100000
const mk = async (h, name) => {
  const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ handle: h, password: 'social-pw-1', display_name: name }) })
  if (r.status !== 200) throw new Error(`register ${h}: ${JSON.stringify(r.body)}`)
  return { handle: h, id: r.body.user.id, token: r.body.token, user: r.body.user }
}
const anna = await mk(`sanna${stamp}`, 'Anna')
const ben = await mk(`sben${stamp}`, 'Ben')
const browser = await chromium.launch()
const errors = []
const phone = async (who, video, zone = 'Europe/London') => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: zone, ...(video ? { recordVideo: { dir: `${out}/video-tmp`, size: { width: 412, height: 915 } } } : {}) })
  await ctx.addInitScript(([p, s]) => { localStorage.setItem('berean_prefs', JSON.stringify(p)); localStorage.setItem('berean_token', s.token); localStorage.setItem('berean_user', JSON.stringify(s.user)) }, [prefs, who])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${who.handle}: ${e.message}`))
  page.on('dialog', d => d.accept())
  return { ctx, page }
}
const keep = async (ctx, page, name) => { const v = page.video(); await ctx.close(); if (v) renameSync(await v.path(), `${out}/${name}.webm`) }
const text = page => page.evaluate(() => document.body.innerText)
const localDate = (zone, d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const offsetOf = (zone) => { const d = new Date(); const l = new Date(d.toLocaleString('en-US', { timeZone: zone })); const u = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })); return Math.round((l - u) / 60000) }

// 1. Anna publishes an outline; Ben finds it in Public outlines; Anna unpublishes it
const o = (await api('/outlines', { method: 'POST', body: JSON.stringify({ title: `The good shepherd ${stamp}`, description: 'Psalm 23 beside John 10' }) }, anna.token)).body
await api(`/outlines/${o.id}/items`, { method: 'PUT', body: JSON.stringify({ items: [{ kind: 'heading', text: 'He leads' }, { kind: 'verse', book: 19, chapter: 23, v1: 1, v2: 3 }, { kind: 'verse', book: 43, chapter: 10, v1: 11 }, { kind: 'note', text: 'The shepherd gives his life for the sheep.' }] }) }, anna.token)
{
  const { ctx, page } = await phone(anna, true)
  await page.goto(`${base}/outlines/${o.id}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Publish…' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Publish…' }).click()
  await page.getByText(`Publish this ${NOUN.one}?`).waitFor({ timeout: 10000 })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/30-publish-sheet.png` })
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await page.getByText('Published', { exact: true }).first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/31-published.png` })
  await keep(ctx, page, 'video-10-publish')
}
{
  const { ctx, page } = await phone(ben, false)
  await page.goto(`${base}/outlines/public`, { waitUntil: 'networkidle' })
  await page.getByText(`The good shepherd ${stamp}`).waitFor({ timeout: 30000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/32-public-list.png` })
  check('published outline shows for another reader, by its author', (await text(page)).includes(`by Anna @${anna.handle}`))
  await page.getByText(`The good shepherd ${stamp}`).click()
  await page.getByText('The shepherd gives his life').waitFor({ timeout: 30000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/33-public-outline-view.png` })
  await ctx.close()
}
{
  const { ctx, page } = await phone(anna, false)
  await page.goto(`${base}/outlines/${o.id}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Unpublish' }).click()
  await page.getByRole('button', { name: 'Publish…' }).waitFor({ timeout: 10000 })
  await ctx.close()
  const list = (await api('/outlines/public', {}, ben.token)).body
  check('unpublish takes it off the public list', !list.some(x => x.id === o.id))
  check('and it is no longer readable by id for others', (await api(`/outlines/${o.id}`, {}, ben.token)).status === 403)
}

// 2. a group of two: one reads (1 of 2), then the other (group streak 1, kept)
const g = (await api('/groups', { method: 'POST', body: JSON.stringify({ name: `Morning psalms ${stamp}` }) }, anna.token)).body
await api('/groups/join', { method: 'POST', body: JSON.stringify({ invite_code: g.invite_code }) }, ben.token)
const beat = (who, sid) => api('/activity/beat', { method: 'POST', body: JSON.stringify({ session_id: sid, book: 19, chapter: 117, progress: 1, signals: 3, active: true, visible: true, reached_end: true, local_date: localDate('Europe/London'), tz_offset_min: offsetOf('Europe/London') }) }, who.token)
await beat(anna, `ga${stamp}xxxx`); await sleep(21000)
check('Anna meets her day', !!(await beat(anna, `ga${stamp}xxxx`)).body?.credited)
{
  const { ctx, page } = await phone(anna, false)
  await page.goto(`${base}/groups/${g.slug}`, { waitUntil: 'networkidle' })
  await page.getByText('1 of 2 have read today').waitFor({ timeout: 30000 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${out}/34-group-one-of-two.png` })
  await ctx.close()
}
await beat(ben, `gb${stamp}xxxx`); await sleep(21000)
check('Ben meets his day', !!(await beat(ben, `gb${stamp}xxxx`)).body?.credited)
const gd = (await api(`/groups/${g.slug}`, {}, anna.token)).body
check('both meeting the day: group streak 1, kept', gd.streak?.current === 1 && gd.streak?.kept === true && gd.streak?.met_today === 2, JSON.stringify(gd.streak))
{
  const { ctx, page } = await phone(anna, true)
  await page.goto(`${base}/groups/${g.slug}`, { waitUntil: 'networkidle' })
  await page.getByText('Both have read today').waitFor({ timeout: 30000 })
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${out}/35-group-kept-mid.png` })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/36-group-streak.png` })
  await keep(ctx, page, 'video-11-group-streak')
}
{
  // the owner turns it off; it goes for everyone
  await api(`/groups/${g.slug}`, { method: 'PATCH', body: JSON.stringify({ streak_enabled: false }) }, anna.token)
  check('the owner turns the group streak off for everyone', (await api(`/groups/${g.slug}`, {}, ben.token)).body.streak === null)
  await api(`/groups/${g.slug}`, { method: 'PATCH', body: JSON.stringify({ streak_enabled: true }) }, anna.token)
}

// 2b. Anna makes an event with a book list, a description and an admins-only board; the hint under the metric says what
//     it counts; Ben's board is his own row only
{
  const { ctx, page } = await phone(anna, false)
  await page.goto(`${base}/groups/${g.slug}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'New event' }).click()
  await page.getByText('New event', { exact: true }).first().waitFor({ timeout: 10000 })
  await page.getByPlaceholder('A week of Psalms').fill(`Gospels and Psalms ${stamp}`)
  await page.getByPlaceholder('Read the Gospels together this month').fill('One chapter a day, no pressure')
  await page.getByRole('radio', { name: 'Chapters', exact: true }).click()   // a Segmented option; its label is two stacked layers, so not by text
  await page.waitForTimeout(500)
  const body = await text(page)
  check('the hint under the metric says what Chapters counts', body.includes('Chapters: Read to the end, with time on each to match its length; the same chapter counts once a day.'))
  check('the goal, books and dates each say what they do', body.includes('nothing is locked') && body.includes('minutes and streak ignore it') && body.includes('by each member’s own calendar day'))
  await page.getByRole('button', { name: 'Books: All books' }).click()
  for (const b of ['Matthew', 'Mark', 'Luke', 'John', 'Psalms']) await page.getByRole('button', { name: b, exact: true }).click()
  await page.getByRole('button', { name: 'Books: Psalms, Matthew–John' }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Books: Psalms, Matthew–John' }).click()
  await page.getByRole('radio', { name: 'Admins only', exact: true }).click()
  await page.waitForTimeout(400)
  check('the leaderboard hint follows the choice', (await text(page)).includes('each member sees their own row and place only'))
  await page.getByText('Metric', { exact: true }).scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/41-event-form.png` })
  await page.getByRole('button', { name: 'Create event' }).click()
  await page.getByText(`Gospels and Psalms ${stamp}`).first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/42-event-row.png` })
  const row = await text(page)
  check('the event row reads as one line', row.includes('Chapters · Psalms, Matthew–John ·') && row.includes('· admins only'))
  await ctx.close()
  const gd2 = (await api(`/groups/${g.slug}`, {}, anna.token)).body
  const ev = gd2.events.find(e => e.name === `Gospels and Psalms ${stamp}`)
  check('the event is stored with its book list, description and visibility', !!ev && JSON.stringify(ev.books) === '[19,40,41,42,43]' && ev.description === 'One chapter a day, no pressure' && ev.visibility === 'private_admin', JSON.stringify(ev && { books: ev.books, description: ev.description, visibility: ev.visibility }))
  const mine = (await api(`/groups/${g.slug}/events/${ev.id}/leaderboard`, {}, ben.token)).body
  check('a member of an admins-only event gets his own row only', mine.private === true && mine.rows.length === 1 && mine.rows[0].user_id === ben.id, JSON.stringify(mine.rows))
  const all = (await api(`/groups/${g.slug}/events/${ev.id}/leaderboard`, {}, anna.token)).body
  check('the admin gets the whole board', all.private === false && all.rows.length === 2)
}

// 3. Ben chooses an avatar; it shows on his profile, and in the group's member list
{
  const { ctx, page } = await phone(ben, true)
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Choose your picture' }).click()
  await page.getByText('Your picture').waitFor({ timeout: 10000 })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/37-avatar-sheet.png` })
  const pick = page.getByRole('radiogroup', { name: 'Pictures' }).getByRole('radio').nth(5)
  const name = await pick.getAttribute('aria-label')
  await pick.click()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/38-avatar-picked.png` })
  await keep(ctx, page, 'video-12-avatar')
  const me = (await api('/me', {}, ben.token)).body.user
  check('the chosen avatar is saved', !!me.avatar && me.avatar_chosen === true, `${name} → ${me.avatar}`)
  const prof = (await api(`/users/${ben.handle}`, {}, anna.token)).body.user
  check('and others see it on the profile', prof.avatar === me.avatar)
}
{
  const { ctx, page } = await phone(anna, false)
  await page.goto(`${base}/u/${ben.handle}`, { waitUntil: 'networkidle' })
  await page.getByText(`@${ben.handle}`).first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/39-profile-avatar.png` })
  await page.goto(`${base}/groups/${g.slug}`, { waitUntil: 'networkidle' })
  await page.getByText('Members', { exact: true }).first().waitFor({ timeout: 30000 })
  await page.getByText('Members', { exact: true }).first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/40-group-members-avatars.png`, fullPage: false })
  await ctx.close()
}
const bad = await api('/me', { method: 'PATCH', body: JSON.stringify({ avatar: 'not-an-avatar' }) }, ben.token)
check('an unknown avatar id is refused', bad.status === 400)
const exp = (await api('/me/export', {}, ben.token)).body
check('the export carries the avatar id only', typeof exp.user.avatar === 'string' && !JSON.stringify(exp.user).includes('<svg'))

await browser.close()
console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors')
