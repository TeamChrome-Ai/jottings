import { useEffect, useState } from 'react'
import type { CbdIndex } from '@shared/cbd'
import { loadDictionaryIndex } from '../lib/dictionary'

/** The dictionary's index: undefined while it loads, null when this build or connection has none. */
export function useDictionaryIndex(): CbdIndex | null | undefined {
  const [index, setIndex] = useState<CbdIndex | null | undefined>(undefined)
  useEffect(() => { let on = true; void loadDictionaryIndex().then(i => { if (on) setIndex(i) }); return () => { on = false } }, [])
  return index
}
