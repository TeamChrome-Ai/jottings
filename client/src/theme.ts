import { Platform, type TextStyle } from 'react-native'
import type { Font } from './store/prefs'
import { customIdOf, getCustomFont, nativeFamily, webFamily, type FaceKey } from './lib/customFonts'
import { lineFactor } from './lib/lineHeight'
import { HL_EXTRA, type HlColor, type HlCore, type HlExtra } from './lib/hlColours'
import { N_, t, tc } from '@shared/i18n'

export type Group = 'light' | 'dark' | 'black'
export interface Colors {
  bg: string; card: string; text: string; muted: string; border: string; accent: string; accentText: string
  selected: string; danger: string; hl: Record<HlColor, string>; bar: string
  /** Solid accent tint on `bg`: secondary fills, the selected tab pill, chips. Text on it uses `text`. */
  accentSoft: string
}
export interface ThemeDef extends Colors { id: ThemeId; name: string; group: Group; dark: boolean }

const HL_LIGHT: Record<HlCore, string> = { yellow: '#fde68a', green: '#bbf7d0', blue: '#bfdbfe', pink: '#fbcfe8' }
const HL_DARK: Record<HlCore, string> = { yellow: '#713f12', green: '#14532d', blue: '#1e3a8a', pink: '#831843' }
/**
 * The eight extra highlighters ("More highlight colours"), each as OKLCH [lightness, chroma, hue] on a light page and
 * on a dark one. The hue moves between the two because the core four do: yellow is 96° light and 58° dark, so orange
 * and brown stand clear of it on each. `hlTints` makes a theme's eight from these; tests/hlColours.test.ts holds what
 * they must keep on every theme.
 */
type LCH = readonly [number, number, number]
const HL_LCH: Record<HlExtra, { light: LCH; dark: LCH }> = {
  orange: { light: [0.885, 0.115, 62], dark: [0.44, 0.13, 42] },
  red: { light: [0.83, 0.1, 22], dark: [0.41, 0.16, 28] },
  purple: { light: [0.85, 0.09, 300], dark: [0.4, 0.14, 305] },
  teal: { light: [0.88, 0.1, 188], dark: [0.42, 0.075, 195] },
  sky: { light: [0.87, 0.09, 220], dark: [0.42, 0.09, 235] },
  lime: { light: [0.93, 0.15, 125], dark: [0.42, 0.1, 120] },
  brown: { light: [0.79, 0.05, 55], dark: [0.33, 0.04, 45] },
  grey: { light: [0.84, 0.003, 90], dark: [0.37, 0, 0] },
}
/** What is printed on a tinted verse (its words, its number, a note's letter) and the contrast each keeps on an extra
 *  tint: this, or what the theme's weakest core tint gives that ink where that is lower. */
const HL_INKS = [['text', 7], ['muted', 3], ['accent', 3]] as const
/** A dark tint rises with its page (Nord's is far lighter than Black's), by this share of the page's lightness. */
const HL_LIFT = 0.2

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
/** OKLCH → `#rrggbb`; the chroma gives way until sRGB can show the colour. */
function oklch(L: number, C: number, h: number): string {
  const a = Math.cos(h * Math.PI / 180), b = Math.sin(h * Math.PI / 180)
  for (let c = C; ; c = Math.max(0, c - 0.004)) {
    const l = (L + 0.3963377774 * a * c + 0.2158037573 * b * c) ** 3, m = (L - 0.1055613458 * a * c - 0.0638541728 * b * c) ** 3, s = (L - 0.0894841775 * a * c - 1.291485548 * b * c) ** 3
    const v = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    if (c === 0 || v.every(x => x > -0.0005 && x < 1.0005)) return '#' + v.map(x => { const y = Math.min(1, Math.max(0, x)); return Math.round(255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0') }).join('')
  }
}
/**
 * A theme's twelve highlight tints: the core four as they are, and each extra from its hue. An extra starts at its
 * lightness (a dark one lifted with the page) and steps away from the inks, lighter on a light page and darker on a
 * dark one, until all three read on it (HL_INKS).
 */
function hlTints(core: Record<HlCore, string>, inks: Pick<Colors, 'text' | 'muted' | 'accent'>, bg: string, dark: boolean): Record<HlColor, string> {
  const floors = HL_INKS.map(([k, want]) => [inks[k], Math.min(want, ...Object.values(core).map(t => contrast(inks[k], t)))] as const)
  const lift = dark ? HL_LIFT * Math.cbrt(lum(bg)) : 0, step = dark ? -0.005 : 0.005
  const out = { ...core } as Record<HlColor, string>
  for (const k of HL_EXTRA) {
    const [L, C, h] = HL_LCH[k][dark ? 'dark' : 'light']
    let l = L + lift, tint = oklch(l, C, h)
    for (let i = 0; i < 80 && floors.some(([ink, min]) => contrast(ink, tint) < min); i++) tint = oklch(l += step, C, h)
    out[k] = tint
  }
  return out
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
  const muted = legible(s.muted, s.text, [s.bg, card], 4.5), accent = legible(s.accent, s.text, [s.bg, card], 4.5)
  return {
    ...s, dark, card, muted, accent,
    // the name below is its English; the screens read it in the reader's language
    get name() { return t(s.name) },
    bar: mix(s.bg, s.text, m.bar),
    border: mix(s.bg, s.text, m.border),
    accentText: s.accentText ?? (dark ? s.bg : '#ffffff'),
    accentSoft: mix(s.bg, s.accent, m.soft),
    danger: s.danger ?? (dark ? '#f87171' : '#b91c1c'),
    selected: alpha(s.accent, dark ? 0.24 : 0.16),
    hl: hlTints(dark ? HL_DARK : HL_LIGHT, { text: s.text, muted, accent }, s.bg, dark),
  }
}
const light = (s: Spec) => build(s, false, LIGHT_MIX)
const dark = (s: Spec) => build(s, true, DARK_MIX)
const black = (id: string, name: string, accent: string) => build({ id, name, group: 'black', bg: '#000000', text: '#e8e6e3', muted: '#8f8f8f', accent, accentText: '#000000' }, true, BLACK_MIX)

// Ordered as the gallery shows them. Ids are storage keys: never rename one, only add.
const SPECS = [
  light({ id: 'paper', name: N_('Paper'), group: 'light', bg: '#faf7f2', text: '#221b16', muted: '#6b5f55', accent: '#7c2d12' }),
  light({ id: 'sepia', name: N_('Sepia'), group: 'light', bg: '#f3e9d4', text: '#382b1c', muted: '#6e5d45', accent: '#8a3a0e', danger: '#9f1239' }),
  light({ id: 'linen', name: N_('Linen'), group: 'light', bg: '#f3f0ea', text: '#1f2330', muted: '#5f6170', accent: '#27466e' }),
  light({ id: 'sand', name: N_('Sand'), group: 'light', bg: '#faf3e3', text: '#33260f', muted: '#735f3c', accent: '#9a4a06' }),
  light({ id: 'mint', name: N_('Mint'), group: 'light', bg: '#ecf5ef', text: '#10302a', muted: '#4f6d64', accent: '#0b6b61' }),
  light({ id: 'sky', name: N_('Sky'), group: 'light', bg: '#edf3fb', text: '#0f1d38', muted: '#51607a', accent: '#1f4fd1' }),
  light({ id: 'rose', name: N_('Rose'), group: 'light', bg: '#fbf0f2', text: '#3b0f1e', muted: '#7d4f5d', accent: '#b3123d' }),
  light({ id: 'lavender', name: N_('Lavender'), group: 'light', bg: '#f3f0fb', text: '#221a3d', muted: '#625a7d', accent: '#6427cf' }),
  light({ id: 'olive', name: N_('Olive'), group: 'light', bg: '#f2f3ea', text: '#1e2314', muted: '#5f6650', accent: '#46700c' }),

  dark({ id: 'slate', name: N_('Slate'), group: 'dark', bg: '#1c1917', text: '#ebe6e1', muted: '#a79f97', accent: '#f6b17f' }),
  dark({ id: 'midnight', name: N_('Midnight'), group: 'dark', bg: '#0e1628', text: '#e3e9f3', muted: '#95a3ba', accent: '#8ccbff' }),
  dark({ id: 'forest', name: N_('Forest'), group: 'dark', bg: '#0e1d16', text: '#dbf3e3', muted: '#8db29c', accent: '#72e0b3' }),
  dark({ id: 'wine', name: N_('Wine'), group: 'dark', bg: '#1d0e13', text: '#f8e6ec', muted: '#b98f9e', accent: '#ff9fb0' }),
  dark({ id: 'nord', name: N_('Nord'), group: 'dark', bg: '#2e3440', text: '#eceff4', muted: '#aab3c5', accent: '#88c0d0' }),
  dark({ id: 'plum', name: N_('Plum'), group: 'dark', bg: '#272433', text: '#f3f0f8', muted: '#a8a2bb', accent: '#c3a2ff' }),
  dark({ id: 'graphite', name: N_('Graphite'), group: 'dark', bg: '#1f1f1f', text: '#ececec', muted: '#a0a0a0', accent: '#e6e6e6' }),
  dark({ id: 'ocean', name: N_('Ocean'), group: 'dark', bg: '#0a1b23', text: '#e0f1f8', muted: '#8fb2c2', accent: '#3fd5c2' }),

  black('black', N_('Black'), '#fdba74'),
  black('black-ember', N_('Ember'), '#fb8a3c'),
  black('black-jade', N_('Jade'), '#34d399'),
  black('black-ice', N_('Ice'), '#6aa8ff'),
  black('black-rose', N_('Petal'), '#fb7185'),
  black('black-gold', N_('Gold'), '#fbbf24'),
  black('black-lilac', N_('Lilac'), '#c89bff'),
  black('black-white', N_('Ink'), '#f5f5f5'),
] as const

export type ThemeId = typeof SPECS[number]['id']
export const THEMES: readonly ThemeDef[] = SPECS as unknown as readonly ThemeDef[]
export const THEME_MAP: Record<string, ThemeDef> = Object.fromEntries(THEMES.map(t => [t.id, t]))
export const LIGHT_DEFAULT: ThemeId = 'paper'
export const DARK_DEFAULT: ThemeId = 'slate'
export const GROUPS: { group: Group; title: string; hint: string }[] = [
  { group: 'light', get title() { return tc('theme group', 'Light') }, get hint() { return t('Paper tones for daylight') } },
  { group: 'dark', get title() { return tc('theme group', 'Dark') }, get hint() { return t('Soft dark pages for the evening') } },
  { group: 'black', get title() { return tc('theme group', 'Black') }, get hint() { return t('True black for OLED screens; only the ink changes') } },
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
