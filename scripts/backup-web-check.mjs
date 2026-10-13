// usage: node scripts/backup-web-check.mjs <old-app .setting file>
// Serves client/dist with the app-shell fallback, imports the old Darby Bible app backup signed out, saves a device
// backup, then restores it in a fresh browser profile and again. No API is reached: everything stays in the browser.
import { chromium } from 'playwright'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'jottings-backup-')), BAD = path.join(OUT, 'bad.json')
const root = path.resolve('client/dist'), setting = process.argv[2]
const types = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.ttf': 'font/ttf' }
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (u.startsWith('/api/')) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"error":"offline"}') }
  let f = path.join(root, u)
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, 'index.html')
  res.writeHead(200, { 'content-type': types[path.extname(f)] ?? 'application/octet-stream' })
  fs.createReadStream(f).pipe(res)
}).listen(0)
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch()
const errors = []
async function profile() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true })
  // the welcome is not what is being checked
  await ctx.addInitScript(() => { if (!localStorage.getItem('berean_prefs')) localStorage.setItem('berean_prefs', JSON.stringify({ onboarded: true, toured: true })) })
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push('pageerror: ' + e.message))
  page.on('dialog', d => { console.log('confirm:', JSON.stringify(d.message())); d.accept() })
  await page.goto(base + '/your-data', { waitUntil: 'networkidle' })
  return { ctx, page }
}
async function choose(page, file) {
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.getByText('Choose a backup file', { exact: true }).last().click()])
  await fc.setFiles(file)
  await page.waitForTimeout(2500)
  return (await page.locator('text=/^(Added|Nothing new)/').first().textContent().catch(() => null)) ?? (await page.locator('body').innerText()).slice(-400)
}
const a = await profile()
console.log('import old app:', await choose(a.page, setting))
const [dl] = await Promise.all([a.page.waitForEvent('download'), a.page.getByText('Save a backup file', { exact: true }).last().click()])
const saved = path.join(OUT, dl.suggestedFilename())
await dl.saveAs(saved)
console.log('saved:', dl.suggestedFilename(), fs.statSync(saved).size, 'bytes')
await a.page.screenshot({ path: path.join(OUT, 'a.png') })
const b = await profile()
console.log('restore on a new browser:', await choose(b.page, saved))
console.log('restore again:', await choose(b.page, saved))
fs.writeFileSync(BAD, '{"hello":1}')
console.log('not a backup:', await choose(b.page, BAD))
await b.page.goto(base + '/bookmarks', { waitUntil: 'networkidle' }); await b.page.waitForTimeout(1500)
console.log('bookmarks page:', (await b.page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200))
console.log('errors:', JSON.stringify(errors.slice(0, 5)))
await browser.close(); server.close()
