import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AVATARS, AVATAR_IDS, avatarFor, avatarRoleColours, defaultAvatar, isAvatarId, type AvatarRole } from '../shared/avatars'

// theme.ts imports Platform for its font helpers; the colours need none of it
vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web } }))
const { THEMES, contrast, mix } = await import('../client/src/theme')

/** Landscapes may run to the rim (the renderer clips to the circle); everything else stays a medallion. */
const LANDSCAPES = new Set(['boat', 'crook', 'mountain', 'sunrise'])

type Cmd = { c: string; args: number[] }
const ARITY: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }

/** Tokenises SVG path data; throws on anything that is not a command letter, a well-formed number or a separator. */
function parse(d: string): Cmd[] {
  const re = /\s*,?\s*(?:([MLHVCSQTAZmlhvcsqtaz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))/y
  const out: Cmd[] = []
  let cur: Cmd | null = null
  while (re.lastIndex < d.length) {
    const start = re.lastIndex, m = re.exec(d)
    if (!m) throw new Error(`bad path data at ${start}: ${d.slice(start, start + 12)}`)
    if (m[1]) { cur = { c: m[1], args: [] }; out.push(cur) }
    else if (!cur) throw new Error('number before the first command')
    else cur.args.push(Number(m[2]))
  }
  if (out[0]?.c.toUpperCase() !== 'M') throw new Error('path must start with M')
  for (const k of out) {
    const n = ARITY[k.c.toUpperCase()]
    if (n === 0 ? k.args.length : !k.args.length || k.args.length % n) throw new Error(`${k.c} takes ${n} numbers, got ${k.args.length}`)
    if (k.c.toUpperCase() === 'A') for (let i = 0; i < k.args.length; i += 7) {
      if (![0, 1].includes(k.args[i + 3]) || ![0, 1].includes(k.args[i + 4])) throw new Error('arc flags must be 0 or 1')
    }
  }
  return out
}

/** Flattens path data into one polygon per subpath (curves and arcs sampled). */
function flatten(d: string): [number, number][][] {
  const polys: [number, number][][] = []
  let poly: [number, number][] = [], x = 0, y = 0, sx = 0, sy = 0, px = 0, py = 0, prev = ''
  const push = (a: number, b: number) => { poly.push([a, b]); x = a; y = b }
  const bez = (pts: number[][]) => {
    for (let i = 1; i <= 12; i++) {
      const t = i / 12
      let p = pts.map(q => [...q])
      while (p.length > 1) p = p.slice(1).map((q, j) => [p[j][0] + (q[0] - p[j][0]) * t, p[j][1] + (q[1] - p[j][1]) * t])
      push(p[0][0], p[0][1])
    }
  }
  for (const { c, args } of parse(d)) {
    const C = c.toUpperCase(), rel = c !== C, n = ARITY[C] || 1
    for (let i = 0; i < (C === 'Z' ? 1 : args.length); i += n) {
      const a = args.slice(i, i + n), ox = rel ? x : 0, oy = rel ? y : 0
      if (C === 'M' && i === 0) { if (poly.length) polys.push(poly); poly = []; push(a[0] + ox, a[1] + oy); sx = x; sy = y }
      else if (C === 'M' || C === 'L') push(a[0] + ox, a[1] + oy)
      else if (C === 'H') push(a[0] + ox, y)
      else if (C === 'V') push(x, a[0] + oy)
      else if (C === 'C') { bez([[x, y], [a[0] + ox, a[1] + oy], [a[2] + ox, a[3] + oy], [a[4] + ox, a[5] + oy]]); px = a[2] + ox; py = a[3] + oy }
      else if (C === 'S') { const r = /[CS]/i.test(prev) ? [2 * x - px, 2 * y - py] : [x, y]; bez([[x, y], r, [a[0] + ox, a[1] + oy], [a[2] + ox, a[3] + oy]]); px = a[0] + ox; py = a[1] + oy }
      else if (C === 'Q') { bez([[x, y], [a[0] + ox, a[1] + oy], [a[2] + ox, a[3] + oy]]); px = a[0] + ox; py = a[1] + oy }
      else if (C === 'T') { const r = /[QT]/i.test(prev) ? [2 * x - px, 2 * y - py] : [x, y]; bez([[x, y], r, [a[0] + ox, a[1] + oy]]); px = r[0]; py = r[1] }
      else if (C === 'A') arcTo(a[0], a[1], a[2], a[3], a[4], a[5] + ox, a[6] + oy)
      else if (C === 'Z') { x = sx; y = sy }
      prev = C
    }
  }
  if (poly.length) polys.push(poly)
  return polys

  // SVG 1.1 F.6.5: endpoint to centre parameterisation
  function arcTo(rx: number, ry: number, rot: number, large: number, sweep: number, x2: number, y2: number) {
    const phi = (rot * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi)
    const dx = (x - x2) / 2, dy = (y - y2) / 2, x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy
    rx = Math.abs(rx); ry = Math.abs(ry)
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den))
    const cxp = (k * rx * y1p) / ry, cyp = (-k * ry * x1p) / rx
    const cx = cos * cxp - sin * cyp + (x + x2) / 2, cy = sin * cxp + cos * cyp + (y + y2) / 2
    const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
    const t0 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if (!sweep && dt > 0) dt -= 2 * Math.PI
    if (sweep && dt < 0) dt += 2 * Math.PI
    for (let i = 1; i <= 16; i++) {
      const t = t0 + (dt * i) / 16
      push(cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos)
    }
    x = x2; y = y2
  }
}
const area = (p: [number, number][]) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1] }, 0) / 2

describe('preset avatars', () => {
  it('are 24, with unique kebab-case ids and unique names', () => {
    expect(AVATARS.length).toBe(24)
    expect(AVATAR_IDS).toEqual(AVATARS.map(a => a.id))
    expect(new Set(AVATAR_IDS).size).toBe(24)
    for (const id of AVATAR_IDS) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/)
    const names = AVATARS.map(a => a.name)
    expect(new Set(names).size).toBe(24)
    for (const n of names) expect(n).toMatch(/^[A-Z][a-z’ ]+$/)
  })

  it('list their ids one per line, so the server can read the same table with a regex', () => {
    const src = readFileSync(resolve(__dirname, '../shared/avatars.ts'), 'utf8')
    expect([...src.matchAll(/^\s*\{ id: '([a-z-]+)'/gm)].map(m => m[1])).toEqual([...AVATAR_IDS])
  })

  it('draw with well-formed path data only', () => {
    for (const a of AVATARS) for (const s of a.shapes) expect(() => parse(s.d), `${a.id}: ${s.d.slice(0, 40)}`).not.toThrow()
    expect(() => parse('M0 0L1')).toThrow()
    expect(() => parse('M0 0X1 1')).toThrow()
    expect(() => parse('M0 0L1..2 3')).toThrow()
    expect(() => parse('M0 0A1 1 0 2 0 3 3')).toThrow()
  })

  it('lay a ground disc first, then 1 to 3 more roles including the ink', () => {
    for (const a of AVATARS) {
      expect(a.shapes[0].role, a.id).toBe('ground')
      const roles = new Set(a.shapes.map(s => s.role))
      expect(roles.has('ink'), a.id).toBe(true)
      expect(roles.size, a.id).toBeGreaterThanOrEqual(2)
      expect(roles.size, a.id).toBeLessThanOrEqual(4)
    }
  })

  it('wind every subpath clockwise, so overlapping pieces of a shape add up under the nonzero rule', () => {
    for (const a of AVATARS) for (const s of a.shapes) for (const p of flatten(s.d)) expect(area(p), `${a.id} ${s.role}`).toBeGreaterThan(0)
  })

  it('keep the drawing inside the medallion, except the landscapes', () => {
    for (const a of AVATARS) {
      if (LANDSCAPES.has(a.id)) continue
      const far = Math.max(...a.shapes.slice(1).flatMap(s => flatten(s.d).flat().map(([x, y]) => Math.hypot(x - 32, y - 32))))
      expect.soft(far, a.id).toBeLessThanOrEqual(26)
    }
  })

  it('stay small: under 600 characters of path data each', () => {
    for (const a of AVATARS) expect.soft(a.shapes.slice(1).reduce((n, s) => n + s.d.length, 0), a.id).toBeLessThan(600)
  })
})

describe('default avatar', () => {
  it('is deterministic and always a valid id', () => {
    for (const id of [0, 1, 2, 17, 4096, 2 ** 31 - 1, 2 ** 32 + 5, 9_007_199_254_740_991, -3]) {
      expect(isAvatarId(defaultAvatar(id)), String(id)).toBe(true)
      expect(defaultAvatar(id)).toBe(defaultAvatar(id))
    }
  })

  it('spreads 10,000 consecutive users over all 24, none under 3% or over 6%', () => {
    for (const from of [1, 50_000]) {
      const count = new Map<string, number>()
      for (let id = from; id < from + 10_000; id++) count.set(defaultAvatar(id), (count.get(defaultAvatar(id)) ?? 0) + 1)
      expect(count.size).toBe(24)
      for (const [id, n] of count) { expect(n, id).toBeGreaterThanOrEqual(300); expect(n, id).toBeLessThanOrEqual(600) }
    }
  })

  it('gives neighbours different pictures', () => {
    let same = 0
    for (let id = 1; id < 1000; id++) if (defaultAvatar(id) === defaultAvatar(id + 1)) same++
    expect(same).toBeLessThan(100)
  })
})

describe('isAvatarId and avatarFor', () => {
  it('reject anything that is not a listed id', () => {
    for (const junk of ['', 'Lamp', 'lamp ', ' lamp', 'lamps', 'toString', '__proto__', 'constructor', 'hasOwnProperty', null, undefined, 3, {}, ['lamp']]) {
      expect(isAvatarId(junk), String(junk)).toBe(false)
    }
    for (const id of AVATAR_IDS) expect(isAvatarId(id)).toBe(true)
  })

  it('use the chosen picture, else the default for the user', () => {
    expect(avatarFor({ id: 7, avatar: 'dove' }).id).toBe('dove')
    for (const avatar of [null, undefined, '', 'unicorn', '__proto__']) expect(avatarFor({ id: 7, avatar }).id).toBe(defaultAvatar(7))
    expect(avatarFor({ id: 12 }).id).toBe(defaultAvatar(12))
  })
})

describe('role colours', () => {
  const pairs: [AvatarRole, AvatarRole, number][] = [
    ['ink', 'ground', 3], // the drawing on its disc (graphics contrast)
    ['accent', 'ground', 3], // small details on the disc
    ['light', 'ink', 3], // cut-outs in the drawing
    ['soft', 'ground', 1.5], // half tones stay distinct from the disc...
    ['ink', 'soft', 2], // ...and from the ink
  ]

  it('stay legible in all 25 themes', () => {
    expect(THEMES.length).toBe(25)
    for (const t of THEMES) {
      const c = avatarRoleColours(t)
      for (const [a, b, min] of pairs) expect(contrast(c[a], c[b]), `${t.id} ${a}/${b}`).toBeGreaterThanOrEqual(min)
    }
  })

  it('come from the theme roles only', () => {
    for (const t of THEMES) {
      const c = avatarRoleColours(t)
      expect(c.ground).toBe(t.accentSoft)
      expect(c.ink).toBe(t.accent)
      expect(c.light).toBe(t.bg)
      expect(c.soft).toBe(mix(t.accentSoft, t.accent, 0.42))
      expect(c.accent).toBe(mix(t.accent, t.text, 0.6))
    }
  })
})
