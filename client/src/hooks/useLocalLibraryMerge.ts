import { useEffect, useState } from 'react'
import { describeMerge, hasLocalLibrary, mergeLocalLibrary, mergedAnything, onLibraryMerged } from '../lib/localLibrary'
import { useAuth } from '../store/auth'
import { useToast } from '../store/toast'
import { NOUN } from '@shared/brand'

/**
 * Whenever a user is signed in and this device still holds bookmarks, highlights or outlines made signed out, they
 * move into the account (once: each record leaves the device as the server takes it). A failed run keeps what is
 * left on the device, usable as before, and the next launch or sign-in tries again.
 */
export function useLocalLibraryMerge() {
  const { user } = useAuth()
  const toast = useToast()
  const uid = user?.id
  useEffect(() => {
    if (uid === undefined) return
    let live = true
    ;(async () => {
      if (!(await hasLocalLibrary())) return
      try {
        const r = await mergeLocalLibrary(uid)
        if (live && mergedAnything(r)) toast.show(`Moved to your account: ${describeMerge(r)}`, 4000)
      } catch {
        if (live) toast.show(`Some bookmarks or ${NOUN.many} are still only on this device; they move to your account when the server is reachable`, 5000)
      }
    })()
    return () => { live = false }
  }, [uid, toast])
}

/** Changes after every merge that moved something: a dependency for effects that list bookmarks, tints or outlines. */
export function useMergeTick(): number {
  const [n, setN] = useState(0)
  useEffect(() => onLibraryMerged(() => setN(k => k + 1)), [])
  return n
}
