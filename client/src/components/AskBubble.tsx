import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { t } from '@shared/i18n'
import { askTarget } from '../lib/askDraft'
import { useAssistantOn } from '../lib/assistant'
import { useBottomInset } from '../hooks/useBottomInset'
import { useDesktop } from '../hooks/useDesktop'
import { useKeyboardUp } from '../hooks/useKeyboardUp'
import { useAuth } from '../store/auth'
import { Button, Enter, SPACE, useColumn } from './ui'

/** The bubble's height (a `Button`): the room Search leaves under its last row, so the row scrolls clear of it. */
export const ASK_BUBBLE_H = 44

/**
 * Ask's bubble on Search, while the server has Ask on (as `AskRow` decides): the kit's solid accent pill with Ask's
 * mark, pinned over the foot of the screen at the right edge of the screen's own column (under the Go button, whatever
 * the width and position chosen in Settings), above the tab bar and clear of the system bars. It stays put while the
 * results scroll. A tap opens Ask with the field's words as a draft (lib/askDraft.ts), or sign-in for a reader with no
 * account, and the label says so. `field`: what the search field holds.
 *
 * While the keyboard is up it is not there: nothing pinned to the bottom of this app rides above the keyboard (the tab
 * bar, the docked bars and the toasts stay where they are, under it; only a sheet lifts, with the field it holds), and
 * above the keyboard it would sit on the results being typed for. It comes back, with the house entrance, when the
 * keyboard goes. Reduce animation: it is there or not, with no motion (`Enter`, `Tap`).
 */
export default function AskBubble({ field }: { field: string }) {
  const router = useRouter()
  const on = useAssistantOn()
  const { user } = useAuth()
  const keyboard = useKeyboardUp()
  const insets = useSafeAreaInsets()
  const tabs = useBottomInset()
  const desktop = useDesktop()
  const column = useColumn()
  if (!on || keyboard) return null
  // beside the desktop's rail no tab bar covers the system's bottom inset
  const foot = desktop ? insets.bottom : tabs
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: SPACE.l + foot }}>
      <View pointerEvents="box-none" style={{ ...column, paddingLeft: SPACE.xl + insets.left, paddingRight: SPACE.xl + insets.right, alignItems: 'flex-end' }}>
        <Enter>
          <Button primary lead="info" title={t('Ask')} testID="ask-bubble"
            accessibilityLabel={user ? undefined : `${t('Ask')}. ${t('Needs an account. Sign in to ask')}`}
            onPress={() => router.push(askTarget(!!user, field))} />
        </Enter>
      </View>
    </View>
  )
}
