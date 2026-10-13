// Friend-invite notices on the web, two readers on a throwaway server: Ben is reading when Anna invites him, and the
// next heartbeat brings a quiet toast ("Anna invited you") and the Friends counts on Home and in Settings; a reload
// does not announce it again; with "Notify me of friend invites" off the count still moves but no toast shows. Also
// the endpoint the phone's background check polls. BASE = the server. Screenshots to OUT.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const base = process.env.BASE ?? 'http://127.0.0.1:8797'
const out = process.env.OUT ?? '/tmp/wt-invitenote/shots'
mkdirSync(out, { recursive: true })
const api = async (path, init = {}, token) => {
  const headers = { 'content-type': 'application/json', ...(init.headers ?? {}) }
  if (token) headers.authorization = `Bearer ${token}`
  const r = await fetch(base + '/api' + path, { ...init, headers })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const check = (label, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${extra ? ` (${extra})` : ''}`); if (!ok) process.exitCode = 1 }
const prefs = { theme: 'paper', themeLight: 'paper', themeDark: 'slate', font: 'serif', fontSize: 19, lineHeight: 1.6, letterSpacing: 0, wordSpacing: 0, verseNumbers: true, paragraphs: true, showNotes: true, reduceMotion: false, motionSpeed: 1, align: 'center', width: 'medium', onboarded: true, toured: true }

const stamp = Date.now() % 100000
const mk = async (h, name) => {
  const r = await api('/auth/register', { method: 'POST', body: JSON.stringify({ handle: h, password: 'invite-pw-1', display_name: name }) })
  if (r.status !== 200) throw new Error(`register ${h}: ${JSON.stringify(r.body)}`)
  return { handle: h, id: r.body.user.id, token: r.body.token, user: r.body.user }
}
const anna = await mk(`anna${stamp}`, 'Anna')
const ben = await mk(`ben${stamp}`, 'Ben')
const cara = await mk(`cara${stamp}`, 'Cara')
const dan = await mk(`dan${stamp}`, 'Dan')

// the endpoint, as the background check uses it
{
  const first = await api('/friends/invites/incoming', {}, ben.token)
  check('poll: signed in, nothing yet', first.status === 200 && first.body.open === true && first.body.invites.length === 0 && typeof first.body.now === 'string')
  check('poll: signed out is refused', (await api('/friends/invites/incoming')).status === 401)
}

const browser = await chromium.launch()
const errors = []
const phone = async (who, p = prefs) => {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(([p, s]) => {
    // only the first load of the context seeds storage; a reload keeps what the app wrote (the invite mark)
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    localStorage.setItem('berean_prefs', JSON.stringify(p)); localStorage.setItem('berean_token', s.token); localStorage.setItem('berean_user', JSON.stringify(s.user))
  }, [p, who])
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${who.handle}: ${e.message}`))
  return { ctx, page }
}
const text = page => page.evaluate(() => document.body.innerText)
/** Keeps the reader's idle clock running so heartbeats carry on; resolves once a beat reply names `n` invites waiting. */
const beatWith = async (page, n, ms = 45000) => {
  let done = false
  const seen = page.waitForResponse(async r => r.url().includes('/api/activity/beat') && (await r.json().catch(() => ({}))).incoming_invites === n, { timeout: ms })
  void (async () => { while (!done) { await page.mouse.wheel(0, 60).catch(() => {}); await new Promise(r => setTimeout(r, 1500)) } })()
  try { return await seen } finally { done = true }
}

// 1. Ben is reading; Anna invites him; the next heartbeat brings the toast
{
  const { ctx, page } = await phone(ben)
  await page.goto(base + '/read/43/1', { waitUntil: 'networkidle' })
  await beatWith(page, 0)
  check('poll mark: the first check only takes note', (await page.evaluate(() => JSON.parse(localStorage.getItem('berean_invite_mark') ?? 'null')))?.since != null)
  const sent = await api('/friends/invite', { method: 'POST', body: JSON.stringify({ handle: ben.handle }) }, anna.token)
  check('Anna invites Ben', sent.body?.status === 'sent')
  await beatWith(page, 1)
  const toast = await page.getByText('Anna invited you').waitFor({ timeout: 10000 }).then(() => true, () => false)
  check('toast while reading: "Anna invited you"', toast)
  await page.screenshot({ path: `${out}/01-toast.png` })
  const mark = await page.evaluate(() => JSON.parse(localStorage.getItem('berean_invite_mark') ?? 'null'))
  check('the mark holds the invite', mark?.uid === ben.id && mark.ids.length === 1, JSON.stringify(mark))

  // Home's Friends card and Settings' Friends row count it
  await page.goto(base + '/', { waitUntil: 'networkidle' })
  const home = await page.getByText('1 invite waiting').first().waitFor({ timeout: 15000 }).then(() => true, () => false)
  check('Home: "1 invite waiting"', home)
  await page.screenshot({ path: `${out}/02-home.png` })
  await page.goto(base + '/settings', { waitUntil: 'networkidle' })
  const settings = await page.getByText('1 invite waiting').first().waitFor({ timeout: 15000 }).then(() => true, () => false)
  check('Settings: Friends row says "1 invite waiting"', settings)
  await page.screenshot({ path: `${out}/03-settings.png` })

  // a reload does not announce the same invite again
  await page.goto(base + '/read/43/1', { waitUntil: 'networkidle' })
  await beatWith(page, 1)
  await page.waitForTimeout(3000)
  check('no second toast for the same invite', !(await text(page)).includes('Anna invited you'))

  // the switch in Friends settings
  await page.goto(base + '/friends', { waitUntil: 'networkidle' })
  await page.getByText('Friends settings').first().click()
  const sw = await page.getByText('Notify me of friend invites').first().waitFor({ timeout: 15000 }).then(() => true, () => false)
  check('Friends settings: "Notify me of friend invites" is there', sw)
  await page.waitForTimeout(800)
  await page.screenshot({ path: `${out}/04-friends-settings.png` })
  await ctx.close()
}

// 2. With the switch off: the count moves, no toast
{
  const { ctx, page } = await phone(ben, { ...prefs, inviteNotify: false })
  await page.goto(base + '/read/43/1', { waitUntil: 'networkidle' })
  await beatWith(page, 1)
  await api('/friends/invite', { method: 'POST', body: JSON.stringify({ handle: ben.handle }) }, cara.token)
  await beatWith(page, 2)
  await page.waitForTimeout(3000)
  check('switch off: no toast', !(await text(page)).includes('Cara invited you'))
  await ctx.close()
}

// 3. Blocks and invites off, at the endpoint
{
  await api('/blocks', { method: 'POST', body: JSON.stringify({ user_id: cara.id }) }, ben.token)
  const r = await api('/friends/invites/incoming', {}, ben.token)
  check('poll: a blocked sender’s invite is gone', r.body.invites.map(i => i.from.handle).join() === anna.handle, JSON.stringify(r.body.invites.map(i => i.from.handle)))
  const since = r.body.now
  await new Promise(res => setTimeout(res, 20))
  await api('/friends/invite', { method: 'POST', body: JSON.stringify({ handle: ben.handle }) }, dan.token)
  const s = await api(`/friends/invites/incoming?since=${encodeURIComponent(since)}`, {}, ben.token)
  check('poll: since returns only the new one', s.body.invites.length === 1 && s.body.invites[0].from.display_name === 'Dan')
  await api('/friends/settings', { method: 'PUT', body: JSON.stringify({ invites: false }) }, ben.token)
  const off = await api('/friends/invites/incoming', {}, ben.token)
  check('poll: invites off, none', off.body.open === false && off.body.invites.length === 0)
}

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
