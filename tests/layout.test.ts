import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { DESKTOP_MIN, DIALOG_MAX_W, DIALOG_RISE, PANE_W, RAIL_W, dialogFrame, isDesktop, readerColumnWidth } from '../client/src/lib/layout'
import { TOOLBAR_WIDE } from '../client/src/lib/tour'

const src = (p: string) => readFileSync(new URL(`../client/${p}`, import.meta.url), 'utf8')

describe('desktop breakpoint', () => {
  it('starts at 1024 px: a portrait tablet and every phone stay below it', () => {
    expect(DESKTOP_MIN).toBe(1024)
    expect(isDesktop(1023)).toBe(false)
    expect(isDesktop(1024)).toBe(true)
    for (const w of [360, 412, 720, 800, 834]) expect(isDesktop(w)).toBe(false)
    for (const w of [1024, 1280, 1440, 1920]) expect(isDesktop(w)).toBe(true)
  })
  it('sits above the wide-toolbar step, which it leaves alone', () => {
    expect(TOOLBAR_WIDE).toBe(720)
    expect(DESKTOP_MIN).toBeGreaterThan(TOOLBAR_WIDE)
  })
})

describe('desktop measures', () => {
  it('rail 72–88 px, icons over labels: the 60 px icon box fits with room either side', () => {
    expect(RAIL_W).toBeGreaterThanOrEqual(72)
    expect(RAIL_W).toBeLessThanOrEqual(88)
    expect(RAIL_W).toBeGreaterThan(60 + 2 * 5)
  })
  it('pane about 260 px: five 40 px chapter cells and four 6 px gaps fit inside 12 px padding, six do not', () => {
    expect(PANE_W).toBe(260)
    expect(src('src/components/BookPane.tsx')).toMatch(/const CELL_W = 40\b/)
    expect(5 * 40 + 4 * 6).toBeLessThanOrEqual(PANE_W - 2 * 12)
    expect(6 * 40 + 5 * 6).toBeGreaterThan(PANE_W - 2 * 12)
  })
  it('dialog: 560 px at most, rising 24 px from below (not its own height)', () => {
    expect(DIALOG_MAX_W).toBe(560)
    expect(DIALOG_RISE).toBe(24)
  })
})

describe('reading column', () => {
  it('is the window less the rail and the pane on the desktop, the whole window below it', () => {
    expect(readerColumnWidth(1280)).toBe(1280 - RAIL_W - PANE_W)
    expect(readerColumnWidth(1440)).toBe(1440 - RAIL_W - PANE_W)
    expect(readerColumnWidth(412)).toBe(412)
    expect(readerColumnWidth(1023)).toBe(1023)
  })
  it('never goes negative', () => {
    expect(readerColumnWidth(100, true)).toBe(0)
  })
  it('leaves the medium measure (34 em at 19 px + gutters = 686) whole at 1280', () => {
    expect(readerColumnWidth(1280)).toBeGreaterThan(19 * 34 + 40)
  })
})

describe('dialog frame', () => {
  it('is centred and capped at DIALOG_MAX_W', () => {
    expect(dialogFrame(1280)).toEqual({ width: 560, left: 360 })
    expect(dialogFrame(1440)).toEqual({ width: 560, left: 440 })
  })
  it('keeps a gutter when the window is narrower than the cap', () => {
    expect(dialogFrame(500)).toEqual({ width: 460, left: 20 })
  })
})

describe('the source uses the one breakpoint', () => {
  it('tabs, reader, sheet and Home read useDesktop; the rail and pane take their widths from lib/layout', () => {
    expect(src('app/(tabs)/_layout.tsx')).toMatch(/useDesktop\(\)/)
    expect(src('app/(tabs)/_layout.tsx')).toMatch(/tabBarPosition: desktop \? 'left' : 'bottom'/)
    expect(src('app/(tabs)/_layout.tsx')).toMatch(/width: RAIL_W/)
    expect(src('app/(tabs)/read/[book]/[chapter].tsx')).toMatch(/useDesktop\(\)/)
    expect(src('app/(tabs)/read/[book]/[chapter].tsx')).toMatch(/<SwipePager[^>]*width=\{pageW\}/)
    expect(src('src/components/BookPane.tsx')).toMatch(/width: PANE_W/)
    expect(src('src/components/ui.tsx')).toMatch(/maxWidth: DIALOG_MAX_W/)
    expect(src('src/components/ui.tsx')).toMatch(/desktop \? DIALOG_RISE/)
    expect(src('app/(tabs)/index.tsx')).toMatch(/useDesktop\(\)/)
    // the hook is the only reader of the window for this: no second threshold anywhere
    expect(src('src/hooks/useDesktop.ts')).toMatch(/isDesktop\(useWindowDimensions\(\)\.width\)/)
    for (const p of ['app/(tabs)/_layout.tsx', 'src/components/ui.tsx', 'src/components/BookPane.tsx', 'app/(tabs)/read/[book]/[chapter].tsx']) expect(src(p)).not.toMatch(/>= ?1024|1024 ?<=/)
  })
  it('the tour names the tab bar without a side, since it stands below or beside', () => {
    expect(src('src/lib/tour.ts')).not.toMatch(/down here/)
  })
})
