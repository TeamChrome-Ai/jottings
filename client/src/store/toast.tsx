import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, StyleSheet, Text } from 'react-native'
import { useInks } from '../hooks/useTheme'
import { usePrefsStore } from './prefs'
import { EXIT_MS, RISE_SPRING, POP_SPRING } from '../lib/motion'

interface ToastCtx { show: (message: string, ms?: number, top?: boolean) => void }
const Ctx = createContext<ToastCtx>({ show: () => {} })

/** A toast stays up at least this long before a newer one replaces it, so a burst ("Chapter credited", then a badge) stays readable. */
const MIN_READ = 1100
/** Pending toasts beyond this are dropped oldest-first. */
const MAX_QUEUED = 2

/** `top`: shown under the header instead, for a toast about something at the foot of the screen. */
type Item = { id: number; text: string; ms: number; top: boolean }

/**
 * One toast slot. The first toast rises from the bottom (RISE_SPRING, no lift past its rest); a newer one replaces it in place (the text dips out and back),
 * and the last one fades down and out after its hold time. Under Reduce animation every change is instant.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  // read at call time, so a pref change never re-renders the provider
  const prefs = usePrefsStore()
  const [cur, setCur] = useState<Item | null>(null)
  const enter = useRef(new Animated.Value(0)).current
  const swap = useRef(new Animated.Value(1)).current
  const seq = useRef(0)
  const queue = useRef<Item[]>([])
  const curRef = useRef<Item | null>(null)
  const shownAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaving = useRef<Animated.CompositeAnimation | null>(null)
  const reduced = () => prefs.get().reduceMotion

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  const setShown = (it: Item | null) => { curRef.current = it; setCur(it) }

  // these helpers touch only refs, Animated values and the (stable) prefs store, so the closures captured by the memoized `show` stay valid
  const hold = (it: Item) => {
    shownAt.current = Date.now()
    clear()
    timer.current = setTimeout(() => { timer.current = null; if (queue.current.length) next(); else hide() }, queue.current.length ? MIN_READ : it.ms)
  }

  const hide = () => {
    if (reduced()) { enter.setValue(0); setShown(null); return }
    leaving.current = Animated.timing(enter, { toValue: 0, duration: EXIT_MS, easing: Easing.in(Easing.quad), useNativeDriver: true })
    leaving.current.start(({ finished }) => { leaving.current = null; if (finished) setShown(null) })
  }

  /** Replace the showing toast with the next queued one: dip the content, swap the text, spring it back. */
  const next = () => {
    const it = queue.current.shift()
    if (!it) return
    if (reduced()) { swap.setValue(1); setShown(it); hold(it); return }
    Animated.timing(swap, { toValue: 0, duration: 90, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(() => {
      setShown(it)
      Animated.spring(swap, { toValue: 1, ...POP_SPRING, useNativeDriver: true }).start()
      hold(it)
    })
  }

  const show = useCallback((text: string, ms = 3000, top = false) => {
    const it = { id: ++seq.current, text, ms, top }
    queue.current = [...queue.current.slice(-(MAX_QUEUED - 1)), it]
    if (leaving.current) {
      // the old toast was on its way out: bring the pill back and swap into the new text
      leaving.current.stop(); leaving.current = null
      Animated.spring(enter, { toValue: 1, ...RISE_SPRING, useNativeDriver: true }).start()
    }
    if (!curRef.current) {
      queue.current.shift()
      setShown(it)
      swap.setValue(1)
      if (reduced()) enter.setValue(1)
      else { enter.setValue(0); Animated.spring(enter, { toValue: 1, ...RISE_SPRING, useNativeDriver: true }).start() }
      hold(it)
      return
    }
    clear()
    const wait = Math.max(0, MIN_READ - (Date.now() - shownAt.current))
    timer.current = setTimeout(() => { timer.current = null; next() }, wait)
  }, [])
  useEffect(() => () => clear(), [])

  const value = useMemo(() => ({ show }), [show])
  return (
    <Ctx.Provider value={value}>
      {children}
      {cur && <ToastHost text={cur.text} top={cur.top} enter={enter} swap={swap} />}
    </Ctx.Provider>
  )
}

function ToastHost({ text, top, enter, swap }: { text: string; top: boolean; enter: Animated.Value; swap: Animated.Value }) {
  const c = useInks()
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.host, top ? styles.top : styles.foot, { opacity: enter, transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [top ? -28 : 28, 0] }) }] }]}>
      <Animated.View style={[styles.toast, { backgroundColor: c.text, opacity: swap, transform: [{ scale: swap.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }] }]}>
        <Text style={{ color: c.bg, fontSize: 14 }}>{text}</Text>
      </Animated.View>
    </Animated.View>
  )
}
const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  foot: { bottom: 96 },
  top: { top: 108 },
  toast: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, maxWidth: '86%' },
})
export const useToast = () => useContext(Ctx)
