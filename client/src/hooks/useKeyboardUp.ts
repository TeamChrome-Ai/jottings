import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'
import { keyboardUp } from '../lib/keyboard'

/**
 * True while the on-screen keyboard is up: the keyboard's own events on the phone, the visual viewport on the web
 * (lib/keyboard.ts). For what is pinned to the bottom of a screen and must not be found sitting on the keyboard.
 */
export function useKeyboardUp(): boolean {
  const [up, setUp] = useState(() => Platform.OS !== 'web' && Keyboard.isVisible())
  useEffect(() => {
    if (Platform.OS !== 'web') {
      const shown = Keyboard.addListener('keyboardDidShow', () => setUp(true))
      const hidden = Keyboard.addListener('keyboardDidHide', () => setUp(false))
      return () => { shown.remove(); hidden.remove() }
    }
    const view = typeof window === 'undefined' ? null : window.visualViewport
    if (!view) return
    const read = () => setUp(keyboardUp(window.innerHeight, view.height, view.scale))
    read()
    view.addEventListener('resize', read)
    return () => view.removeEventListener('resize', read)
  }, [])
  return up
}
