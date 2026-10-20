import { peekLang, t } from '@shared/i18n'

export const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60)
  return h ? t('{h}h {m}m', { h, m }) : t('{m}m', { m })
}
/** client/src/i18n's `dateLocale`, for the modules the tests load without React Native: the device's own while the app
 *  is in English, else the app's language. */
export const shownLocale = (): string | undefined => (peekLang() === 'en' ? undefined : peekLang())
/** A date as every list shows one: the day, the month in short and the year, in the device's own order. */
export const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString(shownLocale(), { year: 'numeric', month: 'short', day: 'numeric' }) }
