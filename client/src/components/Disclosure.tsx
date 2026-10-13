import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Animated, Easing, View } from 'react-native'
import { useInks } from '../hooks/useTheme'
import { usePref } from '../store/prefs'
import Icon from './Icon'
import { Reveal } from './motion/reader'
import { T, Tap } from './ui'

/**
 * A row that opens in place to show what it holds: the chevron turns as the rows below slide open (motion/reader
 * Reveal), and back. Starts closed, or already open (`defaultOpen`, no motion) when coming back to it; `onToggle`
 * hears each change.
 */
export default function Disclosure({ label, detail, defaultOpen = false, onToggle, children }: { label: string; detail?: string; defaultOpen?: boolean; onToggle?: (open: boolean) => void; children: ReactNode }) {
  const c = useInks()
  const reduce = usePref('reduceMotion')
  const [open, setOpen] = useState(defaultOpen)
  const [shown, setShown] = useState(defaultOpen)
  if (open && !shown) setShown(true)
  /** Opened by a tap (it slides open), not open on arrival (it is simply there). */
  const tapped = useRef(false)
  const toggle = () => { tapped.current = true; onToggle?.(!open); setOpen(!open) }
  const turn = useRef(new Animated.Value(defaultOpen ? 1 : 0)).current
  useEffect(() => {
    if (reduce) { turn.setValue(open ? 1 : 0); return }
    const a = Animated.timing(turn, { toValue: open ? 1 : 0, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [open, reduce, turn])
  const rotate = useMemo(() => ({ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['90deg', '-90deg'] }) }] }), [turn])
  return (
    <View>
      <Tap onPress={toggle} scaleTo={0.985} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
        <View style={{ flex: 1, gap: 1 }}>
          <T>{label}</T>
          {detail ? <T small muted>{detail}</T> : null}
        </View>
        <Animated.View style={rotate}><Icon name="chevron" size={18} color={c.muted} /></Animated.View>
      </Tap>
      {shown ? <Reveal delay={tapped.current ? 0 : undefined} closing={!open} onExited={() => setShown(false)} reduce={reduce}><View style={{ gap: 14, paddingTop: 4 }}>{children}</View></Reveal> : null}
    </View>
  )
}
