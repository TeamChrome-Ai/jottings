/** A Bible this build leaves out (docs/LANGUAGES.md, "Leaving a text out"): client/metro.config.js resolves the
 *  text's own file here, so not a word of it, nor its map, is in the bundle. */
import type { CarriedText } from './carried'
const none: CarriedText | null = null
export default none
