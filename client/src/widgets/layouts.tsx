import { FlexWidget, SvgWidget, TextWidget, type HexColor } from 'react-native-android-widget'
import { iconPath } from '../components/Icon'
import { mix, type Colors } from '../theme'
import { tn } from '@shared/i18n'
import { VERSE_GAP, VERSE_PAD, VERSE_REF_LINE, verseFit, type SealTone, type StreakCard, type VerseCard, type WeekDot } from './model'

/**
 * The two home-screen widgets as the widget library's layout tree (plain functions: the library calls them once per
 * draw, so no hooks). Android draws each tree to a bitmap at the widget's size in dp, once in the light theme and once
 * in the dark, and shows the one for the system mode. Flat and tonal like the app: the page colour, one accent, no
 * shadows; text keeps to its own size (`allowFontScaling` off) because the widget cannot grow to hold a larger one.
 */

const hex = (s: string) => s as HexColor
/** The hero block's radius; halved on a one-row widget so it stays a pill. */
const radius = (height: number) => Math.min(28, Math.floor(height / 2))
const FILL = { width: 'match_parent', height: 'match_parent' } as const

export interface WidgetSize { width: number; height: number }

export function VerseWidget({ card, c, width, height }: { card: VerseCard; c: Colors } & WidgetSize) {
  const fit = verseFit(width, height, card.text.length)
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: card.url }} accessibilityLabel={card.a11y}
      style={{ ...FILL, flexDirection: 'column', backgroundColor: hex(c.bg), borderRadius: radius(height), padding: VERSE_PAD, flexGap: VERSE_GAP }}>
      <TextWidget text={card.label} maxLines={1} truncate="END" allowFontScaling={false}
        style={{ width: 'match_parent', height: VERSE_REF_LINE, fontSize: 14, fontWeight: 'bold', color: hex(c.accent) }} />
      {card.text ? (
        <TextWidget text={card.text} maxLines={fit.maxLines} truncate="END" allowFontScaling={false}
          style={{ width: 'match_parent', fontSize: fit.fontSize, lineHeight: fit.lineHeight, fontFamily: 'Literata-Regular', color: hex(c.text) }} />
      ) : null}
    </FlexWidget>
  )
}

/** The friend streak seal, drawn once: a flame on a medallion, solid when today is kept (`StreakSeal`). */
export function sealSvg(tone: SealTone, c: Colors, size: number): string {
  // room for the kept seal's outer ring, whatever the tone, so nothing moves when the day is kept
  const box = size + 8, mid = box / 2, r = size / 2
  const kept = tone === 'kept'
  const base = kept ? c.accent : tone === 'waiting' ? c.accentSoft : c.card
  const ink = kept ? c.accentText : tone === 'waiting' ? c.accent : tone === 'lapsed' ? c.muted : c.border
  const g = Math.round(size * 0.56), at = (box - g) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">`
    + (kept ? `<circle cx="${mid}" cy="${mid}" r="${r + 2.5}" fill="none" stroke="${c.accentSoft}" stroke-width="3"/>` : '')
    + `<circle cx="${mid}" cy="${mid}" r="${r}" fill="${base}"/>`
    + `<path transform="translate(${at} ${at + g}) scale(${g / 960})" d="${iconPath('flame', tone !== 'none')}" fill="${ink}"/>`
    + '</svg>'
}

function Seal({ tone, c, size }: { tone: SealTone; c: Colors; size: number }) {
  return <SvgWidget svg={sealSvg(tone, c, size)} style={{ width: size + 8, height: size + 8 }} />
}

/** This week, the Lord's day first: met days filled with the accent, today ringed, days to come faded. */
function Week({ week, c, dot, letters }: { week: WeekDot[]; c: Colors; dot: number; letters: boolean }) {
  const cell = dot + 8
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      {week.map(d => (
        <FlexWidget key={d.date} style={{ flexDirection: 'column', alignItems: 'center', flexGap: 2 }}>
          <FlexWidget style={{ width: cell, height: cell, borderRadius: cell / 2, alignItems: 'center', justifyContent: 'center', ...(d.today ? { borderWidth: 2, borderColor: hex(c.accent) } : null) }}>
            <FlexWidget style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: hex(d.met ? c.accent : d.ahead ? mix(c.bg, c.border, 0.45) : c.border) }} />
          </FlexWidget>
          {letters ? (
            <TextWidget text={d.letter} allowFontScaling={false}
              style={{ fontSize: 11, fontWeight: d.today ? 'bold' : 'normal', color: hex(d.today ? c.accent : d.ahead ? mix(c.bg, c.muted, 0.45) : c.muted) }} />
          ) : null}
        </FlexWidget>
      ))}
    </FlexWidget>
  )
}

/** One row (a 4 × 1 strip) below this height; the square layout from it up. */
const COMPACT_BELOW = 100

export function StreakWidget({ card, c, width, height }: { card: StreakCard; c: Colors } & WidgetSize) {
  const root = { ...FILL, backgroundColor: hex(c.bg), borderRadius: radius(height) }
  const compact = height < COMPACT_BELOW

  if (card.kind === 'signed-out') {
    return (
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: card.url }} accessibilityLabel={card.a11y}
        style={{ ...root, flexDirection: compact ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', padding: 12, flexGap: compact ? 12 : 8 }}>
        <Seal tone="none" c={c} size={compact ? Math.max(20, Math.min(32, height - 32)) : 40} />
        <TextWidget text={card.text} maxLines={2} truncate="END" allowFontScaling={false}
          style={{ fontSize: 14, color: hex(c.muted), textAlign: 'center' }} />
      </FlexWidget>
    )
  }

  const count = String(card.current)
  if (compact) {
    const seal = Math.max(20, Math.min(36, height - 32))
    // the week joins from four cells wide
    const wide = width >= 300
    return (
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: card.url }} accessibilityLabel={card.a11y}
        style={{ ...root, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, flexGap: 12 }}>
        <Seal tone={card.tone} c={c} size={seal} />
        <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
          <TextWidget text={tn(card.current, '{n} day', '{n} days', { n: count })} maxLines={1} truncate="END" allowFontScaling={false} style={{ fontSize: 16, fontWeight: 'bold', color: hex(c.text) }} />
          <TextWidget text={card.state} maxLines={1} truncate="END" allowFontScaling={false} style={{ fontSize: 13, color: hex(c.muted) }} />
        </FlexWidget>
        {wide ? <FlexWidget style={{ width: 7 * 18 + 6 * 4 }}><Week week={card.week} c={c} dot={10} letters={false} /></FlexWidget> : null}
      </FlexWidget>
    )
  }

  const pad = height >= 140 && width >= 140 ? 16 : 12
  const room = height - 2 * pad
  const seal = room >= 120 ? 44 : 36
  const head = seal + 8
  const dot = Math.max(6, Math.min(14, Math.floor((width - 2 * pad) / 7) - 10))
  const week = dot + 8
  // top to bottom: the seal and count, the day's state, the week, its letters; each only while there is room for it
  const state = room >= head + 8 + 18 + 8 + week
  const letters = state && room >= head + 8 + 18 + 8 + week + 2 + 14
  return (
    <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: card.url }} accessibilityLabel={card.a11y}
      style={{ ...root, flexDirection: 'column', justifyContent: 'center', padding: pad, flexGap: 8 }}>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 12 }}>
        <Seal tone={card.tone} c={c} size={seal} />
        <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
          <TextWidget text={count} maxLines={1} allowFontScaling={false} style={{ fontSize: seal >= 44 ? 28 : 24, fontWeight: 'bold', color: hex(c.text) }} />
          <TextWidget text={tn(card.current, 'day streak', 'day streak')} maxLines={1} truncate="END" allowFontScaling={false} style={{ fontSize: 13, color: hex(c.muted) }} />
        </FlexWidget>
      </FlexWidget>
      {state ? <TextWidget text={card.state} maxLines={1} truncate="END" allowFontScaling={false} style={{ width: 'match_parent', fontSize: 14, color: hex(card.tone === 'kept' ? c.accent : c.text) }} /> : null}
      <Week week={card.week} c={c} dot={dot} letters={letters} />
    </FlexWidget>
  )
}
