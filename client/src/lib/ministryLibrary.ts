/**
 * The ministry library on every platform (ministryCore.ts has the order things are asked for): held in memory only,
 * nothing written to the device, unless the reader has downloaded an author under Settings → Offline (native,
 * offlineMinistry.ts), whose works are then read from the phone first. The web keeps its HTTP cache and service worker.
 */
import { createMinistryLoaders } from './ministryCore'
import { offlineSupported, readContents, readSection, storedLibrary } from './offlineMinistry'
import { companionUnavailable } from './companion'
import { authorShown, onEditionChange } from './editionCore'
import { N_, t } from '@shared/i18n'

const loaders = createMinistryLoaders({ library: storedLibrary, contents: readContents, section: readSection }, id => authorShown(id))
export const { loadLibrary, peekLibrary, loadContents, peekContents, loadSection, peekSection, searchSections } = loaders
// another edition: the list and the searches are asked again (one edition's answers never stand for the other's)
onEditionChange(() => loaders.reset())
/** What to say when a work cannot be had; on the phone, the way to keep it. */
export const libraryUnavailable = offlineSupported ? N_('This needs a connection to the server. Or download the author under Settings → Offline.') : companionUnavailable
/** What to say for an author's work that cannot be had (in the reader's language): one the edition leaves out (a link
 *  kept from before) is said so. */
export const unavailableFor = (author: string) => (authorShown(author) ? t(libraryUnavailable) : t('This is not part of this edition of the app.'))
