/** The King James Version as the apps carry it: whole (client/public/bible-kjv/), each chapter its own module. A
 *  build made with BEREAN_WITHOUT_KJV=1 resolves this file to none.ts (client/metro.config.js). */
import map from '../../../public/bible-kjv/map.json'
import meta from '../../../public/bible-kjv/meta.json'
import type { VerseMap } from '@shared/texts'
import type { CarriedText } from './carried'

const kjv: CarriedText | null = { map: map as unknown as VerseMap, v: (meta as { v: string }).v, chapters: require.context('../../../public/bible-kjv', true, /^\.\/\d+\/\d+\.json$/) }
export default kjv
