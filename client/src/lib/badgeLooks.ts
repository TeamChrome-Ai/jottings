import type { BadgeGlyphName } from '../components/BadgeGlyph'
import type { Colors } from '../theme'

/**
 * How a badge's mark is drawn. Every tint comes from the theme's accent and surfaces, never a second hue (a gold disc
 * read as off-theme on the dark and black themes). No two badges may share a glyph; tests/badges.test.ts checks the
 * table against the server's list in rs/src/badges.rs.
 *
 * - bare: glyph in the accent, no medallion
 * - soft: `accentSoft` disc
 * - ring: accent ring on the card
 * - halo: `accentSoft` disc inside an accent ring
 * - solid: accent disc, glyph in `accentText`
 * - seal: accent disc with an `accentSoft` outer ring
 * - plate: disc in the opposite surface (`bg` on the card)
 * - double: two concentric accent rings
 * - coin: accent disc with an `accentText` rim inside its edge
 */
export type BadgeTint = 'bare' | 'soft' | 'ring' | 'halo' | 'solid' | 'seal' | 'plate' | 'double' | 'coin'

/**
 * The mark's own entrance, played once as its card lands; `grow` adds nothing to the card's pop-in.
 * kindle: flame leaps up from its base; drop: falls in and bounces; rise: lifts into place; glint: turns a quarter and
 * swells; tilt: settles like a crown set down; flip: turned over like an hourglass; sweep: half a turn of the hand;
 * turn: swings in like a page.
 */
export type BadgeMotion = 'grow' | 'kindle' | 'drop' | 'rise' | 'glint' | 'tilt' | 'flip' | 'sweep' | 'turn'

export interface BadgeLook { glyph: BadgeGlyphName; tint: BadgeTint; motion: BadgeMotion }

const L = (glyph: BadgeGlyphName, tint: BadgeTint = 'bare', motion: BadgeMotion = 'grow'): BadgeLook => ({ glyph, tint, motion })

/** Keyed by the server's badge code. The streak, ten and hundred hour, and hundred chapter milestones carry the flair. */
export const BADGE_LOOKS: Record<string, BadgeLook> = {
  first_page: L('pages'),
  streak_3: L('flame', 'soft', 'kindle'),
  streak_7: L('week', 'ring', 'drop'),
  streak_30: L('trophy', 'halo', 'rise'),
  streak_100: L('gem', 'solid', 'glint'),
  streak_365: L('crown', 'coin', 'tilt'),
  hour_1: L('clock'),
  hour_10: L('hourglass', 'plate', 'flip'),
  hour_100: L('timer', 'double', 'sweep'),
  pages_50: L('stack'),
  pages_100: L('layers', 'seal', 'turn'),
  pages_500: L('library'),
  book_1: L('done'),
  gospels: L('four'),
  pentateuch: L('scroll'),
  psalms: L('music'),
  nt: L('star'),
  ot: L('mountain'),
  bible: L('award'),
  outline_1: L('note'),
  outline_shared: L('share'),
  early_bird: L('sunrise'),
  night_owl: L('moon'),
  group_joined: L('people'),
  // friend streaks (both friends met their goal on the same day)
  friend_streak_7: L('handshake', 'soft', 'rise'),
  friend_streak_30: L('kinship', 'halo', 'drop'),
  friend_streak_100: L('always', 'seal', 'glint'),
  // group streaks (every member met their goal on the same day)
  group_streak_7: L('hearth', 'ring', 'kindle'),
  group_streak_30: L('hive', 'plate', 'rise'),
  group_streak_100: L('forest', 'double', 'grow'),
  // secret: the server lists it only once an admin has granted it
  supporter: L('gift', 'seal', 'rise'),
}

/** A code this client does not know yet (a newer server) still gets a mark. */
export const FALLBACK_LOOK: BadgeLook = L('award')
export const badgeLook = (code: string): BadgeLook => BADGE_LOOKS[code] ?? FALLBACK_LOOK

/** Resolved colours of a medallion. `fill`/`ring`/`outer` absent means that layer is not drawn. */
export interface Medallion { glyph: string; fill?: string; ring?: string; outer?: string; inner?: string }

/**
 * Colours for `tint` in theme `c` on a card. A locked badge keeps the shape in neutral tones (`border` for accent
 * layers, `muted` glyph) so the treatment is visible before it is earned.
 */
export function medallion(tint: BadgeTint, c: Colors, earned = true): Medallion {
  if (!earned) {
    const n = c.border
    switch (tint) {
      case 'bare': return { glyph: c.muted }
      case 'soft': case 'plate': return { glyph: c.muted, fill: c.bg }
      case 'ring': return { glyph: c.muted, ring: n }
      case 'halo': return { glyph: c.muted, fill: c.bg, ring: n }
      case 'solid': return { glyph: c.card, fill: c.muted }
      case 'seal': return { glyph: c.card, fill: c.muted, outer: n }
      case 'double': return { glyph: c.muted, ring: n, inner: n }
      case 'coin': return { glyph: c.card, fill: c.muted, inner: c.card }
    }
  }
  switch (tint) {
    case 'bare': return { glyph: c.accent }
    case 'soft': return { glyph: c.accent, fill: c.accentSoft }
    case 'ring': return { glyph: c.accent, ring: c.accent }
    case 'halo': return { glyph: c.accent, fill: c.accentSoft, ring: c.accent }
    case 'solid': return { glyph: c.accentText, fill: c.accent }
    case 'seal': return { glyph: c.accentText, fill: c.accent, outer: c.accentSoft }
    case 'plate': return { glyph: c.accent, fill: c.bg }
    case 'double': return { glyph: c.accent, ring: c.accent, inner: c.accent }
    case 'coin': return { glyph: c.accentText, fill: c.accent, inner: c.accentText }
  }
}
