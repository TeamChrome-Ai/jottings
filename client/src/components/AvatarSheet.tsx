import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, ScrollView, View } from 'react-native'
import type { User } from '@shared/types'
import { AVATARS } from '@shared/avatars'
import { get, patch } from '../lib/api'
import { errMsg } from '../lib/community'
import { useAuth } from '../store/auth'
import { useReduceMotion } from '../store/prefs'
import { useColors } from '../hooks/useTheme'
import { SNAP_SPRING } from '../lib/motionTiming'
import AvatarArt from './AvatarArt'
import { Swap } from './motion/community'
import { PopIn } from './motion/nav'
import { Button, ErrorText, Sheet, T, Tap, useSheetArrivalDelay } from './ui'
import { BRAND } from '@shared/brand'

const TILE = 60

/**
 * Your picture: the preset avatars, one tap to choose (saved at once). The chosen tile's ring springs in as the last
 * one's shrinks away, and the large preview swaps on the snap spring. No uploads, no photos.
 */
export default function AvatarSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Your picture" maxHeight="90%">
      {open ? <Body /> : null}
    </Sheet>
  )
}

function Body() {
  const { user, update } = useAuth()
  const arrive = useSheetArrivalDelay()
  const [sel, setSel] = useState(user?.avatar ?? AVATARS[0].id)
  const [err, setErr] = useState<string | null>(null)
  if (!user) return null
  const name = AVATARS.find(a => a.id === sel)?.name ?? ''
  const choose = async (id: string | null) => {
    const was = sel
    setErr(null)
    if (id) setSel(id)
    try {
      await patch('/me', { avatar: id })
      const me = await get<{ user: User }>('/me')
      update(me.user); setSel(me.user.avatar ?? was)
    } catch (e) { setSel(was); setErr(errMsg(e)) }
  }
  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8, gap: 14 }}>
      <View style={{ alignItems: 'center', gap: 6 }}>
        <Swap k={sel}><AvatarArt id={sel} size={96} /></Swap>
        <T small muted>{name}</T>
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel="Pictures" style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
        {AVATARS.map((a, i) => (
          <PopIn key={a.id} index={i} cap={AVATARS.length} step={10} base={arrive} from={0.8}>
            <Tile id={a.id} name={a.name} on={a.id === sel} onPress={() => { if (a.id !== sel || !user.avatar_chosen) void choose(a.id) }} />
          </PopIn>
        ))}
      </View>
      {err ? <ErrorText>{err}</ErrorText> : null}
      {/* one slot either way, so the sheet keeps its height when a first choice is made */}
      <View style={{ minHeight: 36, alignItems: 'center', justifyContent: 'center' }}>
        <Swap k={user.avatar_chosen ? 'chosen' : 'given'}>
          {user.avatar_chosen
            ? <Button small title={`Let ${BRAND.name} choose`} onPress={() => { void choose(null) }} />
            : <T small muted>Chosen for you until you pick one</T>}
        </Swap>
      </View>
    </ScrollView>
  )
}

/** One choice: the picture in a ring that springs in when chosen and shrinks away when another is. */
function Tile({ id, name, on, onPress }: { id: string; name: string; on: boolean; onPress: () => void }) {
  const c = useColors()
  const reduce = useReduceMotion()
  const v = useRef(new Animated.Value(on ? 1 : 0)).current
  useEffect(() => {
    if (reduce) { v.setValue(on ? 1 : 0); return }
    const a = Animated.spring(v, { toValue: on ? 1 : 0, ...SNAP_SPRING, useNativeDriver: true })
    a.start()
    return () => a.stop()
  }, [on, reduce, v])
  const ring = useMemo(() => ({ opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }] }), [v])
  return (
    <Tap onPress={onPress} scaleTo={0.9} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={name}
      style={{ width: TILE + 10, height: TILE + 10, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[{ position: 'absolute', width: TILE + 10, height: TILE + 10, borderRadius: (TILE + 10) / 2, borderWidth: 3, borderColor: c.accent }, ring]} />
      <AvatarArt id={id} size={TILE} />
    </Tap>
  )
}
