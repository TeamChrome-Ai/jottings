import { Animated, Easing, Platform } from 'react-native'
import { cssTransform, trackAt, trackSpan, type Keys, type Track } from '../../lib/overture'
// the welcome is choreographed to its own clock: Animation speed leaves it be
import { fixedDelay, fixedSpeed } from './speed'

/**
 * Plays keyframe tracks (lib/overture.ts `Track`) in stages, one stage after another.
 *
 * Native: each track gets its own Animated value on the native driver, running only across its own keyframes, so the
 * UI thread does the work and the JS thread is free.
 * Web: core Animated re-renders a component for every frame it moves, which costs ~20 renders a frame when the jots
 * fly. Here one requestAnimationFrame loop samples the moving tracks and writes opacity and transform straight to
 * their elements; React renders each element once, at its starting values.
 */
export interface Bound { style: object; ref?: (el: unknown) => void }
export interface Playback { stop: () => void }
export interface Driver<S extends string> {
  bind: (stage: S, track: Track) => Bound
  /** Runs `stages` in order; `done` fires only if it was not stopped. */
  play: (stages: S[], done?: () => void) => Playback
  /** Puts every track of `stages` at its end at once. */
  finish: (stages: S[]) => void
}

export function makeDriver<S extends string>(lengths: Record<S, number>): Driver<S> {
  return Platform.OS === 'web' ? webDriver(lengths) : nativeDriver(lengths)
}

const at = (v: Animated.Value, k: Keys) => v.interpolate({ inputRange: k.input, outputRange: k.output, extrapolate: 'clamp' })

function nativeDriver<S extends string>(lengths: Record<S, number>): Driver<S> {
  const runs = new Map<S, Animated.CompositeAnimation[]>(), ends = new Map<S, [Animated.Value, number][]>()
  return {
    bind(stage, track) {
      const [t0, t1] = trackSpan(track)
      const v = new Animated.Value(t0)
      if (!runs.has(stage)) { runs.set(stage, []); ends.set(stage, []) }
      runs.get(stage)!.push(Animated.timing(v, fixedSpeed({ toValue: t1, duration: Math.max(1, t1 - t0), delay: t0, easing: Easing.linear, useNativeDriver: true })))
      ends.get(stage)!.push([v, t1])
      const transform = [
        ...(track.x ? [{ translateX: at(v, track.x) }] : []),
        ...(track.y ? [{ translateY: at(v, track.y) }] : []),
        ...(track.scale ? [{ scale: at(v, track.scale) }] : []),
      ]
      return { style: { ...(track.opacity ? { opacity: at(v, track.opacity) } : null), ...(transform.length ? { transform } : null) } }
    },
    play(stages, done) {
      // each stage lasts its full length even when its last track ends sooner
      const a = Animated.sequence(stages.map(s => Animated.parallel([fixedDelay(lengths[s]), ...(runs.get(s) ?? [])])))
      a.start(({ finished }) => { if (finished) done?.() })
      return { stop: () => a.stop() }
    },
    finish(stages) { for (const s of stages) for (const [v, t] of ends.get(s) ?? []) v.setValue(t) },
  }
}

interface Entry { track: Track; t0: number; t1: number; el: HTMLElement | null; ended: boolean }

function webDriver<S extends string>(lengths: Record<S, number>): Driver<S> {
  const entries = new Map<S, Entry[]>()
  const write = (e: Entry, t: number) => {
    if (!e.el) return
    const v = trackAt(e.track, t)
    if (v.opacity !== undefined) e.el.style.opacity = String(+v.opacity.toFixed(4))
    const tf = cssTransform(v)
    if (tf) e.el.style.transform = tf
  }
  // a moving element gets its own compositor layer for as long as it moves, so a frame is a composite, not a repaint
  const settle = (e: Entry) => { e.ended = true; if (e.el) e.el.style.willChange = '' }
  const end = (s: S) => { for (const e of entries.get(s) ?? []) if (!e.ended) { write(e, e.t1); settle(e) } }
  return {
    bind(stage, track) {
      const [t0, t1] = trackSpan(track)
      const e: Entry = { track, t0, t1, el: null, ended: false }
      if (!entries.has(stage)) entries.set(stage, [])
      entries.get(stage)!.push(e)
      // the starting values, rendered once by React; from here on only this driver touches opacity and transform
      const v = trackAt(track, -Infinity)
      const transform = [
        ...(v.x !== undefined ? [{ translateX: v.x }] : []),
        ...(v.y !== undefined ? [{ translateY: v.y }] : []),
        ...(v.scale !== undefined ? [{ scale: v.scale }] : []),
      ]
      return {
        style: { ...(v.opacity !== undefined ? { opacity: v.opacity } : null), ...(transform.length ? { transform } : null) },
        ref: el => { e.el = (el as HTMLElement | null) ?? null },
      }
    },
    play(stages, done) {
      let i = 0, raf = 0, stopped = false, origin = -1
      const frame = (now: number) => {
        if (stopped) return
        if (origin < 0) origin = now
        let t = now - origin
        while (i < stages.length && t >= lengths[stages[i]]) { end(stages[i]); origin += lengths[stages[i]]; t -= lengths[stages[i]]; i++ }
        if (i >= stages.length) { done?.(); return }
        for (const e of entries.get(stages[i]) ?? []) {
          if (e.ended || t < e.t0) continue
          if (t >= e.t1) { write(e, e.t1); settle(e) } else { if (e.el && !e.el.style.willChange) e.el.style.willChange = 'opacity, transform'; write(e, t) }
        }
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
      return { stop: () => { stopped = true; cancelAnimationFrame(raf) } }
    },
    finish(stages) { stages.forEach(end) },
  }
}
