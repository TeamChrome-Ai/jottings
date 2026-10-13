import { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { BLOB_FADE_MS, BLOB_MS, blobAt } from '../lib/blob'
import type { BlobProps } from './ThemeBlob'

/**
 * Web: the same flight as ThemeBlob.tsx from one requestAnimationFrame loop writing transform and opacity straight to
 * three elements (no Reanimated in the first bundle). User-timing marks bracket it for the pacing check.
 */
export default function ThemeBlob({ plan, bg, border, accent, onCovered, onDone }: BlobProps) {
  const blobRef = useRef<View>(null), coreRef = useRef<View>(null), discRef = useRef<View>(null)
  useEffect(() => {
    const el = (r: { current: View | null }) => r.current as unknown as HTMLElement | null
    const blob = el(blobRef), core = el(coreRef), disc = el(discRef)
    if (!blob || !core || !disc) return
    const s = plan.size, c = plan.cover
    const mark = (n: string) => { try { performance.mark(n) } catch { /* no user timing */ } }
    let raf = 0, start = -1, fadeStart = -1, covered = false
    const frame = (now: number) => {
      if (start < 0) { start = now; mark('blob-start') }
      const t = now - start
      if (!covered) {
        const f = blobAt(plan, Math.min(t, BLOB_MS.spread))
        blob.style.opacity = String(f.blob)
        blob.style.transform = `translate(${(f.x - s / 2).toFixed(2)}px, ${(f.y - s / 2).toFixed(2)}px) rotate(${f.angle.toFixed(4)}rad) scale(${f.along.toFixed(4)}, ${f.across.toFixed(4)})`
        core.style.opacity = String(f.core)
        disc.style.opacity = f.spread > 0 ? '1' : '0'
        disc.style.transform = `scale(${(f.spread / c).toFixed(5)})`
        if (t >= BLOB_MS.spread) {
          covered = true
          mark('blob-covered')
          onCovered()
          // the app redraws in the new theme under the cover; the fade waits for two quick frames in a row (the
          // redraw done) so it runs smooth, and never more than a second
          let last = -1, quick = 0
          const t0 = performance.now()
          const wait = (at: number) => {
            quick = last >= 0 && at - last < 24 ? quick + 1 : 0
            last = at
            raf = quick >= 2 || at - t0 > 1000 ? requestAnimationFrame(frame) : requestAnimationFrame(wait)
          }
          raf = requestAnimationFrame(wait)
          return
        }
      } else {
        if (fadeStart < 0) { fadeStart = now; mark('blob-fade') }
        const k = Math.min(1, (now - fadeStart) / BLOB_FADE_MS)
        disc.style.opacity = String(1 - (1 - (1 - k) ** 3))
        if (k >= 1) { mark('blob-end'); onDone(); return }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // once per blob
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const s = plan.size, c = plan.cover
  // the first paint is already the swatch-sized start, before the loop's first frame
  const f0 = blobAt(plan, 0)
  return (
    <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
      <View ref={discRef} style={{ position: 'absolute', left: plan.to.x - c, top: plan.to.y - c, width: 2 * c, height: 2 * c, borderRadius: c, backgroundColor: bg, opacity: 0, transform: [{ scale: 0 }] }} />
      <View ref={blobRef} style={{ position: 'absolute', left: 0, top: 0, width: s, height: s, borderRadius: s / 2, backgroundColor: bg, borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: f0.x - s / 2 }, { translateY: f0.y - s / 2 }, { scaleX: f0.along }, { scaleY: f0.across }] }}>
        <View ref={coreRef} style={{ width: s * 0.36, height: s * 0.36, borderRadius: s * 0.18, backgroundColor: accent, opacity: f0.core }} />
      </View>
    </View>
  )
}
