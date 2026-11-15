import { isThemeId } from '../theme'
import type { Prefs } from '../store/prefs'
import { readPrefs } from './backupFile'

/** The settings a record may set, as a backup restore takes them: each of the right kind and in range (`readPrefs`),
 *  and a theme this build does not have left out, so the reader's current one stays. Ask's change_settings passes
 *  through here too (assistantActions.ts), so it can set nothing a restore could not. */
export function settingsPatch(v: unknown): Partial<Prefs> | null {
  const p = readPrefs(v)
  if (!p) return null
  const { theme, themeLight, themeDark, ...rest } = p
  const out: Partial<Prefs> = { ...rest }
  if (theme === 'system' || (theme && isThemeId(theme))) out.theme = theme as Prefs['theme']
  if (themeLight && isThemeId(themeLight)) out.themeLight = themeLight
  if (themeDark && isThemeId(themeDark)) out.themeDark = themeDark
  return Object.keys(out).length ? out : null
}
