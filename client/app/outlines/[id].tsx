import { useLocalSearchParams } from 'expo-router'
import OutlineViewScreen from '../../src/components/OutlineViewScreen'

export default function OutlineById() {
  const { id } = useLocalSearchParams<{ id: string }>()
  return <OutlineViewScreen id={id} />
}
