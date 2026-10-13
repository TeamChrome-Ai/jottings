// Writes client/public/third-party.txt: every package in the two lockfiles with its licence, for the Credits page's
// "full list" link. npm side from license-checker (production deps of client/), Cargo side from `cargo metadata`
// (every crate in rs/Cargo.lock; cargo-about is not installed on the build box). Run by hand after a dependency
// change: node scripts/third-party.mjs
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { BRAND } from './brand.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] })

const npm = Object.entries(JSON.parse(run('npx', ['-y', 'license-checker', '--production', '--json'], path.join(ROOT, 'client'))))
  .map(([id, v]) => `${id}  ${v.licenses ?? '?'}  ${v.repository ?? ''}`.trimEnd())
const meta = JSON.parse(run(path.join(process.env.HOME, '.cargo/bin/cargo'), ['metadata', '--format-version', '1', '--offline'], path.join(ROOT, 'rs')))
const inLock = new Set(meta.resolve.nodes.map(n => n.id))
const cargo = meta.packages.filter(p => inLock.has(p.id) && p.source)
  .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
  .map(p => `${p.name}@${p.version}  ${p.license ?? '?'}  ${p.repository ?? ''}`.trimEnd())

const h = t => `${t}\n${'-'.repeat(t.length)}`
const title = `Third-party software in ${BRAND.fullName}`
const out = `${title}
${'='.repeat(title.length)}

Generated ${new Date().toISOString().slice(0, 10)} by scripts/third-party.mjs from client/package-lock.json and rs/Cargo.lock.
Each line: package@version  licence  repository. The licence texts are in each package's own distribution; the
fonts, data sources and services are credited on the Credits page (/credits.html).

${h(`npm packages shipped in the app and web client (${npm.length})`)}
${npm.join('\n')}

${h(`Rust crates in the server and data build (${cargo.length})`)}
${cargo.join('\n')}
`
writeFileSync(path.join(ROOT, 'client/public/third-party.txt'), out)
console.log(`third-party.txt: ${npm.length} npm packages, ${cargo.length} crates`)
