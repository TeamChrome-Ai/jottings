import { useLocalSearchParams } from 'expo-router'
import OutlineViewScreen from '../../src/components/OutlineViewScreen'

/** Shared-link view: `/o/:code` resolves through `/outlines/shared/:code` (link or public visibility). */
export default function OutlineByCode() {
  const { code } = useLocalSearchParams<{ code: string }>()
  return <OutlineViewScreen code={code} />
}
