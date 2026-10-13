import { useEffect, useState } from 'react'
import { AUTHORS, type AuthorId, type CompanionIndex } from '@shared/companion'
import { loadCompanionIndex } from '../lib/companion'
import { useEdition } from '../lib/edition'
import { authorShown } from '../lib/editionCore'

/** Each author's index (works, sections, passages; no text): absent while it loads, null when it cannot be had. */
export type CompanionIndexes = Partial<Record<AuthorId, CompanionIndex | null>>

/** The indexes of the authors the edition shows (editionCore.ts), each as it arrives. */
export function useCompanionIndexes(): CompanionIndexes {
  const edition = useEdition()
  const [indexes, setIndexes] = useState<CompanionIndexes>({})
  useEffect(() => {
    let on = true
    setIndexes(x => Object.fromEntries(Object.entries(x).filter(([a]) => authorShown(a, edition))))
    for (const a of AUTHORS) if (authorShown(a.id, edition)) void loadCompanionIndex(a.id).then(i => { if (on) setIndexes(x => ({ ...x, [a.id]: i })) })
    return () => { on = false }
  }, [edition])
  return indexes
}
