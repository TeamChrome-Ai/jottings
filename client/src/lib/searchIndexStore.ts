/** Native: the built search index in the cache directory, so only the first launch pays for the build. */
import { Directory, File, Paths } from 'expo-file-system'

const PREFIX = 'search-index-'
const fileFor = (key: string) => new File(Paths.cache, `${PREFIX}${key}.bin`)

export async function loadIndexBytes(key: string): Promise<Uint8Array | null> {
  try {
    const f = fileFor(key)
    return f.exists ? await f.bytes() : null
  } catch { return null }
}

/** Replaces any index stored under another key (an older text or app version). */
export function saveIndexBytes(key: string, bytes: Uint8Array): void {
  try {
    for (const f of new Directory(Paths.cache).list()) if (f instanceof File && f.name.startsWith(PREFIX)) f.delete()
    fileFor(key).write(bytes)
  } catch { /* cache full or unavailable: the next launch builds again */ }
}
