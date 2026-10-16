/** A screen's code failed to load the way it does when the page is older than the site: an update replaced the files it
 *  was built with (Metro's AsyncRequireError, "Loading module … failed"). */
export function isStaleBuild(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null
  return !!err && (err.name === 'AsyncRequireError' || /Loading module .+ failed/i.test(err.message ?? ''))
}

const KEY = 'berean_stale_reload'
/** On the web, reloads the page into the site's current version when `e` is a stale page's failed load, unless it
 *  already did so in the last minute (a load that fails for another reason must not loop). True when it reloads. */
export function reloadForNewVersion(e: unknown, now = Date.now()): boolean {
  // the web only: a native app has no document, and its code is all in the bundle
  if (typeof document === 'undefined' || typeof window === 'undefined' || !window.location || !isStaleBuild(e)) return false
  try {
    const last = Number(window.sessionStorage.getItem(KEY) || 0)
    if (now - last < 60_000) return false
    window.sessionStorage.setItem(KEY, String(now))
  } catch { return false }
  window.location.reload()
  return true
}
