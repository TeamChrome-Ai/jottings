/**
 * The highlighters by name (tests/hlColours.test.ts). A highlight is stored as its name, on the device and on the
 * server, so a name is never renamed or removed, only added. The first four are the ones every reader is offered;
 * the rest are offered when "More highlight colours" is on, and drawn whether it is on or not: a verse coloured on
 * another device, or before the switch was turned off, keeps its colour. Their tints are in theme.ts.
 */
export const HL_CORE = ['yellow', 'green', 'blue', 'pink'] as const
export const HL_EXTRA = ['orange', 'red', 'purple', 'teal', 'sky', 'lime', 'brown', 'grey'] as const
export const HL_ALL = [...HL_CORE, ...HL_EXTRA] as const
export type HlCore = typeof HL_CORE[number]
export type HlExtra = typeof HL_EXTRA[number]
export type HlColor = typeof HL_ALL[number]

export const isHlColor = (name: unknown): name is HlColor => (HL_ALL as readonly unknown[]).includes(name)
/** The tint a stored name is drawn in. A name this build does not have (a newer app wrote it) shows as yellow rather
 *  than as no highlight: the verse was marked, and the reader can still clear or recolour it. */
export const hlKey = (name: string): HlColor => (isHlColor(name) ? name : 'yellow')
/** What the selection bar offers. */
export const hlPicker = (more: boolean): readonly HlColor[] => (more ? HL_ALL : HL_CORE)
