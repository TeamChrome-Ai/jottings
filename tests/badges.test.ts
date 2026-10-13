import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// theme.ts imports Platform for its font helpers; the colours need none of it
vi.mock('../client/node_modules/react-native', () =>({ Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web } }))
const { BADGE_LOOKS, medallion } = await import('../client/src/lib/badgeLooks')
const { THEMES, contrast } = await import('../client/src/theme')

const root = resolve(__dirname, '..')
const serverCodes = [...readFileSync(resolve(root, 'rs/src/badges.rs'), 'utf8').matchAll(/Def \{ code: "([a-z0-9_]+)"/g)].map(m => m[1])
const union = (src: string, type: string) => {
  const m = src.match(new RegExp(`type ${type} = ([^\\n]+)`))
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]) : []
}
const glyphs = new Set([
  ...union(readFileSync(resolve(root, 'client/src/components/Icon.tsx'), 'utf8'), 'IconName'),
  ...union(readFileSync(resolve(root, 'client/src/components/BadgeGlyph.tsx'), 'utf8'), 'Extra'),
])
/** The milestones the owner asked to stand out: every consecutive-day badge, ten and a hundred hours, 100 chapters. */
const FLAIR = ['streak_3', 'streak_7', 'streak_30', 'streak_100', 'streak_365', 'hour_10', 'hour_100', 'pages_100']

describe('badge looks', () => {
  it('cover exactly the server badge table', () => {
    expect(serverCodes.length).toBeGreaterThan(20)
    expect(Object.keys(BADGE_LOOKS).sort()).toEqual([...serverCodes].sort())
  })

  it('never repeat a glyph and tint combination, nor a glyph at all', () => {
    const looks = Object.values(BADGE_LOOKS)
    expect(new Set(looks.map(l => `${l.glyph}/${l.tint}`)).size).toBe(looks.length)
    expect(new Set(looks.map(l => l.glyph)).size).toBe(looks.length)
  })

  it('draw every glyph from the generated icon sets', () => {
    for (const l of Object.values(BADGE_LOOKS)) expect(glyphs.has(l.glyph), l.glyph).toBe(true)
  })

  it('give each milestone its own tint and its own entrance', () => {
    const f = FLAIR.map(code => BADGE_LOOKS[code])
    for (const l of f) { expect(l.tint).not.toBe('bare'); expect(l.motion).not.toBe('grow') }
    expect(new Set(f.map(l => l.tint)).size).toBe(FLAIR.length)
    expect(new Set(f.map(l => l.motion)).size).toBe(FLAIR.length)
  })

  it('keep the glyph legible on its medallion in all 25 themes (3:1, graphics)', () => {
    expect(THEMES.length).toBe(25)
    for (const t of THEMES) {
      for (const [code, l] of Object.entries(BADGE_LOOKS)) {
        const m = medallion(l.tint, t)
        expect(contrast(m.glyph, m.fill ?? t.card), `${t.id} ${code}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
