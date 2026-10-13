import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, Platform, View, type StyleProp, type ViewStyle } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { keptMoment, type FriendStreak, type SeenStreak } from '@shared/friends'
import type { Friend } from '../../lib/friends'
import { useInks, useInkFill } from '../../hooks/useTheme'
import { useReduceMotion } from '../../store/prefs'
import { COUNT_MS, LIVELY_SPRING } from '../../lib/motionTiming'
import Icon from '../Icon'
import { PulseRing } from '../motion/home'
import { tick } from '../ui'

/** `key` names the kept day a moment is for, so a later kept day plays again. */
export type Moment = { play: boolean; from: number; key: string }

// ---------------- what this device has shown ----------------

const seenKey = (uid: number) => `berean_friend_streaks_seen_${uid}`
let seenMemo: { uid: number; map: Record<string, SeenStreak> } | null = null
async function readSeen(uid: number): Promise<Record<string, SeenStreak>> {
  if (seenMemo?.uid === uid) return seenMemo.map
  let map: Record<string, SeenStreak> = {}
  try { const raw = await AsyncStorage.getItem(seenKey(uid)); if (raw) map = JSON.parse(raw) as Record<string, SeenStreak> } catch { /* unreadable: start afresh */ }
  seenMemo = { uid, map }
  return map
}

/**
 * The kept moment for each streak on screen (a friend's, a group's): it plays the first time this device shows a day
 * kept (on Home, the Friends screen or a group's page, whichever comes first) and the count ticks up from what was
 * shown last. Null until this device's record has been read, so a seal never shows its final state first and then
 * replays. Keys: a friend's user id, or `g<group id>`.
 */
export function useKeptMoments(uid: number | undefined, items: { key: string | number; streak: FriendStreak | null }[] | null): Record<string, Moment> | null {
  const [moments, setMoments] = useState<Record<string, Moment> | null>(null)
  const sig = items ? items.map(f => `${f.key}:${f.streak?.day}:${f.streak?.current}:${f.streak?.kept}`).join('|') : null
  useEffect(() => {
    if (uid == null || !items) return
    let live = true
    readSeen(uid).then(map => {
      if (!live) return
      const out: Record<string, Moment> = {}
      for (const f of items) {
        out[f.key] = { ...keptMoment(map[f.key], f.streak), key: `${f.streak?.day}:${f.streak?.kept}` }
        if (f.streak) map[f.key] = { day: f.streak.day, kept: f.streak.kept, count: f.streak.current }
      }
      setMoments(prev => {
        // a reload of the same figures keeps the answers already given (a moment never replays on refocus)
        if (!prev) return out
        const merged: Record<string, Moment> = {}
        for (const f of items) merged[f.key] = prev[f.key] && !out[f.key].play ? prev[f.key] : out[f.key]
        return merged
      })
      AsyncStorage.setItem(seenKey(uid), JSON.stringify(map)).catch(() => {})
    })
    return () => { live = false }
    // the signature stands for the list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, sig])
  return moments
}
/** A friends list as the moments' items. */
export const friendItems = (fs: Friend[] | null) => fs ? fs.map(f => ({ key: f.id, streak: f.friend_streak })) : null

// ---------------- the count ----------------

/** A whole number easing from `from` to `to` after `delay` (COUNT_MS); at `to` at once under Reduce animation. */
export function useCountFrom(from: number, to: number, delay = 0): string {
  const reduce = useReduceMotion()
  const start = reduce ? to : from
  const v = useRef(new Animated.Value(start)).current
  const [text, setText] = useState(String(Math.round(start)))
  useEffect(() => {
    const id = v.addListener(({ value }) => { const s = String(Math.round(value)); setText(p => (p === s ? p : s)) })
    return () => v.removeListener(id)
  }, [v])
  useEffect(() => {
    if (reduce) { v.stopAnimation(); v.setValue(to); setText(String(to)); return }
    const a = Animated.timing(v, { toValue: to, duration: COUNT_MS, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false })
    a.start()
    return () => a.stop()
    // the delay is for the first count only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, reduce, v])
  return reduce ? String(to) : text
}

// ---------------- the seal ----------------

/**
 * A friend streak's mark, in the badge style: a flame on a medallion. Kept: the accent seal with its soft outer ring;
 * running but not yet kept today: the flame on accent-soft; lapsed: a muted flame on the plain plate. The kept moment
 * (`moment.play`) starts from the running seal: the flame ducks (90 ms) and flares up from its base on the lively
 * spring while the seal fills solid (220 ms), then one ring goes out and a tick lands, all settled by ~450 ms after
 * `delay` (at 1×, before the house tempo). Reduce animation shows the end state.
 */
export function StreakSeal({ fs, size = 44, moment, delay = 0, style }: { fs: FriendStreak | null; size?: number; moment?: Moment | null; delay?: number; style?: StyleProp<ViewStyle> }) {
  const c = useInks()
  const fill = useInkFill()
  const reduce = useReduceMotion()
  const tone = fs?.state ?? 'none'
  const kept = tone === 'kept'
  const play = !!moment?.play && kept && !reduce
  const lit = useRef(new Animated.Value(kept && !play ? 1 : 0)).current
  const flame = useRef(new Animated.Value(1)).current
  const [ring, setRing] = useState<string | null>(null)
  useEffect(() => {
    if (!play) { lit.setValue(kept ? 1 : 0); flame.setValue(1); return }
    // it starts as the running (not yet kept) seal; the flame ducks, then flares up from its base as the seal fills
    lit.setValue(0); flame.setValue(1)
    const a = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(flame, { toValue: 0.72, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(lit, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.spring(flame, { toValue: 1, ...LIVELY_SPRING, useNativeDriver: true }),
      ]),
    ])
    a.start()
    const land = Animated.delay(delay + 200)
    land.start(({ finished }) => { if (finished) { setRing(`${fs?.day}:${fs?.current}`); if (Platform.OS !== 'web') tick() } })
    return () => { a.stop(); land.stop() }
    // plays once per moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, kept, moment?.key])
  const glyph = Math.round(size * 0.56)
  const styles = useMemo(() => ({
    on: { opacity: lit },
    off: { opacity: lit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) },
    // the flame is squeezed wider as it ducks and stretches taller as it flares past 1
    flame: { transformOrigin: '50% 90%', transform: [{ scaleX: flame.interpolate({ inputRange: [0.7, 1, 1.2], outputRange: [1.08, 1, 0.94] }) }, { scaleY: flame }] },
  }), [lit, flame])
  const abs = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', borderRadius: size / 2 } as const
  const base = tone === 'waiting' || tone === 'kept' ? c.accentSoft : fill
  const ink = tone === 'lapsed' ? c.muted : tone === 'none' ? c.border : c.accent
  return (
    <PulseRing trigger={ring} size={size} style={[{ width: size, height: size }, style]}>
      <View style={{ width: size, height: size }}>
        <Animated.View style={[{ position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: size / 2 + 4, borderWidth: 3, borderColor: c.accentSoft }, styles.on]} />
        <View style={[abs, { backgroundColor: base }]} />
        <Animated.View style={[abs, { backgroundColor: c.accent }, styles.on]} />
        <Animated.View style={[abs, styles.flame]}>
          <Animated.View style={[abs, styles.off]}><Icon name="flame" size={glyph} color={ink} fill={tone !== 'none'} /></Animated.View>
          <Animated.View style={[abs, styles.on]}><Icon name="flame" size={glyph} color={c.accentText} fill /></Animated.View>
        </Animated.View>
      </View>
    </PulseRing>
  )
}
