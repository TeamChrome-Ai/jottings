import type { StreakInfo } from '@shared/types'

/** Home-screen widgets are Android only (`index.android.tsx`): iOS and the web build get the same interface, inert. */
export function registerWidgets() {}
export function noteWidgetStreak(_s: StreakInfo) {}
export function useWidgets() {}
