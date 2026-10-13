import { useLayoutEffect, useRef } from 'react'
import { REVEAL_MS, revealAt, revealStops } from '../lib/themeReveal'
import type { RevealProps } from './ThemeReveal'

/**
 * Web: the same reveal as ThemeReveal.tsx from one requestAnimationFrame loop painting the veil into a canvas: the
 * soft-edged hole as a canvas radial gradient of alpha, scaled by the veil's overall thinning, then the old page
 * colour kept inside that alpha (source-in). The canvas carries no opacity, will-change or mask of its own: in Firefox
 * (WebRender) a see-through layer that appears as the bloom starts is drawn in tiles, and its first frames showed the
 * tile edges as a light cross dividing the circle into quarters; a CSS `mask-image` did the same. The first frame is
 * painted before the browser paints. User-timing marks bracket it for the pacing check.
 */
export default function ThemeReveal({ plan, onDone }: RevealProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) { onDone(); return }
    const mark = (n: string) => { try { performance.mark(n) } catch { /* no user timing */ } }
    const dpr = window.devicePixelRatio || 1
    const w = el.clientWidth, h = el.clientHeight
    el.width = Math.max(1, Math.round(w * dpr)); el.height = Math.max(1, Math.round(h * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const draw = (ms: number) => {
      const { r, feather, a } = revealAt(plan, ms)
      const g = ctx.createRadialGradient(plan.x, plan.y, r, plan.x, plan.y, r + feather)
      for (const [k, alpha] of revealStops) g.addColorStop(k, `rgba(0,0,0,${(alpha * a).toFixed(4)})`)
      ctx.globalCompositeOperation = 'copy'
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-in'
      ctx.fillStyle = plan.from; ctx.fillRect(0, 0, w, h)
    }
    draw(0)
    mark('reveal-start')
    let raf = 0, start = -1
    const frame = (now: number) => {
      if (start < 0) start = now
      const ms = (now - start) * plan.speed
      draw(ms)
      if (ms >= REVEAL_MS) { mark('reveal-end'); onDone(); return }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // once per reveal
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <canvas ref={ref} aria-hidden style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
}
