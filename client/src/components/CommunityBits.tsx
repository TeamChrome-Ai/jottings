import { type ReactNode } from 'react'
import { Pressable, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { useRouter } from 'expo-router'
import { useColors } from '../hooks/useTheme'
import { type EventStatus } from '../lib/community'
import { RADIUS, T, Tap, TYPE, useFill } from './ui'
import Icon from './Icon'
import { BRAND } from '@shared/brand'

/**
 * A small flat label on a card (a role, a member count, an event's state): the opposite fill of its surface, no border;
 * `accent` tints it like a chosen chip. Not tappable: choices and links are `Chip` (ui).
 */
export function Tag({ label, accent, style }: { label: string; accent?: boolean; style?: StyleProp<ViewStyle> }) {
  const c = useColors()
  const fill = useFill()
  return (
    <View style={[{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, backgroundColor: accent ? c.accentSoft : fill }, style]}>
      <T small bold style={{ color: accent ? c.accent : c.muted, fontSize: TYPE.caption }}>{label}</T>
    </View>
  )
}

/**
 * By the site admin's name while their Admin mode is on (rs/src/auth.rs admin_mode): "Developer", filled, with the jot
 * mark. Not "Admin": every group has admins of its own, and theirs is the plain Admin tag beside it.
 */
export function AdminBadge({ style }: { style?: StyleProp<ViewStyle> }) {
  const c = useColors()
  return (
    <View accessibilityLabel={`${BRAND.name} developer`} style={[{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingLeft: 6, paddingRight: 8, paddingVertical: 2, borderRadius: 10, backgroundColor: c.accent, alignSelf: 'center' }, style]}>
      <Icon name="jot" size={12} color={c.accentText} />
      <T small bold style={{ color: c.accentText, fontSize: TYPE.caption }}>Developer</T>
    </View>
  )
}

const STATUS_LABEL: Record<EventStatus, string> = { live: 'Live', upcoming: 'Upcoming', ended: 'Ended' }
export function StatusTag({ status }: { status: EventStatus }) {
  return <Tag label={STATUS_LABEL[status]} accent={status === 'live'} />
}

/** Tappable name that opens the public profile. */
export function UserLink({ handle, name, bold, small }: { handle: string; name: string; bold?: boolean; small?: boolean }) {
  const router = useRouter()
  const c = useColors()
  return (
    <Pressable onPress={() => router.push(`/u/${encodeURIComponent(handle)}`)} hitSlop={4} accessibilityRole="link">
      <T bold={bold} small={small} style={{ color: c.accent }}>{name}</T>
    </Pressable>
  )
}

/** Scrollable, padded body for a Sheet (the Sheet itself only caps height). */
export function SheetBody({ children }: { children: ReactNode }) {
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 10 }}>{children}</ScrollView>
}

/** Label + hint above a form control. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <T small bold>{label}{hint ? <T small muted> · {hint}</T> : null}</T>
      {children}
    </View>
  )
}

/**
 * Card-like row that is pressable (the house press scale) and highlights when selected. No button role: it may contain
 * real buttons (admin Edit/Delete).
 */
export function SelectableRow({ selected, onPress, children, style }: { selected?: boolean; onPress?: () => void; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors()
  return (
    <Tap onPress={onPress} scaleTo={0.985} accessibilityState={{ selected: !!selected }}
      style={[{ borderRadius: RADIUS.card, backgroundColor: selected ? c.accentSoft : c.card, padding: 14, gap: 6 }, style]}>
      {children}
    </Tap>
  )
}
