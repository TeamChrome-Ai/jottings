/** Young's Literal Translation as the apps carry it: whole (client/public/bible-ylt/), each chapter its own module. A
 *  build made with BEREAN_WITHOUT_YLT=1 resolves this file to none.ts (client/metro.config.js). */
import map from '../../../public/bible-ylt/map.json'
import meta from '../../../public/bible-ylt/meta.json'
import type { VerseMap } from '@shared/texts'
import type { CarriedText } from './carried'

const ylt: CarriedText | null = { map: map as unknown as VerseMap, v: (meta as { v: string }).v, chapters: require.context('../../../public/bible-ylt', true, /^\.\/\d+\/\d+\.json$/) }
export default ylt
