import { useContext } from 'react'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BottomTabBarHeightContext } from 'expo-router/build/react-navigation/bottom-tabs'

/**
 * The system inset a screen must clear at the bottom itself. Android draws edge to edge, so on phones with the
 * three-button navigation bar the last 48 px of every screen sit under the buttons unless something pads them.
 * Inside the tabs the tab bar already covers the inset, so screens and docked bars there pad nothing.
 */
export function useBottomInset(): number {
  const insets = useSafeAreaInsets()
  const tabBar = useContext(BottomTabBarHeightContext)
  return tabBar !== undefined ? 0 : insets.bottom
}
