import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { Easing, cancelAnimation, runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated'
import { CUE_H, PULL_FAR, PULL_GAP, pullDeliberate, pullOpen, pullPx, pullShift, pullTurns, type Edges, type PullDir } from '../lib/edgePull'
import { CueChevron, DRAG_SLOP, EDGE_PULL, FLICK_PX_S, PullCueFace, SCROLL_SLOP, SETTLE_SPRING, TURN_FAR, TURN_MIN_MS, TURN_MS, turnMs } from './motion/reader'
import { useInks } from '../hooks/useTheme'
import { tick } from './ui'
import { usePref } from '../store/prefs'
import { TURN_TEMPO, scaleMs, scaleSpringParams } from '../lib/motionSpeed'

export interface SwipePagerHandle {
  go: (dir: 1 | -1) => void
  /** Where the current page's scroll sits. Native reads it when a touch decides it is a pull: only a touch on a
   *  scroll that is at an end can pull past it. (The web reads `edges()` instead, straight from the DOM.) */
  setEdges: (top: boolean, bottom: boolean) => void
}
/** One page. `index` is its absolute position (chapter order), so a page never moves when it becomes the current one. */
export interface Page { key: string; index: number; node: ReactNode }
export interface SwipePagerProps {
  reduce: boolean; width: number
  page: Page
  /** Mounted offscreen either side of `page`, so a drag reveals them already laid out. */
  prev: Page | null; next: Page | null
  /** The strip has come to rest on a neighbour: make it the current page. It is on screen where it will stay.
   *  `vertical`: it came from an edge pull (the previous chapter was shown from its end). */
  onTurn: (dir: 1 | -1, vertical: boolean) => void
  /** Labels of the cue an edge pull opens: past the bottom (`next`) and past the top (`prev`). */
  /** `inset`: height of a bar docked over the bottom of the page (the read-aloud bar); the next cue sits above it. */
  cue: { next: string; prev: string; inset?: number }
  /** An edge pull began (`active`) or eased back without a turn: the neighbour it would bring in is readied (the
   *  previous chapter scrolled to its end) and put back. */
  onPull: (dir: PullDir, active: boolean) => void
  /** The current page's edges, read by the web when a touch or wheel gesture begins. */
  edges: () => Edges
}

const OUT = Easing.out(Easing.cubic)

/** Native: a strip of three pages on gesture-handler + Reanimated, positioned on the UI thread. (SwipePager.web.tsx
 *  uses core Animated so the web bundle does not carry either library until the paged reader needs them.)
 *  Sideways drags turn chapters on the horizontal axis; a drag that begins at the end of the text and keeps going
 *  stacks the pages vertically instead (`axis` 1) and turns them up or down. */
const SwipePager = forwardRef<SwipePagerHandle, SwipePagerProps>(function SwipePager({ reduce, width, page, prev, next, onTurn, cue, onPull }, ref) {
  const index = page.index
  /** Where the viewport is, in pages; `at` is the page it rests on or is travelling to. */
  const pos = useSharedValue(index)
  const at = useSharedValue(index)
  /** Swipes released while a turn was under way (sliding, or its page not yet the current one), signed: each turns one
   *  more page once the last has landed, so ten quick swipes are ten chapters. */
  const queued = useSharedValue(0)
  /** The swipe in flight began while a turn was under way: it moves nothing, and released far enough it is queued. */
  const late = useSharedValue(false)
  /** 0: pages side by side; 1: stacked for an edge pull, PULL_GAP apart. Only ever switched while `pos` is at rest. */
  const axis = useSharedValue(0)
  const edgeTop = useSharedValue(false), edgeBottom = useSharedValue(false)
  /** When the pull in flight first reached PULL_FAR (0: it has not, or has fallen back short of it). */
  const farAt = useSharedValue(0)
  /** The touch in flight: where it went down, and the pull direction once decided. */
  const sx = useSharedValue(0), sy = useSharedValue(0)
  const vdir = useSharedValue(0)
  const armed = useSharedValue(false)
  const [height, setHeight] = useState(0)
  // Animation speed at the turns' tempo: read here and captured by the gesture worklets, which cannot reach the JS side
  const speed = usePref('motionSpeed') * TURN_TEMPO
  const settle = useMemo(() => scaleSpringParams(SETTLE_SPRING, speed), [speed])
  const latest = useRef({ onTurn, onPull })
  latest.current = { onTurn, onPull }
  const turned = useCallback((dir: 1 | -1, vertical: boolean) => latest.current.onTurn(dir, vertical), [])
  const pulled = useCallback((dir: PullDir, active: boolean) => latest.current.onPull(dir, active), [])
  // a jump that is not a turn (picker, link) has nothing to carry in: the viewport goes straight there
  useLayoutEffect(() => {
    if (at.value === index) return
    at.value = index
    cancelAnimation(pos)
    pos.value = index
    queued.value = 0
  }, [index, at, pos, queued])
  // a new current page: its edges are its own, unknown until the reader says (its effect follows this one); a touch in
  // between must not pull on the last page's
  useLayoutEffect(() => { edgeTop.value = false; edgeBottom.value = false }, [index, edgeTop, edgeBottom])
  const hasNext = !!next, hasPrev = !!prev
  const go = useCallback((dir: 1 | -1) => {
    if (!(dir > 0 ? hasNext : hasPrev) || at.value !== index) return
    const target = index + dir
    at.value = target
    axis.value = 0
    if (reduce) { pos.value = target; turned(dir, false); return }
    pos.value = withTiming(target, { duration: scaleMs(TURN_MS, speed), easing: OUT }, () => { if (at.value === target) runOnJS(turned)(dir, false) })
  }, [hasNext, hasPrev, index, reduce, speed, at, pos, axis, turned])
  // the next queued swipe, once the page the last turn brought in is the current one: called after that render, and
  // by a swipe released after it (a gesture still holding the last page's index sees a turn under way). Taken and
  // started on the UI thread, where the swipes count: a write from here lands a frame late and could drop one
  const drainNow = () => runOnUI((index: number, hasNext: boolean, hasPrev: boolean, reduce: boolean, ms: number) => {
    'worklet'
    const q = queued.value
    if (!q || at.value !== index) return
    const dir: 1 | -1 = q > 0 ? 1 : -1
    if (!(dir > 0 ? hasNext : hasPrev)) { queued.value = 0; return }
    queued.value = q - dir
    const target = index + dir
    at.value = target
    axis.value = 0
    if (reduce) { pos.value = target; runOnJS(turned)(dir, false); return }
    pos.value = withTiming(target, { duration: ms, easing: OUT }, () => { if (at.value === target) runOnJS(turned)(dir, false) })
  })(index, hasNext, hasPrev, reduce, scaleMs(TURN_MIN_MS, speed))
  const drainLatest = useRef(drainNow)
  drainLatest.current = drainNow
  const drain = useCallback(() => drainLatest.current(), [])
  useEffect(drain, [index, drain])
  const setEdges = useCallback((top: boolean, bottom: boolean) => { edgeTop.value = top; edgeBottom.value = bottom }, [edgeTop, edgeBottom])
  useImperativeHandle(ref, () => ({ go, setEdges }), [go, setEdges])
  const pan = useMemo(() => Gesture.Pan()
    .activeOffsetX([-DRAG_SLOP, DRAG_SLOP])
    .failOffsetY([-SCROLL_SLOP, SCROLL_SLOP])
    .onStart(() => { late.value = at.value !== index; if (!late.value) axis.value = 0 })
    .onUpdate(e => {
      // a turn still waiting for its commit: the strip does not hold the page beyond it yet
      if (reduce || late.value || at.value !== index) return
      let x = e.translationX
      if ((x < 0 && !hasNext) || (x > 0 && !hasPrev)) x *= EDGE_PULL
      pos.value = index - x / width
    })
    .onEnd(e => {
      const dir: 1 | -1 = e.translationX < 0 ? 1 : -1
      const far = Math.abs(e.velocityX) > FLICK_PX_S || Math.abs(e.translationX) > width * TURN_FAR
      // a swipe while a turn is under way counts all the same: it turns once that one has landed
      if (late.value || at.value !== index) { if (far) { queued.value += dir; runOnJS(drain)() } return }
      const turn = far && (dir > 0 ? hasNext : hasPrev)
      if (!turn) { pos.value = reduce ? index : withSpring(index, settle); return }
      const target = index + dir
      at.value = target
      if (reduce) { pos.value = target; runOnJS(turned)(dir, false); return }
      // a jump that lands mid-turn stops the slide; that turn is void
      pos.value = withTiming(target, { duration: scaleMs(turnMs(Math.abs(target - pos.value)), speed), easing: OUT }, () => { if (at.value === target) runOnJS(turned)(dir, false) })
    }), [reduce, speed, settle, hasNext, hasPrev, index, width, at, pos, axis, queued, late, turned, drain])
  // The edge pull. Its activation is decided by hand on the UI thread: a touch that went down with the scroll at an
  // end, moving on past that end by PULL_SLOP (less than the scroll view's own slop, so the pull claims the touch
  // and the scroll view never starts a drag of its own). Anything else fails it at once and the scroll is untouched.
  const span = height + PULL_GAP
  const vpan = useMemo(() => Gesture.Pan()
    .manualActivation(true)
    .onTouchesDown((e, m) => {
      const t = e.allTouches[0]
      if (e.allTouches.length !== 1 || !t || at.value !== index || span <= PULL_GAP) { m.fail(); return }
      sx.value = t.absoluteX; sy.value = t.absoluteY
      vdir.value = 0
    })
    .onTouchesMove((e, m) => {
      const t = e.allTouches[0]
      if (!t || vdir.value !== 0) return
      // The edges now, not at touch-down: the finger going down stopped any fling where it was (a fling stopped short
      // of the end is at no end), and the scroll view does not move under the finger inside PULL_SLOP, so this is
      // where the scroll sat when the touch began, only with the last throttled onScroll caught up.
      const d = pullOpen(t.absoluteX - sx.value, t.absoluteY - sy.value, edgeTop.value, edgeBottom.value)
      if (d === null) return
      if (d === 0) { m.fail(); return }
      vdir.value = d
      m.activate()
    })
    .onStart(() => {
      cancelAnimation(pos)
      axis.value = 1
      armed.value = false
      farAt.value = 0
      runOnJS(pulled)(vdir.value as PullDir, true)
    })
    .onUpdate(e => {
      const dir = vdir.value as PullDir
      const open = dir > 0 ? hasNext : hasPrev
      const px = pullPx(e.translationY, dir)
      // reduce: the page still follows the finger (that is the gesture, not an animation); only the release is instant
      pos.value = index + (dir * pullShift(px, open)) / span
      const on = pullTurns(px, open)
      if (!on) farAt.value = 0
      else if (!farAt.value) farAt.value = Date.now()
      if (on !== armed.value) { armed.value = on; if (on) runOnJS(tick)() }
    })
    .onEnd(e => {
      const dir = vdir.value as PullDir
      const open = dir > 0 ? hasNext : hasPrev
      armed.value = false
      // a flick (fast, released at once) eases back however far it went; see pullDeliberate
      const deliberate = pullDeliberate(Math.abs(e.velocityY) / 1000, farAt.value ? Date.now() - farAt.value : 0)
      if (!deliberate || !pullTurns(pullPx(e.translationY, dir), open)) {
        pos.value = reduce ? index : withSpring(index, settle)
        runOnJS(pulled)(dir, false)
        return
      }
      const target = index + dir
      at.value = target
      if (reduce) { pos.value = target; runOnJS(turned)(dir, true); return }
      pos.value = withTiming(target, { duration: scaleMs(turnMs(Math.abs(target - pos.value)), speed), easing: OUT }, () => { if (at.value === target) runOnJS(turned)(dir, true) })
    }), [reduce, speed, settle, hasNext, hasPrev, index, span, at, pos, axis, edgeTop, edgeBottom, farAt, sx, sy, vdir, armed, turned, pulled])
  const gesture = useMemo(() => Gesture.Race(pan, vpan), [pan, vpan])
  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.strip} onLayout={e => setHeight(e.nativeEvent.layout.height)}>
        {[prev, page, next].map(p => p && (
          <Pane key={p.key} index={p.index} current={p === page} pos={pos} axis={axis} width={width} height={height}>
            {p.node}
            {p === page ? <>
              <Cue dir={1} label={cue.next} open={hasNext} index={index} pos={pos} height={height} inset={cue.inset ?? 0} />
              <Cue dir={-1} label={cue.prev} open={hasPrev} index={index} pos={pos} height={height} inset={0} />
            </> : null}
          </Pane>
        ))}
      </View>
    </GestureDetector>
  )
})
export default SwipePager

function Pane({ index, current, pos, axis, width, height, children }: { index: number; current: boolean; pos: SharedValue<number>; axis: SharedValue<number>; width: number; height: number; children: ReactNode }) {
  const style = useAnimatedStyle(() => axis.value
    ? { transform: [{ translateX: 0 }, { translateY: (index - pos.value) * (height + PULL_GAP) }] }
    : { transform: [{ translateX: (index - pos.value) * width }, { translateY: 0 }] }, [index, width, height])
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents={current ? 'auto' : 'none'}
      accessibilityElementsHidden={!current} importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}>
      {children}
    </Animated.View>
  )
}

/** The cue in the gap below (`dir` 1) or above (-1) the current page: grows in with the pull, stays centred in the
 *  part of the gap that is showing, and lights its chevron once a release would turn. */
function Cue({ dir, label, open, index, pos, height, inset }: { dir: PullDir; label: string; open: boolean; index: number; pos: SharedValue<number>; height: number; inset: number }) {
  const c = useInks()
  const far = pullShift(PULL_FAR, open)
  const style = useAnimatedStyle(() => {
    const d = Math.max(0, (pos.value - index) * dir) * (height + PULL_GAP)
    const p = Math.min(1, d / far)
    // centred in the part of the gap showing; once the gap is all showing (the turn's slide) it rides with the page
    return { opacity: p, transform: [{ translateY: dir * Math.max(0, (Math.min(d, PULL_GAP) - CUE_H) / 2) }, { scale: 0.8 + 0.2 * p }] }
  }, [dir, index, height, far])
  const lit = useAnimatedStyle(() => {
    const d = Math.max(0, (pos.value - index) * dir) * (height + PULL_GAP)
    return { opacity: Math.min(1, Math.max(0, (d / far - 0.94) / 0.06)) }
  }, [dir, index, height, far])
  return (
    // a gesture affordance only: screen readers turn chapters with the buttons under the text
    <Animated.View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.cue, dir > 0 ? { top: height - inset } : { top: -CUE_H }, style]}>
      <PullCueFace dir={dir} label={label} open={open} armed={<Animated.View style={[StyleSheet.absoluteFill, lit]}><CueChevron dir={dir} color={c.accent} /></Animated.View>} />
    </Animated.View>
  )
}
const styles = StyleSheet.create({
  strip: { flex: 1, overflow: 'hidden' },
  cue: { position: 'absolute', left: 0, right: 0, height: CUE_H },
})
