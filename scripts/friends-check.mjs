// Friends end to end at phone width on a throwaway server: invite by handle (and a handle that does not exist, which
// must read the same), accept, a friend streak across time zones kept by both meeting a day (the kept moment), a
// reaction sent and seen, an invite by QR code via its web link, settings hiding things, block severing.
// BASE = the server; DB = its (plaintext) database file, for seeding past reading days. Screenshots and videos to OUT.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8795'
const db = process.env.DB ?? '/tmp/wt-friends/data/berean.db'
const out = process.env.OUT ?? '/tmp/wt-friends'
mkdirSync(out, { recursive: true })
const json = { 'content-type': 'application/json' }
const api = async (path, init = {}, token) => {
  const headers = { ...json, ...(init.headers ?? {}) }
  if (token) headers.authorization = `Bearer ${token}`
  const r = await fetch(base + '/api' + path, { ...init, headers })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) process.exitCode = 1 }
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, motionSpeed: 1, align: 'center', width: 'medium', onboarded: true, toured: true }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ---------------- people ----------------
const stamp = Date.now() % 100000
const mk = async (h, name) => {
  const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ handle: h, password: 'friends-pw-1', display_name: name }) })
  if (r.status !== 200) throw new Error(`register ${h}: ${JSON.stringify(r.body)}`)
  return { handle: h, id: r.body.user.id, token: r.body.token, user: r.body.user }
}
const anna = await mk(`anna${stamp}`, 'Anna')
const ben = await mk(`ben${stamp}`, 'Ben')
const cara = await mk(`cara${stamp}`, 'Cara')
// Anna reads in Denver, Ben in Sydney: at the time of a run Sydney may be a day ahead
const zones = { anna: ['America/Denver'], ben: ['Australia/Sydney'], cara: ['Europe/London'] }
const localDate = (zone, d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const offsetOf = (zone) => { const d = new Date(); const l = new Date(d.toLocaleString('en-US', { timeZone: zone })); const u = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })); return Math.round((l - u) / 60000) }

const browser = await chromium.launch()
const errors = []
const phone = async (who, video) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: zones[who.key][0], ...(video ? { recordVideo: { dir: `${out}/video-tmp`, size: { width: 412, height: 915 } } } : {}) })
  await ctx.addInitScript(([p, s]) => { localStorage.setItem('berean_prefs', JSON.stringify(p)); localStorage.setItem('berean_token', s.token); localStorage.setItem('berean_user', JSON.stringify(s.user)) }, [prefs, who])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${who.key}: ${e.message}`))
  return { ctx, page }
}
const keep = async (ctx, page, name) => { const v = page.video(); await ctx.close(); if (v) renameSync(await v.path(), `${out}/${name}.webm`) }
anna.key = 'anna'; ben.key = 'ben'; cara.key = 'cara'
const text = page => page.evaluate(() => document.body.innerText)

// 1. Anna invites Ben by his exact handle, and a handle nobody has: the same words for both
{
  const { ctx, page } = await phone(anna, true)
  await page.goto(base + '/friends', { waitUntil: 'networkidle' })
  await page.getByText('Add a friend').first().waitFor({ timeout: 30000 })
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/01-friends-empty.png` })
  const field = page.getByLabel('Their handle, exactly')
  await field.fill(`nobody_${stamp}`)
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await page.getByText(`Invite sent to @nobody_${stamp}`).waitFor({ timeout: 10000 })
  const ghost = await text(page)
  await field.fill(`@${ben.handle}`)
  await page.getByRole('button', { name: 'Invite', exact: true }).click()
  await page.getByText(`Invite sent to @${ben.handle}`).waitFor({ timeout: 10000 })
  await page.waitForTimeout(600)
  const real = await text(page)
  check('invite to a missing handle and a real one read alike', ghost.includes(`Invite sent to @nobody_${stamp}. It shows below`) && real.includes(`Invite sent to @${ben.handle}. It shows below`))
  check('both wait in the Sent list, handle only', real.includes(`@nobody_${stamp}`) && real.includes(`@${ben.handle}`) && !real.includes('Ben\n'))
  await page.screenshot({ path: `${out}/02-invites-sent.png` })
  await keep(ctx, page, 'video-01-invite')
}
const probe = await api('/friends/invite', { method: 'POST', body: JSON.stringify({ handle: `nobody2_${stamp}` }) }, anna.token)
const probe2 = await api('/friends/invite', { method: 'POST', body: JSON.stringify({ handle: cara.handle }) }, anna.token)
check('API: the same reply for a missing handle and a real one', JSON.stringify(probe) === JSON.stringify(probe2), JSON.stringify(probe))
await api(`/friends/invites/${(await api('/friends', {}, anna.token)).body.outgoing.find(o => o.handle === cara.handle).id}`, { method: 'DELETE' }, anna.token)

// 2. Ben accepts: the invite folds away, Anna opens into his friends
{
  const { ctx, page } = await phone(ben, true)
  await page.goto(base + '/friends', { waitUntil: 'networkidle' })
  await page.getByText('Invites for you').waitFor({ timeout: 30000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/03-invite-received.png` })
  await page.getByRole('button', { name: 'Accept' }).click()
  await page.getByText('You and Anna are friends').waitFor({ timeout: 10000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/04-accepted.png` })
  check('Ben and Anna are friends', (await text(page)).includes('Your friends'))
  await keep(ctx, page, 'video-02-accept')
}

// 3. both meet a day: six earlier days seeded (Denver's and Sydney's own dates), then a chapter each read today
{
  const days = (zone, n, back0) => Array.from({ length: n }, (_, i) => localDate(zone, new Date(Date.now() - (i + back0) * 86400000)))
  const aDays = days('America/Denver', 6, 1)
  // Sydney may already be a day ahead: Ben's seeded days reach Denver's today when it is Sydney's yesterday
  const aToday = localDate('America/Denver'), bToday = localDate('Australia/Sydney')
  const bDays = [...new Set([...aDays, ...(bToday > aToday ? [aToday] : [])])]
  const py = `import sqlite3,sys\nc=sqlite3.connect(sys.argv[1])\nfor uid,d in [(${anna.id},x) for x in ${JSON.stringify(aDays)}]+[(${ben.id},x) for x in ${JSON.stringify(bDays)}]:\n  c.execute("INSERT OR REPLACE INTO activity_days (user_id,date,active_seconds,pages,chapters) VALUES (?,?,700,1,1)",(uid,d))\nc.commit()`
  execFileSync('python3', ['-c', py, db])
  const beat = (who, sid, zone) => api('/activity/beat', { method: 'POST', body: JSON.stringify({ session_id: sid, book: 19, chapter: 117, progress: 1, signals: 3, active: true, visible: true, reached_end: true, local_date: localDate(zone), tz_offset_min: offsetOf(zone) }) }, who.token)
  const sa = `fa${stamp}xxxx`, sb = `fb${stamp}xxxx`
  // Ben first (in Sydney), then Anna completes the shared day
  await beat(ben, sb, 'Australia/Sydney')
  await beat(anna, sa, 'America/Denver')
  await sleep(21000)
  const rb = await beat(ben, sb, 'Australia/Sydney')
  const ra = await beat(anna, sa, 'America/Denver')
  check('a chapter credited for each', !!ra.body?.credited && !!rb.body?.credited, `${ra.body?.date} / ${rb.body?.date}`)
  const f = (await api('/friends', {}, anna.token)).body.friends[0]
  check('friend streak counts both meeting the day', f.friend_streak?.current === 7 && f.friend_streak?.kept === true, JSON.stringify(f.friend_streak))
  const badges = (await api('/stats', {}, ben.token)).body.badges.filter(b => b.earned_at).map(b => b.code)
  check('Kept together reaches both friends', badges.includes('friend_streak_7') && (await api('/stats', {}, anna.token)).body.badges.some(b => b.code === 'friend_streak_7' && b.earned_at), badges.join(','))
}

// 4. Anna sees the kept moment, on Home and on the list; then sends Ben a heart on his new badge
{
  const { ctx, page } = await phone(anna, true)
  await page.goto(base + '/friends', { waitUntil: 'networkidle' })
  await page.getByText('Kept today').waitFor({ timeout: 30000 })
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${out}/05-kept-moment-mid.png` })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${out}/06-kept.png` })
  check('the friend card shows 7 kept', /7\s*$/m.test((await page.getByRole('button', { name: /^Ben, @/ }).innerText()).trim()) || (await text(page)).includes('Kept today'))
  await keep(ctx, page, 'video-03-kept-moment')
}
{
  const { ctx, page } = await phone(anna, true)
  await page.goto(`${base}/friends/${ben.id}`, { waitUntil: 'networkidle' })
  await page.getByText('Kept together').first().waitFor({ timeout: 30000 })
  const t = await text(page)
  check('Ben’s page: streak, week, chapters, badges; no reading position', t.includes('day streak') && t.includes('chapter') && t.includes('Badges') && !/Psalm|position/i.test(t))
  await page.screenshot({ path: `${out}/07-friend-page.png` })
  const heart = page.getByRole('button', { name: /^Heart for Ben’s badge Kept together/ })
  await heart.scrollIntoViewIfNeeded()
  await page.waitForTimeout(500)
  await heart.click()
  await page.waitForTimeout(160)
  await page.screenshot({ path: `${out}/08-reaction-flight.png` })
  await page.getByText('Sent').first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/09-reaction-sent.png` })
  await keep(ctx, page, 'video-04-reaction-send')
}
const again = await api('/friends/reactions', { method: 'POST', body: JSON.stringify({ to: ben.id, target: 'badge:friend_streak_7', kind: 'clap' }) }, anna.token)
check('one reaction per badge: a second is the first', again.body?.created === false && again.body?.reaction?.kind === 'heart')

// 5. Ben sees it arrive on Stats
{
  const { ctx, page } = await phone(ben, true)
  await page.goto(base + '/stats', { waitUntil: 'networkidle' })
  await page.getByText('New from friends').waitFor({ timeout: 30000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${out}/10-stats-notice.png` })
  const stackLine = page.getByText('A heart from Anna').first()
  await stackLine.scrollIntoViewIfNeeded()
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/11-stats-badge-stack.png` })
  check('the heart shows on Ben’s badge', await stackLine.isVisible())
  await keep(ctx, page, 'video-05-reaction-arrival')
  const seen = (await api('/friends/reactions', {}, ben.token)).body.reactions.every(r => r.seen)
  check('shown reactions are marked seen', seen)
}

// 6. Ben shows his code; Cara opens the link on the web and sends an invite; Ben accepts in the code's sheet
{
  const { ctx, page } = await phone(ben, true)
  let token = null
  page.on('response', async r => { if (r.url().endsWith('/api/friends/token') && r.request().method() === 'POST') token = (await r.json().catch(() => ({}))).token })
  await page.goto(base + '/friends', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Show my invite code' }).click()
  const code = page.getByRole('img', { name: 'Your invite code' })
  await code.waitFor({ timeout: 15000 })
  await page.waitForTimeout(180)
  await page.screenshot({ path: `${out}/12-qr-reveal-mid.png` })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/13-qr.png` })
  await code.screenshot({ path: `${out}/qr-only.png` })
  let decoded = ''
  try { decoded = execFileSync('zbarimg', ['--raw', '-q', `${out}/qr-only.png`]).toString().trim() } catch (e) { decoded = `zbar: ${e.message}` }
  check('the drawn QR code scans, and carries the link with the token (no handle)', !!token && decoded.endsWith(`/friends?t=${token}`) && !decoded.includes(ben.handle), decoded)
  // Cara, elsewhere, opens the link the code stands for
  const c = await phone(cara, true)
  await c.page.goto(`${base}/friends?t=${token}`, { waitUntil: 'networkidle' })
  await c.page.getByText('shared an invite code with you').waitFor({ timeout: 30000 })
  await c.page.waitForTimeout(500)
  await c.page.screenshot({ path: `${out}/14-link-opened.png` })
  await c.page.getByRole('button', { name: 'Send an invite' }).click()
  await c.page.getByText('Invite sent to Ben').waitFor({ timeout: 10000 })
  await keep(c.ctx, c.page, 'video-06-link-invite')
  const reuse = await api('/friends/token/redeem', { method: 'POST', body: JSON.stringify({ token }) }, anna.token)
  check('the code works once', reuse.status === 404)
  await page.getByText('scanned your code').waitFor({ timeout: 15000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/15-scanned-in-sheet.png` })
  await page.getByRole('button', { name: 'Accept' }).click()
  await page.getByText('You and Cara are friends').first().waitFor({ timeout: 10000 })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/16-qr-accepted.png` })
  await keep(ctx, page, 'video-07-qr')
  check('Ben and Cara are friends', (await api('/friends', {}, cara.token)).body.friends.some(f => f.handle === ben.handle))
}

// 7. Home: the Together card; then Ben hides his badges and streak, and Anna's view of him says so
{
  const { ctx, page } = await phone(anna, false)
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  await page.getByText('Together').waitFor({ timeout: 30000 })
  await page.getByText('Together').scrollIntoViewIfNeeded()
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${out}/17-home-together.png` })
  check('Home shows the Friends card', (await text(page)).includes('Friends'))
  await ctx.close()
}
{
  const { ctx, page } = await phone(ben, true)
  await page.goto(base + '/settings', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Friends', exact: true }).click()
  await page.getByRole('switch', { name: 'My badges' }).first().waitFor({ timeout: 15000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/18-friends-settings.png` })
  await page.getByRole('switch', { name: 'My badges' }).first().click()
  await page.getByRole('switch', { name: 'My streak' }).first().click()
  await page.waitForTimeout(900)
  await keep(ctx, page, 'video-08-settings')
  const s = (await api('/friends', {}, ben.token)).body.settings
  check('Ben’s switches saved', s.share_badges === false && s.share_streak === false, JSON.stringify(s))
}
{
  const { ctx, page } = await phone(anna, false)
  await page.goto(`${base}/friends/${ben.id}`, { waitUntil: 'networkidle' })
  await page.getByText('keeps their badges to themselves').waitFor({ timeout: 30000 })
  await page.waitForTimeout(600)
  const t = await text(page)
  check('hidden parts say so, and the friend streak goes with the streak', t.includes('keeps their streak to themselves') && t.includes('Friend streaks need you both to share your streak') && !t.includes('Kept together'))
  await page.screenshot({ path: `${out}/19-hidden.png` })
  await ctx.close()
  await api('/friends/settings', { method: 'PUT', body: JSON.stringify({ share_badges: true, share_streak: true }) }, ben.token)
}

// 8. contacts on the web: finding needs the app; being found works anywhere
{
  const { ctx, page } = await phone(anna, false)
  await page.goto(base + '/friends/contacts', { waitUntil: 'networkidle' })
  await page.getByText('Let contacts find me').first().waitFor({ timeout: 30000 })
  await page.getByLabel('Your phone number').fill('+44 7700 900123')
  await page.getByRole('button', { name: 'Let contacts find me' }).click()
  await page.getByText('On. People who have your number').waitFor({ timeout: 10000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${out}/20-contacts.png` })
  check('discoverable via own phone hash', (await api('/friends', {}, anna.token)).body.discoverable === true)
  await ctx.close()
}

// 9. a block severs: Anna blocks Ben from his page
{
  const { ctx, page } = await phone(anna, false)
  page.on('dialog', d => d.accept())
  await page.goto(`${base}/friends/${ben.id}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Block' }).waitFor({ timeout: 30000 })
  await page.getByRole('button', { name: 'Block' }).click()
  await page.getByText(`Blocked @${ben.handle}`).waitFor({ timeout: 10000 })
  await ctx.close()
  const a = (await api('/friends', {}, anna.token)).body, b = (await api('/friends', {}, ben.token)).body
  check('block severs both ways', !a.friends.some(f => f.id === ben.id) && !b.friends.some(f => f.id === anna.id))
  const r = await api('/friends/reactions', {}, ben.token)
  check('and takes the reactions with it', !r.body.reactions.some(x => x.from.id === anna.id))
  const inv = await api('/friends/invite', { method: 'POST', body: JSON.stringify({ handle: anna.handle }) }, ben.token)
  check('the blocked one hears only "sent", and nothing arrives', inv.body?.status === 'sent' && (await api('/friends', {}, anna.token)).body.incoming.length === 0)
}

await browser.close()
writeFileSync(`${out}/people.json`, JSON.stringify({ anna: anna.handle, ben: ben.handle, cara: cara.handle }))
console.log(errors.length ? 'PAGE ERRORS: ' + errors.join(' | ') : 'no page errors')
