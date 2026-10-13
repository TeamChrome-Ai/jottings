import type { ReactNode } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
/** Native: the gesture-handler root the paged reader needs. (RootGesture.web.tsx is a plain View.) */
export default function RootGesture({ children }: { children: ReactNode }) { return <GestureHandlerRootView style={{ flex: 1 }}>{children}</GestureHandlerRootView> }
