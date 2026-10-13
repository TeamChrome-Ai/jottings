import { Link } from 'expo-router'
import { Screen, T } from '../src/components/ui'
export default function NotFound() {
  return <Screen><T>Nothing here.</T><Link href="/"><T style={{ textDecorationLine: 'underline' }}>Go home</T></Link></Screen>
}
