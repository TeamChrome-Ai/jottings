import { useWindowDimensions } from 'react-native'
import { isDesktop } from '../lib/layout'

/** True from DESKTOP_MIN (1024 px) up: the rail, the reader's book pane and dialog sheets. Re-renders on resize. */
export function useDesktop(): boolean {
  return isDesktop(useWindowDimensions().width)
}
