import type { StreakInfo } from '@shared/types'

/** The web build has no local notifications to schedule: the same interface as the native module, inert. */
export type NotifyPermission = 'granted' | 'denied' | 'undetermined'
export interface ReminderConfig { enabled: boolean; hour: number; minute: number; signedIn: boolean }
export const REMINDER_ROUTE = '/read'
export function noteStreak(_s: StreakInfo | null | undefined) {}
export function configureReminder(_c: ReminderConfig) {}
export const reminderAllowed = () => false
export const reschedule = (): Promise<void> => Promise.resolve()
export const notifyPermission = (): Promise<NotifyPermission> => Promise.resolve('denied')
export const askNotifyPermission = (): Promise<NotifyPermission> => Promise.resolve('denied')
