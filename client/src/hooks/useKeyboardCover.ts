import { useEffect, useState, type RefObject } from 'react'
import { Keyboard, Platform, type View } from 'react-native'
import { keyboardCover } from '../lib/keyboard'

/**
 * How much of `frame`'s foot the on-screen keyboard covers, in px (0 while it is down): what a screen that pins a
 * field to its foot pads itself by, so the field stands on the keyboard (Ask's box). The app draws edge to edge, so
 * Android does not shrink the window for the keyboard (components/ui.tsx `useKeyboardRoom`): on the phone it is the
 * keyboard's top, from its own events, measured against the frame's foot, which is 0 on a system that did shrink the
 * window. On the web it is the visual viewport (lib/keyboard.ts).
 */
export function useKeyboardCover(frame: RefObject<View | null>): number {
  const [cover, setCover] = useState(0)
  useEffect(() => {
    if (Platform.OS !== 'web') {
      const shown = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', e => {
        const top = e.endCoordinates.screenY
        const el = frame.current
        if (!el) { setCover(e.endCoordinates.height); return }
        el.measureInWindow((_x, y, _w, h) => setCover(Math.max(0, Math.round(y + h - top))))
      })
      const hidden = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setCover(0))
      return () => { shown.remove(); hidden.remove() }
    }
    const view = typeof window === 'undefined' ? null : window.visualViewport
    if (!view) return
    const read = () => setCover(keyboardCover(window.innerHeight, view.height, view.offsetTop, view.scale))
    read()
    view.addEventListener('resize', read)
    view.addEventListener('scroll', read)
    return () => { view.removeEventListener('resize', read); view.removeEventListener('scroll', read) }
  }, [frame])
  return cover
}
