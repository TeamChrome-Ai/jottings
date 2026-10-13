import type { ReactNode } from 'react'
import { View } from 'react-native'
/** Web: no gesture-handler root, which keeps the library out of the initial bundle (the paged reader loads it lazily). */
export default function RootGesture({ children }: { children: ReactNode }) { return <View style={{ flex: 1 }}>{children}</View> }
