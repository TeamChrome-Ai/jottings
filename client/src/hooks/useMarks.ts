import { useEffect, useSyncExternalStore } from 'react'
import { loadMarks, onMarksChange, peekMarks, type MarksView } from '../lib/readMarks'
import { useAuth } from '../store/auth'

/** The reader's own "read" marks, live (lib/readMarks.ts): the account's when signed in, this device's when not. */
export function useMarks(): MarksView {
  const { user, ready } = useAuth()
  const uid = user?.id
  const v = useSyncExternalStore(onMarksChange, peekMarks, peekMarks)
  // a session still being restored is not "signed out": the account's marks kept here would be dropped for a moment
  useEffect(() => { if (ready) void loadMarks(uid) }, [ready, uid])
  return v
}
