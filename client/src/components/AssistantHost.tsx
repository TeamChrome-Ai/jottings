import { useEffect, useRef } from 'react'
import { router } from 'expo-router'
import { setActionHost } from '../lib/assistant'
import { setHighlight, tintsBefore } from '../lib/highlights'
import { bookmarkIds, bookmarkKey } from '../lib/bookmarks'
import { outlinesHost } from '../lib/assistantOutlinesHost'
import { addBookmark, listBookmarks, removeBookmark } from '../lib/library'
import { localPosition } from '../hooks/usePosition'
import { useAuth } from '../store/auth'
import { usePlayer } from '../store/player'
import { usePrefsStore } from '../store/prefs'

/**
 * What Ask's app tools act on (lib/assistantActions.ts): the settings, the player, the bookmarks, highlights and
 * outlines of whoever is signed in, and the router. Mounted once in the root, so a turn that has opened another screen
 * still finds them.
 */
export default function AssistantHost() {
  const prefs = usePrefsStore()
  const player = usePlayer()
  const { user } = useAuth()
  const now = useRef({ player, uid: user?.id ?? null })
  now.current = { player, uid: user?.id ?? null }
  useEffect(() => {
    setActionHost({
      prefs,
      navigate: href => router.push(href),
      player: {
        start: (book, chapter, verse) => now.current.player.start(book, chapter, verse),
        stop: () => now.current.player.stop(),
        now: () => {
          const p = now.current.player
          return (p.status === 'playing' || p.status === 'paused' || p.status === 'loading') && p.spoken ? { book: p.spoken.book, chapter: p.spoken.chapter, verse: p.spoken.v } : null
        },
      },
      place: localPosition,
      bookmarks: { find: async b => bookmarkIds(await listBookmarks()).get(bookmarkKey(b)) ?? null, add: async b => (await addBookmark(b)).id, remove: removeBookmark },
      highlights: {
        get: ids => tintsBefore(now.current.uid, ids),
        set: (id, colour) => setHighlight(now.current.uid, id, colour),
      },
      jottings: outlinesHost(() => now.current.uid),
    })
    return () => setActionHost(null)
  }, [prefs])
  return null
}
