/** Young's Literal Translation as the web carries it: its map and version; the chapters are fetched. A build made
 *  with BEREAN_WITHOUT_YLT=1 resolves this file, and ylt.native.ts, to none.ts (client/metro.config.js). */
import map from '../../../public/bible-ylt/map.json'
import meta from '../../../public/bible-ylt/meta.json'
import type { VerseMap } from '@shared/texts'
import type { CarriedText } from './carried'

const ylt: CarriedText | null = { map: map as unknown as VerseMap, v: (meta as { v: string }).v, chapters: null }
export default ylt
