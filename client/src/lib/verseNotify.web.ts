/** The web build has no local notifications to schedule: the same interface as the native module, inert. */
import type { VerseNotifyPref } from './verseNotifyPlan'
export type VerseNotifyConfig = VerseNotifyPref
export function configureVerseNotify(_c: VerseNotifyConfig) {}
export const rescheduleVerseNotify = (): Promise<void> => Promise.resolve()
export const topUpVerseNotify = (): Promise<void> => Promise.resolve()
