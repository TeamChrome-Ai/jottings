/**
 * The picture the phone shows beside read-aloud's controls (the lock screen, the notification, the media card): the
 * app's mark. The player's service reads its artwork as a plain URL (java.net.URL on Android), which cannot open an
 * image packed inside the app, so the picture is written once into the app's own cache as a real file and that
 * file's path is given. It shows with no connection too. The system may empty the cache: it is checked each launch.
 */
import { File, Paths } from 'expo-file-system'
import { MEDIA_ART_PNG_BASE64 } from './mediaArtData'

/** A new name when the picture changes, so an old file is never mistaken for it. */
const NAME = 'jottings-media-art-2.png'
let art: Promise<string | undefined> | null = null
/** Never rejects and never holds the reading up: no picture is the worst case. */
export function mediaArt(): Promise<string | undefined> {
  art ??= Promise.resolve().then(() => {
    const f = new File(Paths.cache, NAME)
    if (!f.exists || !f.size) f.write(MEDIA_ART_PNG_BASE64, { encoding: 'base64' })
    return f.uri.startsWith('file:') ? f.uri : undefined
  }).catch(() => { art = null; return undefined })
  return art
}
