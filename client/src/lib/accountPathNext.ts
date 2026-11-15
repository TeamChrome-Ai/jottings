import { nextPortion, readSetOf, type PathAccount, type PathState, type Portion } from '@shared/paths'
import { shownPathId } from './editionCore'

/** The path and its next portion from the account the background task fetched, the path as the edition shows it
 *  (paths.ts shown). Chapters credited and chapters marked read since the start both count, as they do on the path in
 *  the app. The account's lists are already since the start. */
export function accountPathNext(acc: PathAccount): { path: PathState; next: Portion | null } | null {
  if (!acc.path) return null
  const read = readSetOf(acc.read)
  for (const k of readSetOf(acc.marked ?? [])) read.add(k)
  const path = { ...acc.path, id: shownPathId(acc.path.id) }
  return { path, next: nextPortion(path, read)?.portion ?? null }
}
