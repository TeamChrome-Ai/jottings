/**
 * Web: nothing for expo-font to load. public/index.html declares Literata as one family (three woff2 faces at
 * /fonts/, real weight and style descriptors, font-display: block), preloads Regular and Bold and starts loading them
 * from the head, so the faces are in before the bundle draws any text. Loaded from here they arrived after first
 * paint and the verse block stood in the browser's serif for a moment. The woff2 files are the TTFs in assets/fonts
 * repacked (fontTools, hinting kept): re-make them when a TTF changes, under a new file name (they are served immutable).
 */
export const APP_FONTS: Record<string, number> = {}
