import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { loadPosition } from '../../../src/hooks/usePosition'
import { useAuth } from '../../../src/store/auth'
import { Screen, Spinner } from '../../../src/components/ui'

/** /read with no reference: continue where the reader left off. */
export default function ReadIndex() {
  const router = useRouter()
  const { user, ready } = useAuth()
  const signedIn = !!user
  useEffect(() => {
    if (!ready) return
    let cancelled = false
    // only a spinner shows until this settles: a slow server hands over to the local copy
    loadPosition(signedIn, { waitMs: 4000 }).then(p => { if (!cancelled) router.replace({ pathname: '/read/[book]/[chapter]', params: { book: String(p.book), chapter: String(p.chapter), v: String(p.verse) } }) })
    return () => { cancelled = true }
  }, [ready, signedIn, router])
  return <Screen safeTop><Spinner /></Screen>
}
