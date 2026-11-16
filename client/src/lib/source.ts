import { BRAND } from '@shared/brand'

/** Where this copy's source is published (shared/brand.json), or null when the brand names nowhere: About then has no
 *  row for it and Credits no entry. */
export const SOURCE_URL: string | null = BRAND.source || null
