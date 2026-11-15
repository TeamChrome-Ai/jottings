/**
 * Whether the on-screen keyboard is up, on the web, where no event says so: the browser keeps the window's height and
 * shrinks only what of it shows (window.visualViewport). Pure; hooks/useKeyboardUp.ts reads the window.
 */

/** The least of a window's height a keyboard takes: less than this is a browser's own bar coming or going. */
export const KEYBOARD_MIN = 150

/** `windowH`: window.innerHeight; `visibleH` and `scale`: the visual viewport's. A pinch zoom shrinks the visible
 *  height too, so the scale is taken out. */
export const keyboardUp = (windowH: number, visibleH: number, scale = 1): boolean => windowH - visibleH * scale >= KEYBOARD_MIN

/**
 * How much of the window's foot the keyboard covers, in px: what a thing pinned to the foot must rise by to stand on
 * the keyboard (Ask's box). 0 while the keyboard is down. `offsetTop`: how far the browser has already moved the page
 * up to show the field (the visual viewport's): that much of the keyboard's height is no longer over the foot.
 */
export const keyboardCover = (windowH: number, visibleH: number, offsetTop = 0, scale = 1): number =>
  keyboardUp(windowH, visibleH, scale) ? Math.max(0, Math.round(windowH - visibleH * scale - offsetTop)) : 0
