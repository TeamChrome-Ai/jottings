import { useEffect, useMemo, useRef } from 'react'
import { Animated, Easing, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { encodeQr, finderOrigins, qrPath } from '@shared/qr'
import { t } from '@shared/i18n'
import { useThemeDef } from '../../hooks/useTheme'
import { LIGHT_DEFAULT, THEME_MAP } from '../../theme'
import { useReduceMotion } from '../../store/prefs'
import { POP_SPRING } from '../../lib/motion'

/** Quiet zone, in modules: the standard's four. */
const QUIET = 4

/**
 * Dark on light whatever the theme (scanners read inverted codes badly): a light theme draws in its own ink on its own
 * page; a dark or black theme borrows the default light theme's page and ink. The three finder eyes are rounded and
 * in the accent, still well over the contrast a scanner needs.
 */
function useQrInk() {
  const t = useThemeDef()
  const light = t.dark ? THEME_MAP[LIGHT_DEFAULT] : t
  return { plate: light.bg, ink: light.text, eye: light.accent }
}

/**
 * The invite code. `reveal` (a new key per code) plays the arrival: the modules fade up and settle from 0.96 in
 * 260 ms, then the three eyes pop in turn on the pop spring. `dim` fades the code back while it is expired or waiting.
 */
export function QrCode({ text, size, reveal, dim = false }: { text: string; size: number; reveal: string; dim?: boolean }) {
  const { plate, ink, eye } = useQrInk()
  const reduce = useReduceMotion()
  const m = useMemo(() => encodeQr(text, { ecl: 'M' }), [text])
  const d = useMemo(() => qrPath(m, { skipFinders: true }), [m])
  const span = m.size + 2 * QUIET
  const cell = size / span
  const body = useRef(new Animated.Value(reduce ? 1 : 0)).current
  const eyes = useRef([0, 1, 2].map(() => new Animated.Value(reduce ? 1 : 0))).current
  const fade = useRef(new Animated.Value(dim ? 0.18 : 1)).current
  useEffect(() => {
    if (reduce) { body.setValue(1); eyes.forEach(e => e.setValue(1)); return }
    body.setValue(0); eyes.forEach(e => e.setValue(0))
    const a = Animated.parallel([
      Animated.timing(body, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.stagger(50, eyes.map(e => Animated.sequence([Animated.delay(120), Animated.spring(e, { toValue: 1, ...POP_SPRING, useNativeDriver: true })]))),
    ])
    a.start()
    return () => a.stop()
  }, [reveal, reduce, body, eyes])
  useEffect(() => {
    const a = Animated.timing(fade, { toValue: dim ? 0.18 : 1, duration: reduce ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [dim, reduce, fade])
  const bodyStyle = useMemo(() => ({ opacity: body, transform: [{ scale: body.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }), [body])
  const eyeStyles = useMemo(() => eyes.map(e => ({ opacity: e.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }), transform: [{ scale: e.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }] })), [eyes])
  return (
    <View accessibilityRole="image" accessibilityLabel={t('Your invite code')} style={{ width: size, height: size, borderRadius: 22, backgroundColor: plate, overflow: 'hidden' }}>
      <Animated.View style={{ opacity: fade, width: size, height: size }}>
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: size, height: size }, bodyStyle]}>
          <Svg width={size} height={size} viewBox={`${-QUIET} ${-QUIET} ${span} ${span}`}>
            <Path d={d} fill={ink} />
          </Svg>
        </Animated.View>
        {finderOrigins(m).map(([x, y], i) => (
          <Animated.View key={i} style={[{ position: 'absolute', left: (x + QUIET) * cell, top: (y + QUIET) * cell, width: 7 * cell, height: 7 * cell, alignItems: 'center', justifyContent: 'center' }, eyeStyles[i]]}>
            <View style={{ position: 'absolute', left: 0, top: 0, width: 7 * cell, height: 7 * cell, borderRadius: 2.2 * cell, borderWidth: cell, borderColor: eye }} />
            <View style={{ width: 3 * cell, height: 3 * cell, borderRadius: 1 * cell, backgroundColor: eye }} />
          </Animated.View>
        ))}
      </Animated.View>
    </View>
  )
}
