import { Animated, Platform } from 'react-native'
import { motionSpeed, scaleMs, scaleSpringConfig, scaleTimingConfig, tempoSpeed } from '../../lib/motionSpeed'

/**
 * Animation speed for everything built on core Animated, in one place: timing, spring, delay and stagger read the
 * speed as each animation is created (lib/motionSpeed.ts), so a new setting applies from the next motion on: the house
 * tempo times the reader's Animation speed, or `tempo` times it when a config names its own (the chapter turns, the
 * theme ring, the tab crossfade, the tour). A config with `fixedSpeed: true` keeps its own timing (the welcome). Installed once, by the root layout's
 * import; Animated's exports are a plain object on both react-native and react-native-web.
 */
type Config = Record<string, unknown> & { fixedSpeed?: boolean; tempo?: number }
type Orig = { timing: typeof Animated.timing; spring: typeof Animated.spring; delay: typeof Animated.delay; stagger: typeof Animated.stagger }
const A = Animated as unknown as Record<string, unknown> & { __unscaled?: Orig }

// the originals, kept on Animated itself so a second evaluation of this module (a reload) never wraps twice
const first = !A.__unscaled
if (first) A.__unscaled = { timing: Animated.timing, spring: Animated.spring, delay: Animated.delay, stagger: Animated.stagger }
const { timing, spring, delay, stagger } = A.__unscaled!
if (first) {
  // react-native-web has no native driver: it runs every animation in JS either way, and warns when asked for one
  const web = Platform.OS === 'web'
  const strip = ({ fixedSpeed, tempo, ...c }: Config) => ({ fixed: !!fixedSpeed, s: typeof tempo === 'number' ? tempoSpeed(tempo) : motionSpeed(), c: web && c.useNativeDriver ? { ...c, useNativeDriver: false } : c })
  A.timing = (v: Animated.Value, cfg: Config) => { const { fixed, s, c } = strip(cfg); return timing(v, (fixed ? c : scaleTimingConfig(c, s)) as unknown as Animated.TimingAnimationConfig) }
  A.spring = (v: Animated.Value, cfg: Config) => { const { fixed, s, c } = strip(cfg); return spring(v, (fixed ? c : scaleSpringConfig(c, s)) as unknown as Animated.SpringAnimationConfig) }
  A.delay = (ms: number) => delay(scaleMs(ms))
  A.stagger = (ms: number, anims: Animated.CompositeAnimation[]) => stagger(scaleMs(ms), anims)
}

/** A timing or spring config that keeps its authored speed. */
export const fixedSpeed = <T extends object>(cfg: T): T => ({ ...cfg, fixedSpeed: true })
/** A timing or spring config played at its own tempo (times the reader's Animation speed) instead of the house one. */
export const atTempo = <T extends object>(tempo: number, cfg: T): T => ({ ...cfg, tempo })
/** A delay that keeps its authored length. */
export const fixedDelay = (ms: number) => delay(ms)
