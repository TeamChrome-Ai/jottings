/**
 * The first scripture on screen starts loading before React does: the chapter a link opens (/read/B/C, /flip/B/C on
 * the web), otherwise today's verse for Home. On the web that request runs while the route's code is still arriving;
 * the reader's own fetchChapter then finds it in flight. It waits for the stored edition (lib/edition.ts; at once on the
 * web), so it is the edition's chapter.
 */
import { Platform } from 'react-native'
import { votdFor } from '@shared/votd'
import { validRef, warmChapter } from './bible'
import { loadEdition } from './edition'

const path = Platform.OS === 'web' && typeof location !== 'undefined' ? location.pathname : '/'
const m = /^\/(?:read|flip)\/(\d+)\/(\d+)/.exec(path)
void loadEdition().then(() => {
  if (m && validRef(+m[1], +m[2])) warmChapter(+m[1], +m[2])
  else if (path === '/') { const r = votdFor(); warmChapter(r.book, r.chapter) }
})
