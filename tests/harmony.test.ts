import { describe, it, expect, vi } from 'vitest'

vi.mock('../client/node_modules/react-native', () => ({ Platform: { OS: 'web', select: (o: Record<string, unknown>) => o.web } }))
const { THEMES, band, contrast } = await import('../client/src/theme')

describe('a figure in parallel columns', () => {
  it('shades the shared cells so the accent reads on them in every theme, Black too', () => {
    for (const t of THEMES) {
      expect(contrast(t.accent, band(t)), t.id).toBeGreaterThanOrEqual(4.5)
      expect(contrast(band(t), t.bg), t.id).toBeGreaterThanOrEqual(1.05)
    }
  })
})
