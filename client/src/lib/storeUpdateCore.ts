/**
 * When the app says a newer version is on Google Play (lib/storeUpdate.ts): as soon as Play offers this phone a newer
 * build, never by a pop-up or a notification, and not again for a build the reader has closed the line for.
 */

/** Play's answer (modules/store-update): `staleDays` is how many days this phone has been offered the update. */
export interface StoreInfo { available: boolean; versionCode: number; staleDays?: number | null }

/** The version code to tell the reader of, or null: Play offers a newer build than this one, and the reader has not
 *  closed the line for that build. */
export function noticeFor(info: StoreInfo | null, installed: number, dismissed: number | null): number | null {
  if (!info?.available || !(info.versionCode > installed)) return null
  return info.versionCode === dismissed ? null : info.versionCode
}
