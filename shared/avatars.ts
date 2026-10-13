/**
 * Preset profile pictures: 24 flat medallions drawn from the theme's own roles, as data. No photos, no faces.
 *
 * Coordinates are a 64 x 64 viewBox; the renderer clips every avatar to the circle of radius 32 at (32, 32), so a
 * landscape (water, a hillside) may run past the edge and is cut by the circle. Everything else keeps within a radius
 * of about 24 so it reads as a medallion. Shapes are filled paths (no strokes), painted in order with the nonzero
 * rule; a later shape in `light` or `ground` cuts a detail into an earlier one.
 *
 * Ids are storage keys shared with the server: never rename or reuse one, only add. The table below keeps one
 * `{ id: '<id>'` entry per line so the Rust side (and tests/avatars.test.ts) can read the list with
 * /^\s*\{ id: '([a-z-]+)'/gm.
 */

/** ground: the disc; ink: the drawing; soft: half-tone masses; light: page-coloured cut-outs; accent: deepest detail. */
export type AvatarRole = 'ground' | 'ink' | 'accent' | 'soft' | 'light'
export interface AvatarShape { d: string; role: AvatarRole; opacity?: number }
export interface AvatarDef { id: string; name: string; shapes: AvatarShape[] }

type P = [number, number]
const f = (v: number) => { const s = String(Math.round(v * 10) / 10); return s === '-0' ? '0' : s }
const pt = (x: number, y: number) => `${f(x)} ${f(y)}`
const rad = (deg: number) => (deg * Math.PI) / 180

// Every helper winds clockwise (on screen, y down), so overlapping pieces of one shape add up under the nonzero rule
// instead of cancelling; tests/avatars.test.ts checks the winding of every subpath.

const ellipse = (cx: number, cy: number, rx: number, ry: number) => `M${pt(cx - rx, cy)}a${f(rx)} ${f(ry)} 0 1 1 ${f(2 * rx)} 0a${f(rx)} ${f(ry)} 0 1 1 ${f(-2 * rx)} 0Z`
const circle = (cx: number, cy: number, r: number) => ellipse(cx, cy, r, r)
const rect = (x: number, y: number, w: number, h: number, r: number) =>
  `M${pt(x + r, y)}H${f(x + w - r)}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(r)}V${f(y + h - r)}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(r)}H${f(x + r)}a${f(r)} ${f(r)} 0 0 1 ${f(-r)} ${f(-r)}V${f(y + r)}a${f(r)} ${f(r)} 0 0 1 ${f(r)} ${f(-r)}Z`

/** A round-capped bar from one point to another: the flat-path stand-in for a stroked line. */
function bar(x1: number, y1: number, x2: number, y2: number, w: number): string {
  const h = w / 2, [nx, ny] = norm(x2 - x1, y2 - y1, -h)
  return `M${pt(x1 + nx, y1 + ny)}L${pt(x2 + nx, y2 + ny)}A${f(h)} ${f(h)} 0 0 1 ${pt(x2 - nx, y2 - ny)}L${pt(x1 - nx, y1 - ny)}A${f(h)} ${f(h)} 0 0 1 ${pt(x1 + nx, y1 + ny)}Z`
}

/** A round-capped bar along a quadratic curve (its offsets approximated through the control polygon). */
function qbar(x1: number, y1: number, cx: number, cy: number, x2: number, y2: number, w: number): string {
  const h = w / 2
  const side = (s: number): [P, P, P] => {
    const n1 = norm(cx - x1, cy - y1, s * h), n2 = norm(x2 - cx, y2 - cy, s * h)
    const a: P = [x1 + n1[0], y1 + n1[1]], b: P = [x2 + n2[0], y2 + n2[1]]
    return [a, meet(a, [cx + n1[0], cy + n1[1]], b, [cx + n2[0], cy + n2[1]]), b]
  }
  const [a, c, b] = side(-1), [a2, c2, b2] = side(1)
  return `M${pt(...a)}Q${pt(...c)} ${pt(...b)}A${f(h)} ${f(h)} 0 0 1 ${pt(...b2)}Q${pt(...c2)} ${pt(...a2)}A${f(h)} ${f(h)} 0 0 1 ${pt(...a)}Z`
}
/** The left-hand normal of (dx, dy) on screen, scaled to `len`. */
function norm(dx: number, dy: number, len: number): P { const l = Math.hypot(dx, dy); return [(-dy / l) * len, (dx / l) * len] }
/** Where line p1-p2 meets line p3-p4 (the midpoint of p2 and p3 if they are parallel). */
function meet(p1: P, p2: P, p3: P, p4: P): P {
  const d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0])
  if (Math.abs(d) < 1e-9) return [(p2[0] + p3[0]) / 2, (p2[1] + p3[1]) / 2]
  const a = p1[0] * p2[1] - p1[1] * p2[0], b = p3[0] * p4[1] - p3[1] * p4[0]
  return [(a * (p3[0] - p4[0]) - (p1[0] - p2[0]) * b) / d, (a * (p3[1] - p4[1]) - (p1[1] - p2[1]) * b) / d]
}

/** A round-capped band along a circle between two angles (degrees, clockwise from 3 o'clock). */
function arc(cx: number, cy: number, r: number, from: number, to: number, w: number): string {
  const a0 = Math.min(from, to), a1 = Math.max(from, to), h = w / 2, R = r + h, ri = r - h, large = a1 - a0 > 180 ? 1 : 0
  const at = (rr: number, a: number) => pt(cx + rr * Math.cos(rad(a)), cy + rr * Math.sin(rad(a)))
  return `M${at(R, a0)}A${f(R)} ${f(R)} 0 ${large} 1 ${at(R, a1)}A${f(h)} ${f(h)} 0 0 1 ${at(ri, a1)}A${f(ri)} ${f(ri)} 0 ${large} 0 ${at(ri, a0)}A${f(h)} ${f(h)} 0 0 1 ${at(R, a0)}Z`
}

/**
 * A leaf of two quadratic sides from p1 to p2. `wa` bows the side on the left of the direction of travel, `wb` the right
 * one; a negative value bends that side the other way (a crescent).
 */
function leaf(x1: number, y1: number, x2: number, y2: number, wa: number, wb = wa): string {
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, [nx, ny] = norm(x2 - x1, y2 - y1, 1)
  return `M${pt(x1, y1)}Q${pt(mx - nx * wa, my - ny * wa)} ${pt(x2, y2)}Q${pt(mx + nx * wb, my + ny * wb)} ${pt(x1, y1)}Z`
}

/** A polygon with each corner rounded by `r` (one radius, or one per corner; 0 is sharp), wound clockwise whatever the order given. */
function poly(points: P[], r: number | number[]): string {
  const radii = points.map((_, i) => (Array.isArray(r) ? r[i] : r))
  const area = points.reduce((s, p, i) => { const q = points[(i + 1) % points.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0)
  if (area < 0) { points = [...points].reverse(); radii.reverse() }
  const n = points.length
  let d = ''
  points.forEach((p, i) => {
    const toward = (q: P): P => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]), t = Math.min(radii[i] / l, 0.5); return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t] }
    d += radii[i] > 0 ? `${i ? 'L' : 'M'}${pt(...toward(points[(i + n - 1) % n]))}Q${pt(...p)} ${pt(...toward(points[(i + 1) % n]))}` : `${i ? 'L' : 'M'}${pt(...p)}`
  })
  return d + 'Z'
}

/** A flame: round base of radius r centred at (cx, cy), tapering to a tip h above it, leaning by `lean`. */
function flame(cx: number, cy: number, r: number, h: number, lean = 0): string {
  const tx = cx + lean, ty = cy - h
  return `M${pt(tx, ty)}C${pt(cx + r * 0.25 + lean * 0.5, ty + h * 0.4)} ${pt(cx + r, cy - r * 0.9)} ${pt(cx + r, cy)}A${f(r)} ${f(r)} 0 0 1 ${pt(cx - r, cy)}C${pt(cx - r, cy - r * 0.9)} ${pt(cx - r * 0.25 + lean * 0.5, ty + h * 0.4)} ${pt(tx, ty)}Z`
}

/** A star of n rounded points. */
function star(cx: number, cy: number, R: number, r: number, n: number, round: number): string {
  const pts: P[] = []
  for (let i = 0; i < n * 2; i++) {
    const a = rad(-90 + (i * 180) / n), rr = i % 2 ? r : R
    pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)])
  }
  return poly(pts, pts.map((_, i) => (i % 2 ? 0 : round)))
}

/** A four-pointed sparkle: concave sides through the centre. */
function sparkle(x: number, y: number, r: number): string {
  const q = (a: number, b: number) => `Q${pt(x, y)} ${pt(a, b)}`
  return `M${pt(x, y - r)}${q(x + r * 0.7, y)}${q(x, y + r)}${q(x - r * 0.7, y)}${q(x, y - r)}Z`
}

const G: AvatarShape = { d: circle(32, 32, 32), role: 'ground' }
const shape = (role: AvatarRole) => (...d: string[]): AvatarShape => ({ d: d.join('').replace(/ -/g, '-'), role })
const ink = shape('ink'), soft = shape('soft'), light = shape('light'), accent = shape('accent'), cut = shape('ground')

export const AVATARS: readonly AvatarDef[] = [
  { id: 'lamp', name: 'Lamp', shapes: [G,
    ink('M11 40C11 33 18 31 26 31C32 31 37 32 41 33L50 34.5C53 35 54 37 53 38.5C52 40 50 40.5 48 40.5L42 41C38 45.5 33 48 25 48C17 48 11 46 11 40Z', rect(19, 46, 12, 4.5, 1.5)),
    accent(flame(48, 29, 4.2, 14, -1.5)),
    light(ellipse(26, 34.5, 5.5, 1.8), flame(48, 29.5, 1.8, 5)),
  ] },
  { id: 'scroll', name: 'Scroll', shapes: [G,
    soft(rect(18, 20, 28, 24, 2)),
    ink(rect(12, 18, 8, 28, 4), rect(44, 18, 8, 28, 4), bar(16, 14, 16, 50, 3), bar(48, 14, 48, 50, 3)),
    ink(bar(24, 27, 40, 27, 2.6), bar(24, 32, 40, 32, 2.6), bar(24, 37, 34, 37, 2.6)),
  ] },
  { id: 'olive-branch', name: 'Olive branch', shapes: [G,
    soft(leaf(27, 39, 37.5, 45, 5.6), leaf(37, 28, 47.5, 32, 5.6)),
    ink(qbar(15, 49, 29, 37, 45, 17, 4)),
    ink(leaf(21, 44, 10.5, 35.5, 5.6), leaf(31, 33, 24, 21, 5.6), leaf(40, 24, 37, 11.5, 5), leaf(44, 19, 47.5, 12, 4)),
    accent(ellipse(32, 46.5, 4, 4.6), ellipse(43.5, 38.5, 4, 4.6)),
  ] },
  { id: 'dove', name: 'Dove', shapes: [G,
    soft('M33 34C36 25 42 19 51 16C50 25 47 31 42 36Z'),
    ink('M11 37L16.5 35.5C17.5 31 23 29.5 26 32.5C30 36 36 37 42 35L53 30.5L51 38C47 42 38 45.5 30 44.5C24 43.5 19 41.5 16.5 38.5Z'),
    ink('M25 35.5C25 26 31 16 41 11C42 20 42 28 38.5 36.5Z'),
    light(circle(20.5, 34, 1.4)),
  ] },
  { id: 'well', name: 'Well', shapes: [G,
    ink(poly([[11, 22], [32, 10], [53, 22]], 2.5), bar(18, 21, 18, 37, 3.6), bar(46, 21, 46, 37, 3.6), bar(32, 20, 32, 27, 1.8), poly([[27.5, 26], [36.5, 26], [35.5, 32], [28.5, 32]], 1.2)),
    ink(rect(14, 37, 36, 14, 3), ellipse(32, 37, 18, 4.5)),
    light(ellipse(32, 37, 14, 2.4), bar(17, 45, 47, 45, 2)),
  ] },
  { id: 'fig', name: 'Fig', shapes: [G,
    soft(leaf(35, 22, 50, 16, 4.5), leaf(35, 22, 44, 11, 3.5), leaf(35, 22, 50, 25, 3.5)),
    ink('M28 21.5C30 20.5 34 20.5 36 21.5C39 23 40 26.5 42 28.5C48 32.5 51 37 51 42C51 49 43 52 32 52C21 52 13 49 13 42C13 37 16 32.5 22 28.5C24 26.5 25 23 28 21.5Z', qbar(32, 22, 32, 17, 34.5, 13, 3.2)),
    light(arc(32, 42, 11, 195, 232, 2.6)),
  ] },
  { id: 'star', name: 'Star', shapes: [G,
    soft(sparkle(46, 17, 6.5), sparkle(17, 19, 5)),
    ink(star(32, 34, 19.5, 8.4, 5, 2.4)),
  ] },
  { id: 'boat', name: 'Boat', shapes: [G,
    soft('M0 50Q8 46 16 50T32 50T48 50T64 50V64H0Z'),
    ink(poly([[11, 40], [53, 40], [46, 49], [18, 49]], 2.5), bar(32, 12, 32, 41, 3)),
    ink(poly([[34.5, 13], [34.5, 37], [49, 37]], 2)),
    soft(poly([[29.5, 17], [29.5, 37], [16, 37]], 2)),
  ] },
  { id: 'harp', name: 'Harp', shapes: [G,
    ink(qbar(26, 46, 13, 32, 20, 15, 4.5), qbar(38, 46, 51, 32, 44, 15, 4.5), bar(19, 21, 45, 21, 3.5), rect(21, 42, 22, 9, 4.5)),
    ink(bar(27.5, 22, 27.5, 43, 1.6), bar(32, 22, 32, 43, 1.6), bar(36.5, 22, 36.5, 43, 1.6)),
  ] },
  { id: 'loaf', name: 'Loaf', shapes: [G,
    ink('M12 45C12 31 21 24 32 24C43 24 52 31 52 45Q52 49 48 49H16Q12 49 12 45Z'),
    light(leaf(19, 40, 25, 31, 1.6), leaf(29, 41, 35, 30, 1.6), leaf(39, 41, 45, 32, 1.6)),
  ] },
  { id: 'grapes', name: 'Grapes', shapes: [G,
    soft(leaf(33, 18, 48, 13, 5)),
    ink(bar(32, 23, 30, 12, 3)),
    ink(...[[20, 25], [28, 25], [36, 25], [44, 25], [24, 32], [32, 32], [40, 32], [28, 39], [36, 39], [32, 46]].map(([x, y]) => circle(x, y, 4.5))),
  ] },
  { id: 'candle', name: 'Candle', shapes: [G,
    soft(circle(32, 19, 10)),
    accent(flame(32, 21, 4, 12)),
    cut(flame(32, 22, 1.8, 5)),
    ink(rect(26, 27, 12, 20, 2), 'M15 47H49Q49 51 45 51H19Q15 51 15 47Z'),
  ] },
  { id: 'wheat', name: 'Wheat', shapes: [G,
    soft(leaf(32, 52, 19, 38, 4.4, -1.5), leaf(32, 49, 45, 35, -1.5, 4.4)),
    ink(bar(32, 34, 32, 54, 3.4)),
    ink(...[39, 31.5, 24].flatMap(y => [leaf(31, y, 24.5, y - 8, 5.6), leaf(33, y, 39.5, y - 8, 5.6)]), leaf(32, 21, 32, 8, 6)),
  ] },
  { id: 'fish', name: 'Fish', shapes: [G,
    soft(circle(15, 19, 2.5), circle(20, 13, 1.8)),
    ink('M12 33C18 23 32 21 42 29L52 21Q48 32 52 43L42 36C32 44 18 43 12 33Z', 'M24 25C27 19 33 18 37 19L35 27Z'),
    light(circle(19, 31, 2), arc(19, 33, 8, -35, 35, 2)),
  ] },
  { id: 'crook', name: 'Shepherd’s crook', shapes: [G,
    soft('M0 50Q32 38 64 50V64H0Z'),
    ink(bar(37, 53, 37, 24, 5.5), arc(28.5, 24, 8.5, 180, 360, 5.5), bar(20, 24, 20, 29, 5.5)),
  ] },
  { id: 'tent', name: 'Tent', shapes: [G,
    soft(ellipse(32, 47, 20, 3.5)),
    ink(poly([[12, 46], [32, 15], [52, 46]], 3), bar(32, 17, 32, 9, 2.6)),
    light(poly([[32, 28], [40, 46], [24, 46]], 1.5)),
  ] },
  { id: 'anchor', name: 'Anchor', shapes: [G,
    ink(circle(32, 15, 5.5), bar(32, 19, 32, 46, 5), bar(21, 25, 43, 25, 4.5), arc(32, 32, 15, 25, 155, 5)),
    ink(poly([[48.5, 31.9], [49.2, 40], [42, 36.6]], 1), poly([[15.5, 31.9], [22, 36.6], [14.8, 40]], 1)),
    light(circle(32, 15, 2.4)),
  ] },
  { id: 'mountain', name: 'Mountain', shapes: [G,
    soft(poly([[20, 72], [42, 25], [72, 72]], 3)),
    ink(poly([[-10, 72], [25, 17], [60, 72]], 3)),
    light(poly([[25, 17], [30.9, 26], [28, 24.5], [25, 27.5], [22, 24.5], [19.1, 26]], [3, 1, 1, 1, 1, 1])),
  ] },
  { id: 'sunrise', name: 'Sunrise', shapes: [G,
    soft('M0 43H64V64H0Z'),
    ink('M20 42A12 12 0 0 1 44 42Z', ...[-150, -120, -90, -60, -30].map(a => bar(32 + 16 * Math.cos(rad(a)), 42 + 16 * Math.sin(rad(a)), 32 + 21 * Math.cos(rad(a)), 42 + 21 * Math.sin(rad(a)), 3.5))),
    ink(bar(24, 48, 40, 48, 2.5), bar(28, 53, 36, 53, 2.5)),
  ] },
  { id: 'lily', name: 'Lily', shapes: [G,
    soft(leaf(32, 51, 19, 42, 4.2), leaf(32, 49, 45, 40, 4.2)),
    ink(bar(32, 34, 32, 52, 3)),
    ink(...[0, 72, 144, 216, 288].map(a => circle(32 + 8.5 * Math.cos(rad(a - 90)), 26 + 8.5 * Math.sin(rad(a - 90)), 7))),
    light(circle(32, 26, 4.5)),
    ink(circle(32, 26, 2.2)),
  ] },
  { id: 'pomegranate', name: 'Pomegranate', shapes: [G,
    ink(circle(32, 37, 14), poly([[25, 26], [24, 16], [28.5, 19.5], [32, 14], [35.5, 19.5], [40, 16], [39, 26]], 1.2)),
    light(arc(32, 37, 9.5, 200, 250, 2.6)),
  ] },
  { id: 'jar', name: 'Water jar', shapes: [G,
    ink(rect(25, 13, 14, 4, 2), 'M28 17H36C36 22 38 23 42 25C48 29 49 35 48 40C47 46 42 50 32 50C22 50 17 46 16 40C15 35 16 29 22 25C26 23 28 22 28 17Z'),
    ink(arc(20, 26, 5, 110, 290, 3), arc(44, 26, 5, -110, 70, 3)),
    light(bar(19, 35, 45, 35, 2.2)),
  ] },
  { id: 'key', name: 'Key', shapes: [G,
    ink(circle(21, 21, 10), bar(26, 26, 46, 46, 6)),
    ink(poly([[38.5, 38.5], [48, 48], [43, 53], [33.5, 43.5]], 1.5)),
    light(circle(21, 21, 4.4)),
    cut(bar(41, 46, 38.5, 48.5, 2.6)),
  ] },
  { id: 'cedar', name: 'Cedar', shapes: [G,
    soft(ellipse(32, 52, 13, 2.5)),
    ink(bar(32, 22, 32, 52, 5)),
    ink(ellipse(32, 18, 7, 4), ellipse(25, 29, 8, 4), ellipse(39, 29, 8, 4), ellipse(32, 27.5, 7, 4.5)),
    ink(ellipse(20, 40, 10, 4.5), ellipse(44, 40, 10, 4.5), ellipse(32, 38.5, 10, 5)),
  ] },
]

export const AVATAR_IDS: readonly string[] = AVATARS.map(a => a.id)
const BY_ID: Record<string, AvatarDef> = Object.fromEntries(AVATARS.map(a => [a.id, a]))

export const isAvatarId = (s: unknown): s is string => typeof s === 'string' && Object.hasOwn(BY_ID, s)

/**
 * The avatar shown when a user has not chosen one: deterministic from the user id, spread evenly. The id's low 32 bits
 * go through the lowbias32 integer hash (Chris Wellons), then modulo the count, so consecutive sign-ups get unrelated
 * pictures. Port it bit for bit if the server ever needs the same answer.
 */
export function defaultAvatar(userId: number): string {
  let x = userId >>> 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return AVATARS[(x >>> 0) % AVATARS.length].id
}

export function avatarFor(user: { id: number; avatar?: string | null }): AvatarDef {
  return BY_ID[isAvatarId(user.avatar) ? user.avatar : defaultAvatar(user.id)]
}

const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
/** Solid blend of two `#rrggbb` colours, `t` = 0 gives `a` (the same rule as `mix` in client/src/theme.ts). */
function mix(a: string, b: string, t: number): string {
  const A = rgb(a), B = rgb(b)
  return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('')
}

/**
 * Theme roles for the drawing, one hue per theme like everything else:
 * - ground: `accentSoft`, the disc;
 * - ink: `accent`, the drawing itself (at least 3:1 on the ground in all 25 themes);
 * - soft: ground mixed 42% toward the accent, for half-tone masses (water, a far wing, leaves behind);
 * - light: the page (`bg`), cut into ink shapes (a lamp's filling hole, a flame's heart);
 * - accent: the accent mixed 60% toward the text, the deepest tone, for small details on the ground or on soft.
 */
export function avatarRoleColours(c: { bg: string; card: string; text: string; muted: string; accent: string; accentSoft: string; accentText: string }): Record<AvatarRole, string> {
  return {
    ground: c.accentSoft,
    ink: c.accent,
    soft: mix(c.accentSoft, c.accent, 0.42),
    light: c.bg,
    accent: mix(c.accent, c.text, 0.6),
  }
}
