import { nextPortion, readSetOf, type PathAccount, type PathState, type Portion } from '@shared/paths'

/** The path and its next portion from the account the background task fetched. Chapters credited and chapters marked
 *  read since the start both count, as they do on the path in the app. The account's lists are already since the start. */
export function accountPathNext(acc: PathAccount): { path: PathState; next: Portion | null } | null {
  if (!acc.path) return null
  const read = readSetOf(acc.read)
  for (const k of readSetOf(acc.marked ?? [])) read.add(k)
  return { path: acc.path, next: nextPortion(acc.path, read)?.portion ?? null }
}
