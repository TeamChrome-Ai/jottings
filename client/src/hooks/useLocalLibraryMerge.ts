import { useEffect, useRef, useState } from 'react'
import { describeMerge, hasLocalLibrary, isLocalId, mergeLocalLibrary, mergedAnything, moveFreedOutline, onLibraryMerged, type MergeResult } from '../lib/localLibrary'
import { onOutlineFree } from '../lib/outlineEditors'
import { useAuth } from '../store/auth'
import { useToast } from '../store/toast'
import { NOUN } from '@shared/brand'
import { t } from '@shared/i18n'

/**
 * Whenever a user is signed in and this device still holds bookmarks, highlights or outlines made signed out, they
 * move into the account (once: each record leaves the device as the server takes it). A failed run keeps what is
 * left on the device, usable as before, and the next launch or sign-in tries again. An outline that is open in the
 * editor is left on the device until the reader leaves the editor (lib/localLibrary.ts): the move is made then.
 */
export function useLocalLibraryMerge() {
  const { user } = useAuth()
  const toast = useToast()
  const uid = user?.id
  const said = useRef({ moved: (_: MergeResult) => {}, left: () => {} })
  said.current = {
    moved: r => { if (mergedAnything(r)) toast.show(t('Moved to your account: {list}', { list: describeMerge(r) }), 4000) },
    left: () => toast.show(t('Some bookmarks or {many} are still only on this device; they move to your account when the server is reachable', { many: NOUN.many }), 5000),
  }
  const signedIn = useRef(false)
  signedIn.current = uid !== undefined
  // An outline of the device is free (no screen has it, no save of it is on its way): the run at sign-in passed it
  // by, and it is moved now, itself, once. Signed out, there is nowhere to move it: the run at sign-in will. (Asked
  // here so that nothing is queued for a reader who is signed out; asked again when the move's turn comes.)
  useEffect(() => onOutlineFree(id => {
    if (!isLocalId(id) || !signedIn.current) return
    moveFreedOutline(id).then(r => said.current.moved(r), () => said.current.left())
  }), [])
  useEffect(() => {
    if (uid === undefined) return
    let live = true
    ;(async () => {
      if (!(await hasLocalLibrary())) return
      try {
        const r = await mergeLocalLibrary(uid)
        if (live) said.current.moved(r)
      } catch {
        if (live) said.current.left()
      }
    })()
    return () => { live = false }
  }, [uid])
}

/** Changes after every merge that moved something: a dependency for effects that list bookmarks, tints or outlines. */
export function useMergeTick(): number {
  const [n, setN] = useState(0)
  useEffect(() => onLibraryMerged(() => setN(k => k + 1)), [])
  return n
}
