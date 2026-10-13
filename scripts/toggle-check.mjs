// Signed in: same-colour highlight clears; Bookmark becomes Remove bookmark and removes; no duplicate bookmarks.
// Signed out: highlight, bookmark and a new outline are kept on the device (no API calls for them), survive a reload,
// and move into the account once at sign-in (toast, server rows, local copies gone).
import { chromium } from 'playwright'
import { NOUN } from './brand.mjs'
const base = process.env.BASE ?? 'http://127.0.0.1:8787'
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true })
await ctx.addInitScript(() => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', reduceMotion: true })))
const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message))
await page.goto(base + '/', { waitUntil: 'networkidle' })
const handle = 'tog' + Date.now().toString(36)
const reg = await page.evaluate(async h => { const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: h, display_name: 'Toggle', password: 'Toggle-pass-123' }) }); return r.status }, handle)
console.log('register:', reg)
// the app keeps its own token: sign in through the screen so the store knows the user
await page.goto(base + '/login', { waitUntil: 'networkidle' })
await page.getByPlaceholder('Handle').fill(handle); await page.getByPlaceholder('Password').fill('Toggle-pass-123')
await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await page.waitForTimeout(1500)
console.log('signed in as:', handle, '| url:', page.url().replace(base, ''))
await page.goto(base + '/read/45/8?v=28', { waitUntil: 'networkidle' }); await page.waitForSelector('text=all things work together'); await page.waitForTimeout(3000)
// click on the rendered text itself (plain words share one text node inside the verse span, so element locators miss)
const clickVerse = async () => {
  // dispatch straight to the verse-number span: Playwright's visibility check misjudges the transformed pager
  const ok = await page.evaluate(() => { const el = [...document.querySelectorAll('span')].find(e => e.firstChild?.nodeType === 3 && (e.firstChild.textContent || '').trim() === '28' && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().width < 60 && getComputedStyle(e).visibility !== 'hidden'); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true })
  if (!ok) throw new Error('verse 28 number not on screen')
}
await clickVerse(); await page.waitForTimeout(400)
await page.getByRole('button', { name: 'Highlight blue' }).click(); await page.waitForTimeout(600)
const bg1 = await page.evaluate(() => { const el = [...document.querySelectorAll('span')].find(s => /all things work together/.test(s.textContent || '')); let e = el; while (e && getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)') e = e.parentElement; return e ? getComputedStyle(e).backgroundColor : null })
await clickVerse(); await page.waitForTimeout(400); await page.getByRole('button', { name: 'Highlight blue' }).click(); await page.waitForTimeout(600)
const bg2 = await page.evaluate(() => { const el = [...document.querySelectorAll('span')].find(s => /all things work together/.test(s.textContent || '')); let e = el; while (e && getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)') e = e.parentElement; return e && e.tagName !== 'BODY' ? getComputedStyle(e).backgroundColor : 'none' })
console.log('url after highlight:', page.url().replace(base, ''), '| after blue once:', bg1, '| after blue again:', bg2, bg2 === 'none' || bg2 !== bg1 ? '(cleared)' : '(NOT cleared)')
await clickVerse(); await page.waitForTimeout(400)
console.log('bookmark label first:', await page.getByRole('button', { name: /Bookmark|Remove bookmark/ }).first().textContent())
await page.getByRole('button', { name: 'Bookmark', exact: true }).click(); await page.waitForTimeout(800)
await clickVerse(); await page.waitForTimeout(400)
const label2 = await page.getByRole('button', { name: /Remove bookmark|Bookmark/ }).first().textContent(); console.log('bookmark label after:', label2)
await page.getByRole('button', { name: label2, exact: true }).click(); await page.waitForTimeout(800)
const count = await page.evaluate(async () => (await (await fetch('/api/bookmarks')).json()).length)
console.log('bookmarks left after remove:', count)
await page.evaluate(async () => { await fetch('/api/bookmarks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ book: 45, chapter: 8, verse: 28, label: null }) }); await fetch('/api/bookmarks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ book: 45, chapter: 8, verse: 28, label: null }) }) })
console.log('after two identical posts:', await page.evaluate(async () => (await (await fetch('/api/bookmarks')).json()).length), '(want 1)')
console.log(errs.length ? 'ERRORS ' + errs.join(' | ') : 'no page errors')

// ---------------- signed out ----------------
console.log('--- signed out')
const octx = await browser.newContext({ viewport: { width: 412, height: 860 }, isMobile: true, hasTouch: true })
await octx.addInitScript(() => localStorage.setItem('berean_prefs', JSON.stringify({ theme: 'paper', reduceMotion: true })))
const op = await octx.newPage(); const oerrs = []; op.on('pageerror', e => oerrs.push(e.message))
const personal = []; op.on('request', r => { if (/\/api\/(bookmarks|highlights|outlines)/.test(r.url())) personal.push(r.method() + ' ' + r.url().replace(base, '')) })
const oVerse = async () => {
  const ok = await op.evaluate(() => { const el = [...document.querySelectorAll('span')].find(e => e.firstChild?.nodeType === 3 && (e.firstChild.textContent || '').trim() === '28' && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().width < 60 && getComputedStyle(e).visibility !== 'hidden'); if (!el) return false; el.scrollIntoView({ block: 'center' }); el.click(); return true })
  if (!ok) throw new Error('verse 28 number not on screen')
}
const oTint = () => op.evaluate(() => { const el = [...document.querySelectorAll('span')].find(s => /all things work together/.test(s.textContent || '')); let e = el; while (e && getComputedStyle(e).backgroundColor === 'rgba(0, 0, 0, 0)') e = e.parentElement; return e && e.tagName !== 'BODY' ? getComputedStyle(e).backgroundColor : 'none' })
const openRom8 = async () => { await op.goto(base + '/read/45/8', { waitUntil: 'networkidle' }); await op.waitForSelector('text=all things work together'); await op.waitForTimeout(1500) }
await openRom8()
await oVerse(); await op.waitForTimeout(400); await op.getByRole('button', { name: 'Highlight blue' }).click(); await op.waitForTimeout(500)
const ob1 = await oTint()
await oVerse(); await op.waitForTimeout(400); await op.getByRole('button', { name: 'Highlight blue' }).click(); await op.waitForTimeout(500)
const ob2 = await oTint()
await oVerse(); await op.waitForTimeout(400); await op.getByRole('button', { name: 'Highlight green' }).click(); await op.waitForTimeout(500)
const og = await oTint()
console.log('blue:', ob1, '| blue again:', ob2, ob2 !== ob1 ? '(cleared)' : '(NOT cleared)', '| green:', og)
await oVerse(); await op.waitForTimeout(400)
await op.getByRole('button', { name: 'Bookmark', exact: true }).click(); await op.waitForTimeout(600)
console.log('bookmark toast:', await op.getByText('Bookmarked', { exact: true }).isVisible().catch(() => false))
await oVerse(); await op.waitForTimeout(400)
await op.getByRole('button', { name: NOUN.verb }).click(); await op.waitForTimeout(600)
await op.getByPlaceholder(`New ${NOUN.one} title`).fill('Local study'); await op.getByRole('button', { name: 'Create & add' }).click(); await op.waitForTimeout(800)
console.log('outline toast:', await op.getByText('Added to “Local study”').isVisible().catch(() => false), '| still on:', op.url().replace(base, ''))
// reload: everything comes back from the device
await openRom8()
const og2 = await oTint()
await oVerse(); await op.waitForTimeout(400)
const olabel = await op.getByRole('button', { name: /Remove bookmark|Bookmark/ }).first().textContent()
console.log('after reload | tint:', og2, og2 === og ? '(kept)' : '(LOST)', '| bookmark button:', olabel, olabel === 'Remove bookmark' ? '(kept)' : '(LOST)')
await op.goto(base + '/bookmarks', { waitUntil: 'networkidle' }); await op.waitForTimeout(800)
console.log('bookmarks screen lists Romans 8:28:', await op.getByText('Romans 8:28', { exact: true }).isVisible().catch(() => false), '| sign-in gate gone:', !(await op.getByText('Sign in to keep bookmarks.').isVisible().catch(() => false)))
await op.goto(base + '/outlines', { waitUntil: 'networkidle' }); await op.waitForTimeout(800)
console.log('outlines screen lists it:', await op.getByText('Local study', { exact: true }).isVisible().catch(() => false), '|', await op.getByText('1 verse').isVisible().catch(() => false) ? '1 verse' : 'verse count missing')
await op.getByText('Local study', { exact: true }).click(); await op.waitForTimeout(1200)
console.log('outline view:', op.url().replace(base, ''), '| shows Romans 8:28:', await op.getByText('Romans 8:28').first().isVisible().catch(() => false), '| Edit offered:', await op.getByRole('button', { name: 'Edit' }).isVisible().catch(() => false))
const local = await op.evaluate(() => Object.keys(localStorage).filter(k => /^berean_(local_|hl:local:)/.test(k)).map(k => k + '=' + localStorage.getItem(k).length))
console.log('device keys:', local.join(', '))
console.log('personal API calls while signed out:', personal.length ? personal.join(', ') : 'none')
// sign in: the device's library moves into the account once
const ohandle = 'loc' + Date.now().toString(36)
await op.evaluate(async h => fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: h, display_name: 'Local', password: 'Local-pass-123' }) }), ohandle)
await op.goto(base + '/login', { waitUntil: 'networkidle' })
await op.getByPlaceholder('Handle').fill(ohandle); await op.getByPlaceholder('Password').fill('Local-pass-123')
await op.getByRole('button', { name: 'Sign in', exact: true }).click()
const toast = await op.getByText(/^Moved to your account/).first().textContent({ timeout: 8000 }).catch(() => null)
console.log('merge toast:', toast)
await op.waitForTimeout(800)
const acct = await op.evaluate(async () => {
  const h = { Authorization: 'Bearer ' + localStorage.getItem('berean_token') }
  const j = async p => (await fetch('/api' + p, { headers: h })).json()
  const bms = await j('/bookmarks'); const hls = await j('/highlights?book=45&chapter=8'); const ols = await j('/outlines')
  const items = ols[0] ? (await j('/outlines/' + ols[0].id)).items : []
  return { bookmarks: bms.map(b => `${b.book}.${b.chapter}.${b.verse}`), highlights: hls.map(x => `${x.verse_id}:${x.color}`), outlines: ols.map(o => `${o.id}:${o.title}`), items: items.map(i => `${i.kind} ${i.book}.${i.chapter}.${i.v1}-${i.v2}`),
    left: Object.keys(localStorage).filter(k => /^berean_(local_|hl:local:)/.test(k)).map(k => k + '=' + localStorage.getItem(k)) }
})
console.log('account after merge:', JSON.stringify(acct))
// a second sign-in path through the same device must not upload again
await op.goto(base + '/read/45/8', { waitUntil: 'networkidle' }); await op.waitForTimeout(1500)
console.log('bookmarks after reopening signed in:', await op.evaluate(async () => (await (await fetch('/api/bookmarks', { headers: { Authorization: 'Bearer ' + localStorage.getItem('berean_token') } })).json()).length), '(want 1)')
console.log(oerrs.length ? 'ERRORS ' + oerrs.join(' | ') : 'no page errors'); await browser.close()
