import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { loadPosition, type Position } from '../../../src/hooks/usePosition'
import { openingPlace, placeBeingRead } from '../../../src/lib/readAloudPlace'
import { useAuth } from '../../../src/store/auth'
import { playerEngine } from '../../../src/store/player'
import { Screen, Spinner } from '../../../src/components/ui'

/** /read with no reference: the chapter being read aloud when one is (lib/readAloudPlace.ts), else continue where the
 *  reader left off. */
export default function ReadIndex() {
  const router = useRouter()
  const { user, ready } = useAuth()
  const signedIn = !!user
  useEffect(() => {
    const open = (p: Position) => router.replace({ pathname: '/read/[book]/[chapter]', params: { book: String(p.book), chapter: String(p.chapter), v: String(p.verse) } })
    // a reading that is going needs no answer from the server about the place left off
    const reading = placeBeingRead(playerEngine().getState())
    if (reading) { open(reading); return }
    if (!ready) return
    let cancelled = false
    // only a spinner shows until this settles: a slow server hands over to the local copy
    loadPosition(signedIn, { waitMs: 4000 }).then(p => { if (!cancelled) open(openingPlace(p, playerEngine().getState())) })
    return () => { cancelled = true }
  }, [ready, signedIn, router])
  return <Screen safeTop><Spinner /></Screen>
}
