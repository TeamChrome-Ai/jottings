import type { ComponentProps, Ref } from 'react'
import { Text, type TextStyle } from 'react-native'
import { usePageInks, type InkRole } from '../hooks/useTheme'

/**
 * A Text whose colours are theme roles, read here and nowhere above it: a theme change re-renders this leaf alone
 * (native) or nothing at all (web, where the inks are CSS custom properties). Its children are the caller's elements,
 * so they are not rendered again with it. Long texts (a chapter, a ministry section) put their colours only here, and
 * on the phone take them from their page (InkPage), one subscription for the whole text.
 */
export default function InkText({ ink, bg, line, style, ...rest }: ComponentProps<typeof Text> & { ink?: InkRole; bg?: InkRole; line?: InkRole; ref?: Ref<Text> | ((el: unknown) => (() => void) | void) }) {
  const c = usePageInks()
  const paint: TextStyle = {}
  if (ink) paint.color = c[ink]
  if (bg) paint.backgroundColor = c[bg]
  if (line) paint.textDecorationColor = c[line]
  return <Text {...rest} style={[style, paint]} />
}
