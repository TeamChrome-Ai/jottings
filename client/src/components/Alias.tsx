import { Redirect, useLocalSearchParams, type Href } from 'expo-router'

/**
 * A second address for a screen: the names people type or share (/ministry, /jottings) land on the route the app
 * really has, with the query (and a dynamic segment such as the id) carried over. A replace, so Back never returns here.
 */
export default function Alias({ to }: { to: '/companion' | '/chronology' | '/outlines' | '/outlines/[id]' | '/paths' }) {
  const params = useLocalSearchParams()
  return <Redirect href={{ pathname: to, params } as Href} />
}
