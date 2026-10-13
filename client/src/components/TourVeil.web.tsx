import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { easeOut, glideMs, lerpHole, veilPath, type Hole } from '../lib/tour'

/**
 * Web: the same veil and glide as TourVeil.tsx without Reanimated in the first bundle. One requestAnimationFrame loop
 * writes the path's `d` straight to the element; React renders it once per spotlight, at the glide's start.
 */
export default function TourVeil({ hole, W, H, color, reduce }: { hole: Hole; W: number; H: number; color: string; reduce: boolean }) {
  const box = useRef<View>(null)
  const shown = useRef<Hole>(hole)
  const first = useRef(veilPath(W, H, hole))
  useEffect(() => {
    const path = (box.current as unknown as HTMLElement | null)?.querySelector('path')
    if (!path) return
    const from = shown.current, ms = glideMs(from, hole, { x: 0, y: 0, w: W, h: H })
    const put = (h: Hole) => { shown.current = h; path.setAttribute('d', veilPath(W, H, h)) }
    if (reduce) { put(hole); return }
    let raf = 0, start = -1
    // user-timing marks bracket each glide, so frame pacing can be read for the glides alone (scripts/tour-check.mjs)
    const mark = (n: string) => { try { performance.mark(n) } catch { /* no user timing */ } }
    const frame = (now: number) => {
      if (start < 0) { start = now; mark('tour-glide-start') }
      const t = Math.min(1, (now - start) / ms)
      put(lerpHole(from, hole, easeOut(t)))
      if (t < 1) raf = requestAnimationFrame(frame)
      else mark('tour-glide-end')
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [hole, reduce, W, H])
  return (
    <View ref={box} style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <Svg width={W} height={H}><Path d={first.current} fill={color} fillRule="evenodd" /></Svg>
    </View>
  )
}
