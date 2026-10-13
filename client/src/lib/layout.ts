/**
 * The desktop layout's numbers, pure (no react-native) so tests can read them. Below DESKTOP_MIN nothing here
 * applies: phones and portrait tablets keep the bottom tab bar, the bottom sheets and the picker sheet. The reader's
 * 720 px "wide toolbar" (lib/tour.ts TOOLBAR_WIDE) is a separate, lower step and stays as it is.
 */

/** From this window width the tabs stand in a left rail, the reader keeps a book pane and sheets are dialogs. */
export const DESKTOP_MIN = 1024
/** The rail: five tabs, icons over labels, the same 60 × 32 pill as the bottom bar with 10 px either side. */
export const RAIL_W = 80
/** The reader's book-and-chapter pane: five 40 px chapter cells and their 6 px gaps fit one row inside its 12 px padding. */
export const PANE_W = 260
/** A sheet presented as a dialog: no wider than this, centred. */
export const DIALOG_MAX_W = 560
/** How far below its rest a dialog starts its rise (a bottom sheet travels its own height). */
export const DIALOG_RISE = 24

export const isDesktop = (windowWidth: number): boolean => windowWidth >= DESKTOP_MIN

/**
 * The reading column's width before it is measured: the window less the rail and the pane on the desktop, the whole
 * window otherwise. The pager slides its pages by this, so a first paint before onLayout is already right.
 */
export function readerColumnWidth(windowWidth: number, desktop = isDesktop(windowWidth)): number {
  return desktop ? Math.max(0, windowWidth - RAIL_W - PANE_W) : windowWidth
}

/**
 * Where a dialog's panel lands: `DIALOG_MAX_W` wide at most, centred in the window, and never wider than the window
 * less a gutter each side.
 */
export function dialogFrame(windowWidth: number, gutter = 20): { width: number; left: number } {
  const width = Math.max(0, Math.min(DIALOG_MAX_W, windowWidth - gutter * 2))
  return { width, left: Math.round((windowWidth - width) / 2) }
}
