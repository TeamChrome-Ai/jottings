import type { ReactNode, Ref } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { Button, Card, T } from './ui'

/**
 * The one way a screen asks a signed-out reader to sign in: a soft card, a line or two on what signing in gives here,
 * and Sign in beside it. `children` go under the text (a code that will be waiting, say).
 */
export default function SignInCard({ title, text, children, ref }: { title?: string; text: string; children?: ReactNode; ref?: Ref<View> }) {
  const router = useRouter()
  return (
    // Sign in sits beside the text, or under it where the text would be squeezed below 200 px (a small phone)
    <Card ref={ref} tone="soft" style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14 }}>
      <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 200, gap: 2 }}>
        {title ? <T bold>{title}</T> : null}
        <T small muted>{text}</T>
        {children}
      </View>
      <Button primary small title="Sign in" onPress={() => router.push('/login')} />
    </Card>
  )
}
