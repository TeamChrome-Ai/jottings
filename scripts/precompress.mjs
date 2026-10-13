// Precompress dist/ assets with brotli (quality 11) so the server can stream them without CPU work.
import { readdirSync, statSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, constants } from 'node:zlib'
const root = process.argv[2] ?? 'dist'
const exts = ['.js', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt', '.woff', '.otf', '.ttf']
let n = 0, before = 0, after = 0
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (exts.some(e => p.endsWith(e))) {
  if (existsSync(p + '.br')) continue
  const src = readFileSync(p); if (src.length < 1024) continue
  const out = brotliCompressSync(src, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: src.length } })
  if (out.length < src.length * 0.9) { writeFileSync(p + '.br', out); n++; before += src.length; after += out.length }
} } }
walk(root)
console.log(`brotli: ${n} files, ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`)
