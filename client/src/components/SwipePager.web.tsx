import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, PanResponder, StyleSheet, View, type ViewStyle } from 'react-native'
import type { SwipePagerHandle, SwipePagerProps } from './SwipePager'
import { CUE_H, PULL_FAR, PULL_GAP, WHEEL_GAP_MS, createTouchPull, createWheelPull, pullShift, pullTurns, wheelPx, type PullDir } from '../lib/edgePull'
// the release of a turn (the slide, the snap back) plays at the turns' own tempo; the finger is followed 1:1
import { TURN_TEMPO } from '../lib/motionSpeed'
import { atTempo } from './motion/speed'
import { CueChevron, DRAG_SLOP, EDGE_PULL, FLICK_PX_S, PullCueFace, SCROLL_SLOP, SETTLE_SPRING, TURN_FAR, TURN_MIN_MS, TURN_MS, turnMs } from './motion/reader'
import { useInks } from '../hooks/useTheme'

const OUT = Easing.out(Easing.cubic)

/** Web: the same three-page strip on core Animated (JS driver) + PanResponder, so the initial bundle needs neither
 *  Reanimated nor gesture-handler; the paged reader route pulls them in lazily when opened. The edge pull listens to
 *  the DOM directly (touch and wheel), since the page's own scroll element is the one being pushed past its end. */
const SwipePager = forwardRef<SwipePagerHandle, SwipePagerProps>(function SwipePager({ reduce, width, page, prev, next, onTurn, cue, onPull, edges }, ref) {
  const index = page.index
  /** Where the viewport is, in pages; `at` is the page it rests on or is travelling to. */
  const pos = useRef(new Animated.Value(index)).current
  /** 0: pages side by side; 1: stacked for an edge pull, PULL_GAP apart. Only ever switched while `pos` is at rest. */
  const axis = useRef(new Animated.Value(0)).current
  const at = useRef(index)
  /** Swipes released while a turn was under way, signed: each turns one more page once the last has landed. */
  const queued = useRef(0)
  const shown = useRef(index)
  const [height, setHeight] = useState(0)
  const latest = useRef({ index, hasNext: !!next, hasPrev: !!prev, reduce, width, height, onTurn, onPull, edges })
  latest.current = { index, hasNext: !!next, hasPrev: !!prev, reduce, width, height, onTurn, onPull, edges }
  // idle neighbours are laid out but not painted, and stay out of find-in-page; they show from the first move
  const [moving, setMoving] = useState(false)
  useLayoutEffect(() => {
    if (at.current !== index) { at.current = index; pos.stopAnimation(); pos.setValue(index); shown.current = index; queued.current = 0 }
    setMoving(false)
  }, [index, pos])
  useEffect(() => { const id = pos.addListener(({ value }) => { shown.current = value }); return () => pos.removeListener(id) }, [pos])

  const turn = useCallback((dir: 1 | -1, ms: number, vertical: boolean) => {
    const { index, reduce } = latest.current
    const target = index + dir
    at.current = target
    // a jump that lands mid-turn stops the slide; that turn is void
    const done = () => { if (at.current === target) latest.current.onTurn(dir, vertical) }
    // the swap re-renders the whole reader: let the neighbour, already in place, paint first
    if (reduce) { pos.setValue(target); requestAnimationFrame(() => setTimeout(done, 0)); return }
    Animated.timing(pos, atTempo(TURN_TEMPO, { toValue: target, duration: ms, easing: OUT, useNativeDriver: false })).start(done)
  }, [pos])
  const go = useCallback((dir: 1 | -1) => {
    const { index, hasNext, hasPrev } = latest.current
    if (at.current !== index || !(dir > 0 ? hasNext : hasPrev)) return
    axis.setValue(0)
    setMoving(true)
    turn(dir, TURN_MS, false)
  }, [turn, axis])
  useImperativeHandle(ref, () => ({ go, setEdges: () => {} }), [go])
  /** The next queued swipe, once the page the last turn brought in is the current one. */
  const drain = useCallback(() => {
    const q = queued.current
    const { index, hasNext, hasPrev } = latest.current
    if (!q || at.current !== index) return
    const dir: 1 | -1 = q > 0 ? 1 : -1
    if (!(dir > 0 ? hasNext : hasPrev)) { queued.current = 0; return }
    queued.current = q - dir
    axis.setValue(0)
    setMoving(true)
    turn(dir, TURN_MIN_MS, false)
  }, [turn, axis])
  useEffect(drain, [index, drain])

  // ---- the edge pull: `pull` follows it, `release` turns or eases back ----
  const pulling = useRef<{ dir: PullDir; px: number } | null>(null)
  const pull = useCallback((dir: PullDir, px: number) => {
    const { index, hasNext, hasPrev, height } = latest.current
    if (at.current !== index || height <= 0) return
    if (!pulling.current || pulling.current.dir !== dir) {
      if (pulling.current) latest.current.onPull(pulling.current.dir, false)
      pos.stopAnimation()
      axis.setValue(1)
      latest.current.onPull(dir, true)
    }
    pulling.current = { dir, px }
    // reduce: the page still follows the finger (that is the gesture, not an animation); only the release is instant
    pos.setValue(index + (dir * pullShift(px, dir > 0 ? hasNext : hasPrev)) / (height + PULL_GAP))
  }, [pos, axis])
  /** `deliberate` false: a flick (see pullDeliberate), which eases back however far it went. */
  const release = useCallback((deliberate = true) => {
    const p = pulling.current
    pulling.current = null
    if (!p) return
    const { index, hasNext, hasPrev, reduce } = latest.current
    if (at.current !== index) return
    if (deliberate && pullTurns(p.px, p.dir > 0 ? hasNext : hasPrev)) {
      setMoving(true)
      turn(p.dir, turnMs(Math.abs(index + p.dir - shown.current)), true)
      return
    }
    latest.current.onPull(p.dir, false)
    if (reduce) { pos.setValue(index); return }
    Animated.spring(pos, atTempo(TURN_TEMPO, { toValue: index, ...SETTLE_SPRING, useNativeDriver: false })).start()
  }, [pos, turn])

  const strip = useRef<View>(null)
  useEffect(() => {
    const el = strip.current as unknown as HTMLElement | null
    if (!el?.addEventListener) return
    const touch = createTouchPull()
    const wheel = createWheelPull()
    let wheelTimer: ReturnType<typeof setTimeout> | undefined
    const ready = () => at.current === latest.current.index
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      // a second finger ends a pull in progress: it eases back
      if (e.touches.length !== 1 || !ready()) { if (touch.end(e.timeStamp)) release(false); return }
      // the edges as the finger goes down: a touch that stops a fling short of the end is not a pull
      touch.start(t.clientX, t.clientY, latest.current.edges(), e.timeStamp)
    }
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]
      const s = t && touch.move(t.clientX, t.clientY, e.timeStamp)
      if (!s) return
      if (e.cancelable) e.preventDefault()
      pull(s.dir, s.px)
    }
    const onEnd = (e: TouchEvent) => { const r = touch.end(e.timeStamp); if (r) release(r.deliberate) }
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const s = wheel.feed(wheelPx(e.deltaY, e.deltaMode, el.clientHeight), e.timeStamp, latest.current.edges())
      if (s.kind === 'pass') return
      if (e.cancelable) e.preventDefault()
      if (s.kind === 'swallow') return
      clearTimeout(wheelTimer)
      if (!ready()) return
      pull(s.dir, s.px)
      if (s.kind === 'turn') release()
      else wheelTimer = setTimeout(() => release(), WHEEL_GAP_MS)
    }
    const passive = { passive: true } as const, active = { passive: false } as const
    el.addEventListener('touchstart', onStart, passive)
    el.addEventListener('touchmove', onMove, active)
    el.addEventListener('touchend', onEnd, passive)
    el.addEventListener('touchcancel', onEnd, passive)
    el.addEventListener('wheel', onWheel, active)
    return () => {
      clearTimeout(wheelTimer)
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
      el.removeEventListener('wheel', onWheel)
    }
  }, [pull, release])

  /** The swipe in flight began while a turn was under way (sliding, or its page not yet the current one): it moves
   *  nothing, and released far enough it is queued. */
  const late = useRef(false)
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > DRAG_SLOP && Math.abs(g.dy) < SCROLL_SLOP && !pulling.current,
    onPanResponderGrant: () => {
      late.current = at.current !== latest.current.index
      if (late.current) return
      pos.stopAnimation(); axis.setValue(0); setMoving(true)
    },
    onPanResponderMove: (_, g) => {
      const { index, hasNext, hasPrev, reduce, width } = latest.current
      if (reduce || late.current) return
      let dx = g.dx
      if ((dx < 0 && !hasNext) || (dx > 0 && !hasPrev)) dx *= EDGE_PULL
      pos.setValue(index - dx / width)
    },
    onPanResponderRelease: (_, g) => {
      const { index, hasNext, hasPrev, reduce, width } = latest.current
      const dir: 1 | -1 = g.dx < 0 ? 1 : -1
      const far = Math.abs(g.vx) * 1000 > FLICK_PX_S || Math.abs(g.dx) > width * TURN_FAR
      // a swipe while a turn is under way counts all the same: it turns once that one has landed
      if (late.current) { if (far) { queued.current += dir; drain() } return }
      if (far && (dir > 0 ? hasNext : hasPrev)) { turn(dir, turnMs(Math.abs(index + dir - shown.current)), false); return }
      if (reduce) { pos.setValue(index); setMoving(false); return }
      Animated.spring(pos, atTempo(TURN_TEMPO, { toValue: index, ...SETTLE_SPRING, useNativeDriver: false })).start(({ finished }) => { if (finished) setMoving(false) })
    },
    onPanResponderTerminate: () => {
      if (late.current) return
      Animated.spring(pos, atTempo(TURN_TEMPO, { toValue: latest.current.index, ...SETTLE_SPRING, useNativeDriver: false })).start(({ finished }) => { if (finished) setMoving(false) })
    },
  })).current
  return (
    <View ref={strip} {...pan.panHandlers} style={styles.strip} onLayout={e => setHeight(e.nativeEvent.layout.height)}>
      {[prev, page, next].map(p => p && (
        <Pane key={p.key} index={p.index} current={p === page} painted={moving || p === page} pos={pos} axis={axis} width={width} height={height}>
          {p.node}
          {p === page ? <>
            <Cue dir={1} label={cue.next} open={!!next} index={index} pos={pos} height={height} inset={cue.inset ?? 0} />
            <Cue dir={-1} label={cue.prev} open={!!prev} index={index} pos={pos} height={height} inset={0} />
          </> : null}
        </Pane>
      ))}
    </View>
  )
})
export default SwipePager

function Pane({ index, current, painted, pos, axis, width, height, children }: { index: number; current: boolean; painted: boolean; pos: Animated.Value; axis: Animated.Value; width: number; height: number; children: ReactNode }) {
  // stable style identity: a new one makes Animated rebuild the node, and the reader re-renders on every spoken word
  const style = useMemo(() => {
    const span = height + PULL_GAP
    const x = pos.interpolate({ inputRange: [index - 1, index, index + 1], outputRange: [width, 0, -width], extrapolate: 'extend' })
    const y = pos.interpolate({ inputRange: [index - 1, index, index + 1], outputRange: [span, 0, -span], extrapolate: 'extend' })
    return [StyleSheet.absoluteFill, { transform: [{ translateX: Animated.multiply(x, Animated.subtract(1, axis)) }, { translateY: Animated.multiply(y, axis) }] }, painted ? null : HIDDEN]
  }, [pos, axis, index, width, height, painted])
  return (
    <Animated.View style={style} pointerEvents={current ? 'auto' : 'none'} aria-hidden={!current}>
      {children}
    </Animated.View>
  )
}

/** The cue in the gap below (`dir` 1) or above (-1) the current page: grows in with the pull, stays centred in the
 *  part of the gap that is showing, and lights its chevron once a release would turn. */
function Cue({ dir, label, open, index, pos, height, inset }: { dir: PullDir; label: string; open: boolean; index: number; pos: Animated.Value; height: number ; inset: number }) {
  const c = useInks()
  const { style, lit } = useMemo(() => {
    const span = Math.max(1, height + PULL_GAP), far = pullShift(PULL_FAR, open) / span, cueH = CUE_H / span, gap = PULL_GAP / span
    // pos past the index in the pull's direction, in pages: [index, index + dir * k] as an increasing input range
    const range = (k: number) => dir > 0 ? [index, index + k] : [index - k, index]
    const out = (a: number, b: number) => dir > 0 ? [a, b] : [b, a]
    const p = pos.interpolate({ inputRange: range(far), outputRange: out(0, 1), extrapolate: 'clamp' })
    // centred in the showing part of the gap, (d - CUE_H) / 2; once the gap is all showing (the turn's slide) it rides
    // with the page
    const mid = pos.interpolate({ inputRange: dir > 0 ? [index + cueH, index + gap] : [index - gap, index - cueH], outputRange: out(0, dir * (PULL_GAP - CUE_H) / 2), extrapolate: 'clamp' })
    return {
      style: { opacity: p, transform: [{ translateY: mid }, { scale: p.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] },
      lit: { opacity: p.interpolate({ inputRange: [0.94, 1], outputRange: [0, 1], extrapolate: 'clamp' }) },
    }
  }, [dir, open, index, pos, height])
  return (
    // a gesture affordance only: screen readers turn chapters with the buttons under the text
    <Animated.View pointerEvents="none" aria-hidden style={[styles.cue, dir > 0 ? { top: height - inset } : { top: -CUE_H }, style]}>
      <PullCueFace dir={dir} label={label} open={open} armed={<Animated.View style={[StyleSheet.absoluteFill, lit]}><CueChevron dir={dir} color={c.accent} /></Animated.View>} />
    </Animated.View>
  )
}
const HIDDEN = { visibility: 'hidden' } as unknown as ViewStyle
const styles = StyleSheet.create({
  strip: { flex: 1, overflow: 'hidden' },
  cue: { position: 'absolute', left: 0, right: 0, height: CUE_H },
})
