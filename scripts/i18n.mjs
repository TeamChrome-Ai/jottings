#!/usr/bin/env node
/**
 * The app's phrases and their translations (docs/LANGUAGES.md, shared/i18n.ts).
 *
 *   node scripts/i18n.mjs keys            every phrase the code asks for → client/src/i18n/keys.json (with where)
 *   node scripts/i18n.mjs status          per language: phrases translated, missing, no longer asked for
 *   node scripts/i18n.mjs missing <lang>  the missing phrases of one language, as a JSON object to fill in
 *   node scripts/i18n.mjs prune           drops from every catalogue the phrases the code no longer asks for
 *   node scripts/i18n.mjs lint [paths…]   English the screens show that is not yet a phrase (exit 1 if any)
 *
 * A phrase is the literal first argument of t / tr / N_, `tc(context, phrase)`, or `tn(n, one, other)`; a phrase built
 * at run time cannot be translated, so `lint` reports any call whose phrase is not a literal.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(path.join(ROOT, 'client/package.json'))('typescript')
const I18N = path.join(ROOT, 'client/src/i18n')
const LANGS = ['fr', 'fr-CA', 'de', 'it', 'nl', 'sv']
const CONTEXT = '\u0004', PLURAL = '\u0000'
const DIRS = ['client/app', 'client/src', 'shared']
const SKIP = /(\.test\.|\.d\.ts$|\/i18n\/|node_modules|mediaArtData|\/widgets\/.*\.json)/

function files(dirs) {
  const out = []
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name) && !SKIP.test(p)) out.push(p)
    }
  }
  for (const d of dirs) { const p = path.resolve(ROOT, d); if (fs.statSync(p).isDirectory()) walk(p); else out.push(p) }
  return out
}
const parse = f => ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
const lit = n => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null
const where = (sf, n) => `${path.relative(ROOT, sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`
const callee = n => ts.isIdentifier(n.expression) ? n.expression.text : null

/** Every phrase asked for, and calls whose phrase is not a literal. */
function scan(fileList) {
  const keys = new Map(), bad = []
  const add = (k, at) => { if (!keys.has(k)) keys.set(k, []); keys.get(k).push(at) }
  for (const f of fileList) {
    const sf = parse(f)
    const visit = n => {
      if (ts.isCallExpression(n)) {
        const name = callee(n), a = n.arguments
        if (name === 't' || name === 'tr' || name === 'N_') {
          // t(item.label) is fine: the phrase is marked where it is written, with N_
          const s = lit(a[0]); if (s !== null) add(s, where(sf, n)); else if (a.length && name === 'N_') bad.push(`${where(sf, n)} N_(…) needs a literal phrase`)
        } else if (name === 'tc') {
          const c = lit(a[0]), s = lit(a[1])
          if (c !== null && s !== null) add(c + CONTEXT + s, where(sf, n))
          // the brand's noun (shared/brand.ts) is asked for by value; its keys are added below
          else if (!(c === 'brand noun' && sf.fileName.endsWith('shared/brand.ts'))) bad.push(`${where(sf, n)} tc(…) needs literal context and phrase`)
        } else if (name === 'tn') {
          const o = lit(a[1]), m = lit(a[2]); if (o !== null && m !== null) add(o + PLURAL + m, where(sf, n)); else bad.push(`${where(sf, n)} tn(…) needs literal phrases`)
        }
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  // the brand's noun and verb in the forms shared/brand.ts NOUN asks for: "jotting", "jottings", "a jotting", "Jot"
  if (fileList.some(f => f.endsWith('shared/brand.ts'))) {
    const { noun } = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/brand.json'), 'utf8'))
    const a = `${/^[aeiou]/i.test(noun.one) ? 'an' : 'a'} ${noun.one}`
    for (const s of [noun.one, noun.many, a, noun.verb]) add('brand noun' + CONTEXT + s, 'shared/brand.ts')
  }
  return { keys, bad }
}

const readCat = l => { try { return JSON.parse(fs.readFileSync(path.join(I18N, `${l}.json`), 'utf8')) } catch { return {} } }
const writeCat = (l, c) => fs.writeFileSync(path.join(I18N, `${l}.json`), JSON.stringify(Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n')
const show = k => k.replace(CONTEXT, ' ‹ctx› ').replace(PLURAL, ' ‹plural› ')

// ---------- lint: English on screen that is not a phrase ----------
/** Props whose text a reader sees or hears. */
const SHOWN_PROPS = new Set(['title', 'label', 'placeholder', 'accessibilityLabel', 'accessibilityHint', 'detail', 'subtitle', 'message', 'hint', 'caption', 'empty', 'emptyText', 'description', 'headerTitle', 'tabBarLabel', 'confirm', 'cancel', 'action', 'actionLabel', 'body', 'heading', 'note', 'text', 'help', 'sub', 'lead', 'tip', 'prompt', 'name', 'okLabel', 'cancelLabel', 'button', 'buttonLabel', 'aria-label'])
/** Calls whose string arguments a reader sees. */
const SHOWN_CALLS = /^(toast(\.show|\.error|\.ok)?|show|Alert\.alert|alert|confirm|ask|notify|setError|setMsg|setMessage|setStatus|setNote|fail|Share\.share)$/
const hasWords = s => /[A-Za-z]{2,}/.test(s) && !/^(https?:|mailto:|#|\/|[a-z]+[A-Z]\w*$|[a-z0-9_.-]+$|[A-Z0-9_]+$)/.test(s.trim())
function lint(fileList) {
  const out = []
  for (const f of fileList) {
    const sf = parse(f)
    const flag = (n, why, text) => out.push(`${where(sf, n)}  ${why}: ${JSON.stringify(text.trim().slice(0, 70))}`)
    const inPhrase = n => { for (let p = n.parent; p; p = p.parent) if (ts.isCallExpression(p) && ['t', 'tc', 'tn', 'tr', 'N_'].includes(callee(p))) return true; return false }
    const textOf = n => lit(n) ?? (ts.isTemplateExpression(n) ? [n.head.text, ...n.templateSpans.map(s => s.literal.text)].join('…') : null)
    const visit = n => {
      if (ts.isJsxText(n) && hasWords(n.text)) flag(n, 'JSX text', n.text)
      else if (ts.isJsxAttribute(n) && SHOWN_PROPS.has(n.name.getText(sf)) && n.initializer) {
        const v = ts.isJsxExpression(n.initializer) ? n.initializer.expression : n.initializer
        const s = v && textOf(v); if (s && hasWords(s) && !inPhrase(v)) flag(n, `prop ${n.name.getText(sf)}`, s)
        if (v && ts.isConditionalExpression(v)) for (const b of [v.whenTrue, v.whenFalse]) { const x = textOf(b); if (x && hasWords(x)) flag(b, `prop ${n.name.getText(sf)}`, x) }
      } else if (ts.isJsxExpression(n) && n.expression && n.parent && (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
        const e = n.expression
        const s = textOf(e); if (s && hasWords(s) && !inPhrase(e)) flag(n, 'JSX string', s)
        if (ts.isConditionalExpression(e)) for (const b of [e.whenTrue, e.whenFalse]) { const x = textOf(b); if (x && hasWords(x)) flag(b, 'JSX string', x) }
      } else if (ts.isCallExpression(n) && SHOWN_CALLS.test(n.expression.getText(sf))) {
        for (const a of n.arguments) { const s = textOf(a); if (s && hasWords(s) && !inPhrase(a)) flag(a, `${n.expression.getText(sf)}()`, s) }
      } else if (ts.isPropertyAssignment(n) && SHOWN_PROPS.has(n.name.getText(sf).replace(/['"]/g, ''))) {
        const s = textOf(n.initializer); if (s && hasWords(s) && !inPhrase(n.initializer)) flag(n, `field ${n.name.getText(sf)}`, s)
      }
      ts.forEachChild(n, visit)
    }
    visit(sf)
  }
  return out
}

// ---------- commands ----------
const [cmd = 'status', ...rest] = process.argv.slice(2)
const all = files(DIRS)
if (cmd === 'keys') {
  const { keys, bad } = scan(all)
  fs.writeFileSync(path.join(I18N, 'keys.json'), JSON.stringify(Object.fromEntries([...keys].sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n')
  console.log(`${keys.size} phrases → client/src/i18n/keys.json`)
  if (bad.length) { console.log(bad.join('\n')); process.exitCode = 1 }
} else if (cmd === 'status') {
  const { keys } = scan(all)
  console.log(`${keys.size} phrases in the code`)
  for (const l of LANGS) {
    const c = readCat(l), have = [...keys.keys()].filter(k => k in c).length
    const stale = Object.keys(c).filter(k => !keys.has(k)).length
    console.log(`${l.padEnd(6)} ${have} translated, ${keys.size - have} missing, ${stale} no longer asked for`)
  }
} else if (cmd === 'missing') {
  // node scripts/i18n.mjs missing fr [count] [--where]: the next `count` untranslated phrases (all by default), as a
  // JSON object to fill in; --where adds a "@where" entry per phrase naming the first place it is used
  const l = rest[0]; if (!LANGS.includes(l)) throw new Error(`language: ${LANGS.join(', ')}`)
  const count = Number(rest.find(a => /^\d+$/.test(a)) ?? Infinity), whereToo = rest.includes('--where')
  const { keys } = scan(all), c = readCat(l)
  const miss = [...keys].filter(([k]) => !(k in c)).slice(0, count)
  const out = {}
  for (const [k, at] of miss) { if (whereToo) out[`@where ${k}`] = at[0]; out[k] = k.includes(PLURAL) ? { one: '', other: '' } : '' }
  console.log(JSON.stringify(out, null, 1))
} else if (cmd === 'check') {
  // every translation keeps its phrase's {placeholders} and <tags>, nothing more (exit 1 on any fault)
  const holes = s => [...s.matchAll(/\{(\w+)\}|<\/?(\w+)>/g)].map(m => m[0]).sort().join(' ')
  let bad = 0
  for (const l of rest.length ? rest : LANGS) {
    for (const [k, v] of Object.entries(readCat(l))) {
      const phrase = k.includes(CONTEXT) ? k.split(CONTEXT)[1] : k
      const [one, other] = phrase.split(PLURAL)
      const forms = typeof v === 'string' ? [[phrase, v]] : [[one, v.one ?? ''], [other ?? one, v.other ?? '']]
      for (const [en, own] of forms) {
        if (!own) continue
        // a count's own form may leave {n} out ("une fois"), never add one
        const want = holes(en).split(' ').filter(Boolean), have = holes(own).split(' ').filter(Boolean)
        // the brand's noun may be written out in the language rather than left to its placeholder
        const optional = h => (h === '{n}' && k.includes(PLURAL)) || /^\{(one|many|One|Many|a|A|verb|verbLower|brands|aBrand)\}$/.test(h)
        // {brand} for {brands} or {aBrand}: the name with the language's own possessive or article
        const swap = h => h === '{brand}' && (want.includes('{brands}') || want.includes('{aBrand}'))
        const extra = have.filter(h => !want.includes(h) && !swap(h)), lost = want.filter(h => !have.includes(h) && !optional(h))
        if (extra.length || lost.length) { bad++; console.log(`${l}: ${JSON.stringify(show(k))} → ${JSON.stringify(own)}: ${extra.length ? 'adds ' + extra.join(' ') : ''}${lost.length ? ' loses ' + lost.join(' ') : ''}`) }
      }
    }
  }
  console.log(`${bad} faults`)
  if (bad) process.exitCode = 1
} else if (cmd === 'merge') {
  // node scripts/i18n.mjs merge fr chunk.json: adds the chunk's translations (empty ones and "@where" notes skipped)
  const [l, file] = rest; if (!LANGS.includes(l) || !file) throw new Error('merge <lang> <chunk.json>')
  const chunk = JSON.parse(fs.readFileSync(file, 'utf8')), c = readCat(l)
  let n = 0
  for (const [k, v] of Object.entries(chunk)) {
    if (k.startsWith('@where ')) continue
    const ok = typeof v === 'string' ? v.trim() !== '' : v && typeof v === 'object' && v.other
    if (ok) { c[k] = v; n++ }
  }
  writeCat(l, c)
  console.log(`${l}: ${n} merged, ${Object.keys(c).length} in the catalogue`)
} else if (cmd === 'prune') {
  const { keys } = scan(all)
  for (const l of LANGS) { const c = readCat(l); const kept = Object.fromEntries(Object.entries(c).filter(([k]) => keys.has(k))); writeCat(l, kept); console.log(`${l}: ${Object.keys(c).length - Object.keys(kept).length} dropped`) }
} else if (cmd === 'lint') {
  // the admin screens are the owner's alone, and stay English
  const list = (rest.length ? files(rest) : all).filter(f => !f.includes('/client/app/admin/'))
  const found = lint(list), { bad } = scan(list)
  for (const line of [...found, ...bad]) console.log(line)
  console.log(`${found.length + bad.length} to look at in ${list.length} files`)
  if (found.length + bad.length) process.exitCode = 1
} else if (cmd === 'server-keys') {
  // the server's error messages a reader sees (rs/src/i18n.rs): every literal ApiError message → rs/i18n/keys.json
  const RS = path.join(ROOT, 'rs/src'), keys = new Map()
  const re = /ApiError::(?:bad|not_found|forbidden|internal|new\(\s*\d+\s*,)\s*\(?\s*"((?:[^"\\]|\\.)*)"/g
  for (const f of fs.readdirSync(RS).filter(f => f.endsWith('.rs'))) {
    const src = fs.readFileSync(path.join(RS, f), 'utf8')
    for (const m of src.matchAll(re)) {
      const k = JSON.parse(`"${m[1]}"`), at = `rs/src/${f}:${src.slice(0, m.index).split('\n').length}`
      if (!keys.has(k)) keys.set(k, []); keys.get(k).push(at)
    }
  }
  fs.writeFileSync(path.join(ROOT, 'rs/i18n/keys.json'), JSON.stringify(Object.fromEntries([...keys].sort(([a], [b]) => a.localeCompare(b))), null, 1) + '\n')
  console.log(`${keys.size} server messages → rs/i18n/keys.json`)
} else if (cmd === 'show') {
  for (const k of Object.keys(readCat(rest[0] ?? 'fr'))) console.log(show(k))
} else throw new Error(`unknown command ${cmd}`)
