/** What the native and web ministry loaders share: the request paths and the words for a list that cannot be had. */

/** Selected verses as the API reads them: runs compressed, "16", "16-18", "1,3,7-9". */
export function selectionKey(verses: readonly number[]): string {
  const vs = [...new Set(verses)].sort((a, b) => a - b)
  const runs: [number, number][] = []
  for (const v of vs) {
    const last = runs[runs.length - 1]
    if (last && v === last[1] + 1) last[1] = v
    else runs.push([v, v])
  }
  return runs.map(([a, b]) => a === b ? `${a}` : `${a}-${b}`).join(',')
}

export const refsPath = (book: number, chapter: number, verses: readonly number[], author?: string, page = 1) =>
  `/ministry/refs/${book}/${chapter}/${selectionKey(verses)}${author ? `?author=${encodeURIComponent(author)}&page=${page}` : ''}`

/** What to say when a list cannot be had. */
export const ministryUnavailable = 'This needs a connection the first time it is opened; what you have opened stays on this device.'
