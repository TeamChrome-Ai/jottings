import { Platform, type TextStyle } from 'react-native'
import type { Font } from './store/prefs'
import { customIdOf, getCustomFont, nativeFamily, webFamily, type FaceKey } from './lib/customFonts'
import { lineFactor } from './lib/lineHeight'

export type Group = 'light' | 'dark' | 'black'
export interface Colors {
  bg: string; card: string; text: string; muted: string; border: string; accent: string; accentText: string
  selected: string; danger: string; hl: Record<'yellow' | 'green' | 'blue' | 'pink', string>; bar: string
  /** Solid accent tint on `bg`: secondary fills, the selected tab pill, chips. Text on it uses `text`. */
  accentSoft: string
}
export interface ThemeDef extends Colors { id: ThemeId; name: string; group: Group; dark: boolean }

const HL_LIGHT = { yellow: '#fde68a', green: '#bbf7d0', blue: '#bfdbfe', pink: '#fbcfe8' }
const HL_DARK = { yellow: '#713f12', green: '#14532d', blue: '#1e3a8a', pink: '#831843' }

/** `#rrggbb` → `rgba(r,g,b,a)`; used for the selection tint derived from each theme's accent. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
/** Solid blend of two `#rrggbb` colours: `t` = 0 gives `a`, 1 gives `b`. */
export function mix(a: string, b: string, t: number): string {
  const A = rgb(a), B = rgb(b)
  return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('')
}
const lum = (hex: string) => {
  const [r, g, b] = rgb(hex).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const x = lum(a), y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
/** The faint accent band behind a harmony's filled cells (the Gospels that share a passage): a step of the soft accent,
 *  so the accent's references keep 4.5:1 on it in every theme. */
export const band = (c: Pick<Colors, 'bg' | 'accentSoft'>) => mix(c.bg, c.accentSoft, 0.6)
/** Walks `fg` toward `toward` until it reads at `min`:1 on every surface; a no-op for the hand-checked themes, a guard for new ones. */
function legible(fg: string, toward: string, on: string[], min: number): string {
  let out = fg
  for (let t = 0.08; t <= 1 && on.some(s => contrast(out, s) < min); t += 0.08) out = mix(fg, toward, t)
  return out
}

/**
 * A theme is five picked values; every surface is derived from them so all 25 share one structure.
 * Surfaces are the page mixed toward its own ink (flat tonal fills, never white cards with outlines);
 * `border` is for tracks, dividers and text-field outlines only.
 */
type Spec = { id: string; name: string; group: Group; bg: string; text: string; muted: string; accent: string; accentText?: string; danger?: string }
type Mix = { card: number; bar: number; border: number; soft: number }
const LIGHT_MIX: Mix = { card: 0.055, bar: 0.03, border: 0.17, soft: 0.13 }
const DARK_MIX: Mix = { card: 0.075, bar: 0.04, border: 0.22, soft: 0.18 }
const BLACK_MIX: Mix = { card: 0.085, bar: 0.05, border: 0.2, soft: 0.2 }

function build(s: Spec, dark: boolean, m: Mix): Omit<ThemeDef, 'id'> & { id: string } {
  const card = mix(s.bg, s.text, m.card)
  return {
    ...s, dark, card,
    bar: mix(s.bg, s.text, m.bar),
    border: mix(s.bg, s.text, m.border),
    muted: legible(s.muted, s.text, [s.bg, card], 4.5),
    accent: legible(s.accent, s.text, [s.bg, card], 4.5),
    accentText: s.accentText ?? (dark ? s.bg : '#ffffff'),
    accentSoft: mix(s.bg, s.accent, m.soft),
    danger: s.danger ?? (dark ? '#f87171' : '#b91c1c'),
    selected: alpha(s.accent, dark ? 0.24 : 0.16),
    hl: dark ? HL_DARK : HL_LIGHT,
  }
}
const light = (s: Spec) => build(s, false, LIGHT_MIX)
const dark = (s: Spec) => build(s, true, DARK_MIX)
const black = (id: string, name: string, accent: string) => build({ id, name, group: 'black', bg: '#000000', text: '#e8e6e3', muted: '#8f8f8f', accent, accentText: '#000000' }, true, BLACK_MIX)

// Ordered as the gallery shows them. Ids are storage keys: never rename one, only add.
const SPECS = [
  light({ id: 'paper', name: 'Paper', group: 'light', bg: '#faf7f2', text: '#221b16', muted: '#6b5f55', accent: '#7c2d12' }),
  light({ id: 'sepia', name: 'Sepia', group: 'light', bg: '#f3e9d4', text: '#382b1c', muted: '#6e5d45', accent: '#8a3a0e', danger: '#9f1239' }),
  light({ id: 'linen', name: 'Linen', group: 'light', bg: '#f3f0ea', text: '#1f2330', muted: '#5f6170', accent: '#27466e' }),
  light({ id: 'sand', name: 'Sand', group: 'light', bg: '#faf3e3', text: '#33260f', muted: '#735f3c', accent: '#9a4a06' }),
  light({ id: 'mint', name: 'Mint', group: 'light', bg: '#ecf5ef', text: '#10302a', muted: '#4f6d64', accent: '#0b6b61' }),
  light({ id: 'sky', name: 'Sky', group: 'light', bg: '#edf3fb', text: '#0f1d38', muted: '#51607a', accent: '#1f4fd1' }),
  light({ id: 'rose', name: 'Rose', group: 'light', bg: '#fbf0f2', text: '#3b0f1e', muted: '#7d4f5d', accent: '#b3123d' }),
  light({ id: 'lavender', name: 'Lavender', group: 'light', bg: '#f3f0fb', text: '#221a3d', muted: '#625a7d', accent: '#6427cf' }),
  light({ id: 'olive', name: 'Olive', group: 'light', bg: '#f2f3ea', text: '#1e2314', muted: '#5f6650', accent: '#46700c' }),

  dark({ id: 'slate', name: 'Slate', group: 'dark', bg: '#1c1917', text: '#ebe6e1', muted: '#a79f97', accent: '#f6b17f' }),
  dark({ id: 'midnight', name: 'Midnight', group: 'dark', bg: '#0e1628', text: '#e3e9f3', muted: '#95a3ba', accent: '#8ccbff' }),
  dark({ id: 'forest', name: 'Forest', group: 'dark', bg: '#0e1d16', text: '#dbf3e3', muted: '#8db29c', accent: '#72e0b3' }),
  dark({ id: 'wine', name: 'Wine', group: 'dark', bg: '#1d0e13', text: '#f8e6ec', muted: '#b98f9e', accent: '#ff9fb0' }),
  dark({ id: 'nord', name: 'Nord', group: 'dark', bg: '#2e3440', text: '#eceff4', muted: '#aab3c5', accent: '#88c0d0' }),
  dark({ id: 'plum', name: 'Plum', group: 'dark', bg: '#272433', text: '#f3f0f8', muted: '#a8a2bb', accent: '#c3a2ff' }),
  dark({ id: 'graphite', name: 'Graphite', group: 'dark', bg: '#1f1f1f', text: '#ececec', muted: '#a0a0a0', accent: '#e6e6e6' }),
  dark({ id: 'ocean', name: 'Ocean', group: 'dark', bg: '#0a1b23', text: '#e0f1f8', muted: '#8fb2c2', accent: '#3fd5c2' }),

  black('black', 'Black', '#fdba74'),
  black('black-ember', 'Ember', '#fb8a3c'),
  black('black-jade', 'Jade', '#34d399'),
  black('black-ice', 'Ice', '#6aa8ff'),
  black('black-rose', 'Petal', '#fb7185'),
  black('black-gold', 'Gold', '#fbbf24'),
  black('black-lilac', 'Lilac', '#c89bff'),
  black('black-white', 'Ink', '#f5f5f5'),
] as const

export type ThemeId = typeof SPECS[number]['id']
export const THEMES: readonly ThemeDef[] = SPECS as unknown as readonly ThemeDef[]
export const THEME_MAP: Record<string, ThemeDef> = Object.fromEntries(THEMES.map(t => [t.id, t]))
export const LIGHT_DEFAULT: ThemeId = 'paper'
export const DARK_DEFAULT: ThemeId = 'slate'
export const GROUPS: { group: Group; title: string; hint: string }[] = [
  { group: 'light', title: 'Light', hint: 'Paper tones for daylight' },
  { group: 'dark', title: 'Dark', hint: 'Soft dark pages for the evening' },
  { group: 'black', title: 'Black', hint: 'True black for OLED screens; only the ink changes' },
]
export const isThemeId = (s: string): s is ThemeId => s in THEME_MAP

/** Pre-gallery preference values (`light`/`dark`/`sepia`) map onto the ids they became. */
export function migrateThemeId(v: unknown): ThemeId | 'system' {
  if (v === 'system') return 'system'
  if (v === 'light') return 'paper'
  if (v === 'dark') return 'slate'
  return typeof v === 'string' && isThemeId(v) ? v : 'system'
}

export function resolveThemeId(theme: ThemeId | 'system', themeLight: ThemeId, themeDark: ThemeId, system: string | null | undefined): ThemeId {
  if (theme !== 'system') return theme
  return system === 'dark' ? themeDark : themeLight
}

/**
 * Literata ships as three Latin-subset faces. Native registers each face under its own name (expo-font in
 * app/_layout.tsx); the web page's head declares them as one "Literata" family with real weight/style descriptors
 * (public/index.html, lib/appFonts.web.ts), so browsers pick the true italic/bold instead of synthesising one.
 */
const WEB_SERIF = 'Literata, Georgia, "Times New Roman", serif'
const WEB_SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

const customFaceKey = (italic = false, bold = false): FaceKey => (bold ? 'bold' : italic ? 'italic' : 'regular')

/** RN needs a concrete family per weight/style for custom fonts; system fonts synthesise italics themselves. */
export function fontFamily(font: Font, italic = false, bold = false): string | undefined {
  const id = customIdOf(font)
  if (id) {
    const rec = getCustomFont(id)
    if (!rec) return fontFamily('serif', italic, bold)
    if (Platform.OS === 'web') return `"${webFamily(id)}", Georgia, serif`
    const k = customFaceKey(italic, bold)
    return nativeFamily(id, rec.faces[k] ? k : 'regular')
  }
  if (font === 'dyslexic') return bold ? 'OpenDyslexic-Bold' : italic ? 'OpenDyslexic-Italic' : 'OpenDyslexic'
  if (font === 'serif') return Platform.OS === 'web' ? WEB_SERIF : bold ? 'Literata-Bold' : italic ? 'Literata-Italic' : 'Literata'
  // named explicitly (not undefined) so a sans span nested in serif scripture does not inherit the serif family
  return Platform.select({ web: WEB_SANS, ios: 'System', android: 'sans-serif', default: undefined })
}

/**
 * Complete face style (family + weight + style) for a font role. Prefer this to fontFamily() in new code: native custom
 * faces must not also get fontWeight/fontStyle (Android fakes bold on top of the bold face), while web and the system
 * sans need them.
 */
export function face(font: Font, o: { italic?: boolean; bold?: boolean } = {}): TextStyle {
  const family = fontFamily(font, o.italic, o.bold)
  const id = customIdOf(font)
  if (id) {
    const rec = getCustomFont(id)
    if (!rec) return face('serif', o)
    // an added font may lack Bold or Italic: native then synthesises them on the Regular face, as web always does
    if (Platform.OS !== 'web' && rec.faces[customFaceKey(o.italic, o.bold)]) return { fontFamily: family, fontWeight: 'normal', fontStyle: 'normal' }
    return { fontFamily: family, fontWeight: o.bold ? '700' : '400', fontStyle: o.italic ? 'italic' : 'normal' }
  }
  const custom = font === 'dyslexic' || (font === 'serif' && Platform.OS !== 'web')
  if (custom) return { fontFamily: family, fontWeight: 'normal', fontStyle: 'normal' }
  return { fontFamily: family, fontWeight: o.bold ? '700' : '400', fontStyle: o.italic ? 'italic' : 'normal' }
}

/** Android lays a Text out on the font's ascent and descent, not its outer glyph bounds (Literata's reach 1.86 em):
 *  with the line box centred on the content area, the padding would push every line's descenders out of the box. */
export const TEXT_FIT: TextStyle | null = Platform.OS === 'android' ? { includeFontPadding: false } : null

/**
 * The reader's font for prose away from the chapter (today's verse, dictionary articles, the notices, outlines):
 * `face(font)` at `size` with a line height of `line` times it, or of the font's floor (lib/lineHeight.ts) when
 * `line` is tighter than its descenders allow. OpenDyslexic keeps the floors the reader gives it: line height 1.8
 * and letter spacing 0.03 em.
 */
export function proseStyle(font: Font, size: number, line: number, o: { italic?: boolean; bold?: boolean } = {}): TextStyle {
  const dys = font === 'dyslexic'
  return { fontSize: size, lineHeight: Math.round(size * lineFactor(font, line)), ...(dys ? { letterSpacing: size * 0.03 } : null), ...face(font, o), ...TEXT_FIT }
}
