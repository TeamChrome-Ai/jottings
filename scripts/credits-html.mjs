// Renders client/src/lib/credits.ts to client/public/credits.html so the web has the same page the app shows, and the
// 1890 edition's to credits-1890.html (the server serves it at /credits.html while that edition is on; docs/EDITION.md).
// Runs as part of `npm run build` (node strips the types itself; scripts/brand.mjs resolves the brand import).
// OUT=<directory> writes the two pages there instead of client/public (the placeholder copies under brand.example/).
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { BRAND, possessive } from './brand.mjs'
const { OFL_TEXT, OPENDYSLEXIC_OFL_NOTICE, POLICY_LINKS, creditsFor } = await import('../client/src/lib/credits.ts')
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ownText = JSON.parse(readFileSync(new URL('../client/public/bible1890/meta.json', import.meta.url), 'utf8')).text === true
const LEAD = {
  1961: `${BRAND.name} is built on the work of others. Everything that is not ours is listed here with its licence. The Bible text of Darby’s translation (1884, 1890) is public domain; the 1961 edition’s footnotes, notices and table, and the ministry, keep the terms of their editions; ${possessive(BRAND.name)} own code is free software under the MIT License.`,
  1890: `${BRAND.name} is built on the work of others. Everything that is not ours is listed here with its licence. The Bible text of Darby’s translation (1884, 1890) and his notes are public domain; the ministry keeps the terms of its editions; ${possessive(BRAND.name)} own code is free software under the MIT License.`,
}
const OUT = process.env.OUT ? pathToFileURL(`${process.env.OUT.replace(/\/*$/, '')}/`) : new URL('../client/public/', import.meta.url)
// BEREAN_NEUTERED=1 (docs/EDITION.md, "Production build"): credits.html is the 1890 page too
const neutered = process.env.BEREAN_NEUTERED === '1'
for (const [edition, file] of [[neutered ? '1890' : '1961', 'credits.html'], ['1890', 'credits-1890.html']]) {
  const sections = creditsFor(edition, ownText).map(s => `<h2>${esc(s.title)}</h2>` + s.items.map(i => `<section><h3>${i.url ? `<a href="${i.url}">${esc(i.name)}</a>` : esc(i.name)}</h3><p>${esc(i.what)}</p><p class="m">Licence: ${i.licenceUrl ? `<a href="${i.licenceUrl}">${esc(i.licence)}</a>` : esc(i.licence)}</p>${i.note ? `<p class="m">${esc(i.note)}</p>` : ''}</section>`).join('')).join('')
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Credits and licences — ${esc(BRAND.name)}</title>
<style>body{font:17px/1.6 Georgia,serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#221b16;background:#faf7f2;overflow-wrap:anywhere}h1,h2,h3{font-family:system-ui,sans-serif}h3{margin:1.2rem 0 .2rem;font-size:1.05rem}p{margin:.2rem 0}.m{color:#6b5f55;font-size:.95rem}a{color:#7c2d12}pre{white-space:pre-wrap;font-size:.8rem;background:#f1ece4;padding:1rem;border-radius:12px}@media(prefers-color-scheme:dark){body{background:#1c1917;color:#ebe6e1}.m{color:#a79f97}a{color:#f6b17f}pre{background:#292524}}</style></head><body>
<h1>Credits and licences</h1>
<p>${esc(LEAD[edition])}</p>
${sections}
<h2>SIL Open Font License 1.1</h2><p class="m">Applies to Literata and OpenDyslexic as shipped in the app. OpenDyslexic’s notice: ${esc(OPENDYSLEXIC_OFL_NOTICE)}</p><pre>${esc(OFL_TEXT)}</pre>
<p>${POLICY_LINKS.map(l => `<a href="${l.path}">${esc(l.label)}</a>`).join(' · ')} · <a href="/account-deletion">Delete your account or data</a></p>
</body></html>`
  writeFileSync(new URL(file, OUT), html)
}
console.log('credits.html and credits-1890.html written')
