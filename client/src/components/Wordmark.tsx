import { PixelRatio, Text, View } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { BRAND } from '@shared/brand'
import { seasonOn, type Season } from '../lib/season'
import { useInks } from '../hooks/useTheme'
import { face } from '../theme'

const NAME = Array.from(BRAND.name)
const AT = BRAND.wordmark?.seasonal
/** The name either side of the letter the seasonal mark stands in for, or null when there is no such letter. */
const AROUND = AT !== undefined && AT >= 0 && AT < NAME.length ? { before: NAME.slice(0, AT).join(''), after: NAME.slice(AT + 1).join('') } : null

/**
 * The name on Home. At Easter its "o" is an egg and at Christmas a bauble (lib/season.ts), on those days by itself:
 * there is no setting. Which letter that is comes from the brand (`wordmark.seasonal`, shared/brand.json); a brand
 * without one keeps its name as plain text all year. The mark stands on the baseline in the accent colour, cut with
 * the page colour, and is sized from the text so it grows with the phone's font size as the letters do. `season` is
 * for a preview or a test.
 */
export default function Wordmark({ size, season }: { size: number; season?: Season | null }) {
  const c = useInks()
  const s = season !== undefined ? season : seasonOn(new Date())
  const letters = { color: c.text, fontSize: size, ...face('serif', { bold: true }) }
  if (!s || !AROUND) return <Text accessibilityRole="header" style={letters}>{BRAND.name}</Text>
  // the box is 20 x 26 and the letter "o" about half an em tall: the egg stands a little taller than the letter, as an
  // egg is, and the bauble's ball is the letter's size with its cap above
  const em = size * PixelRatio.getFontScale(), h = em * (s === 'easter' ? 0.76 : 0.84), w = h * (20 / 26)
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={BRAND.name} style={{ flexDirection: 'row', alignItems: 'baseline' }}>
      {AROUND.before ? <Text style={letters}>{AROUND.before}</Text> : null}
      <View style={{ width: w, height: h, marginHorizontal: em * 0.03 }}>
        <Svg width={w} height={h} viewBox="0 0 20 26">
          {s === 'easter' ? (
            <>
              <Path d="M10 1.5C14.6 1.5 18.5 10 18.5 16.2C18.5 21.3 14.9 24.8 10 24.8C5.1 24.8 1.5 21.3 1.5 16.2C1.5 10 5.4 1.5 10 1.5Z" fill={c.accent} />
              <Path d="M2.6 13.6L5.4 10.9L7.7 13.6L10 10.9L12.3 13.6L14.6 10.9L17.4 13.6" stroke={c.bg} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round" fill="none" />
              <Circle cx={6.6} cy={18.9} r={1.15} fill={c.bg} />
              <Circle cx={10} cy={20.3} r={1.15} fill={c.bg} />
              <Circle cx={13.4} cy={18.9} r={1.15} fill={c.bg} />
            </>
          ) : (
            <>
              <Circle cx={10} cy={3.1} r={1.6} stroke={c.text} strokeWidth={1.1} fill="none" />
              <Rect x={7.6} y={4.6} width={4.8} height={3.2} rx={0.9} fill={c.text} />
              <Circle cx={10} cy={16.2} r={8.6} fill={c.accent} />
              <Path d="M1.8 14.2Q10 18.6 18.2 14.2" stroke={c.bg} strokeWidth={1.6} strokeLinecap="round" fill="none" />
              <Path d="M3 19.4Q10 22.8 17 19.4" stroke={c.bg} strokeWidth={1.1} strokeLinecap="round" fill="none" />
            </>
          )}
        </Svg>
      </View>
      {AROUND.after ? <Text style={letters}>{AROUND.after}</Text> : null}
    </View>
  )
}
