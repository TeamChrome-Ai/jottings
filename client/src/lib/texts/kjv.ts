/** The King James Version as the web carries it: its map and version; the chapters are fetched. A build made with
 *  BEREAN_WITHOUT_KJV=1 resolves this file, and kjv.native.ts, to none.ts (client/metro.config.js). */
import map from '../../../public/bible-kjv/map.json'
import meta from '../../../public/bible-kjv/meta.json'
import type { VerseMap } from '@shared/texts'
import type { CarriedText } from './carried'

const kjv: CarriedText | null = { map: map as unknown as VerseMap, v: (meta as { v: string }).v, chapters: null }
export default kjv
