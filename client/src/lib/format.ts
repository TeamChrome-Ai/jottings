export const fmtDuration = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}
/** A date as every list shows one: the day, the month in short and the year, in the device's own order. */
export const fmtDate = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
