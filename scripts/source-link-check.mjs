// Where the source is published (shared/brand.json, `source`): the row under Settings → About and the entry on the
// Credits page, at 412 px. With a brand that names no place, neither is there. The script starts its own server and
// answers the published address itself, so nothing leaves the machine:
//
//   BIN=rs/target/release/berean [OUT=…] [WORK=…] node scripts/source-link-check.mjs
//
// BIN must have been built after `npm run build`, which embeds the web app. Every check prints ok or FAIL; the stills
// (source-about, source-credits) and the server's log go in OUT.
import net from 'node:net'
import { spawn } from 'node:child_process'
import { mkdirSync, openSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { BRAND } from './brand.mjs'

const BIN = resolve(process.env.BIN ?? 'rs/target/release/berean')
const OUT = resolve(process.env.OUT ?? '/tmp/source-link-check')
const WORK = resolve(process.env.WORK ?? `${OUT}/work`)
const SOURCE = BRAND.source
const sleep = ms => new Promise(r => setTimeout(r, ms))
let failed = 0
const ok = (label, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`); if (!cond) failed++ }

rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })
mkdirSync(OUT, { recursive: true })
const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)) }) })
const log = `${OUT}/server.log`
const server = spawn(BIN, [], { env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), NO_COLOR: '1', BEREAN_DB: `${WORK}/check.db` }, stdio: ['ignore', openSync(log, 'w'), openSync(log, 'a')] })
process.on('exit', () => server.kill())
const root = `http://127.0.0.1:${port}`
let up = false
for (let i = 0; i < 240 && !up && server.exitCode === null; i++) { try { up = (await fetch(`${root}/api/edition`)).ok } catch {} if (!up) await sleep(250) }
ok('the server is up', up)

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
// the published address is answered here: the check is of the link, not of the place it leads to
const asked = []
await ctx.route(u => u.origin !== root, route => { asked.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stand-in</title>' }) })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))

await page.goto(`${root}/settings/about`, { waitUntil: 'networkidle' })
await page.getByText('Credits and licences', { exact: true }).first().waitFor({ timeout: 30000 })
await page.waitForTimeout(500)
const row = page.getByRole('button', { name: 'Source code', exact: true })
if (SOURCE) {
  ok('About has a Source code row', (await row.count()) === 1)
  const labels = await page.getByRole('button').evaluateAll(els => els.map(e => e.getAttribute('aria-label')))
  ok('it sits between Credits and licences and Acknowledgments', labels.indexOf('Source code') === labels.indexOf('Credits and licences') + 1 && labels.indexOf('Acknowledgments') === labels.indexOf('Source code') + 1)
  ok('it says the code is free and open', (await row.innerText()).includes('Free and open: read it, or help improve it'))
  await page.screenshot({ path: `${OUT}/source-about.png` })
  const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 10000 }).catch(() => null), row.click()])
  await popup?.waitForLoadState('domcontentloaded').catch(() => {})
  ok(`a tap opens ${SOURCE} in a new tab`, popup?.url() === SOURCE)
  ok('and leaves the app where it was', new URL(page.url()).pathname === '/settings/about')
  await popup?.close()
} else {
  ok('About has no Source code row: the brand names no place', (await row.count()) === 0)
  await page.screenshot({ path: `${OUT}/source-about.png` })
}

await page.goto(`${root}/credits.html`, { waitUntil: 'networkidle' })
const link = page.getByRole('link', { name: 'Source code', exact: true })
if (SOURCE) {
  ok('the Credits page links the source by name', (await link.count()) === 1 && (await link.getAttribute('href')) === SOURCE)
  await link.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${OUT}/source-credits.png` })
} else {
  ok('the Credits page has no source link', (await link.count()) === 0)
}
ok(`nothing but the source was asked of another site (${asked.length ? asked.join(', ') : 'nothing'})`, asked.every(u => u.startsWith(SOURCE || '\u0000')))
ok(`no page error (${errors.join('; ') || 'none'})`, errors.length === 0)

await browser.close()
server.kill()
console.log(failed ? `${failed} FAILED` : 'all ok')
process.exit(failed ? 1 : 0)
