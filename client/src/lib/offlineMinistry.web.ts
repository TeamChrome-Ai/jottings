/**
 * The offline ministry store on the web: none. The browser keeps its HTTP cache and the service worker; Settings shows
 * no Offline section, and every loader goes to the server. Same surface as offlineMinistry.ts, every answer empty, so
 * expo-file-system stays out of the web bundle.
 */
import type { AuthorId, CompanionIndex } from '@shared/companion'
import type { Library, MinistrySection, WorkContents } from '@shared/ministry'
import type { OfflineStatus, PackListing, RefsRow, StoredAuthor, StoredWork } from './offlineMinistryCore'

export const offlineSupported = false

export const storedAuthor = async (_author: string): Promise<StoredAuthor | null> => null
export const isStored = async (_author: string) => false
export const storedAuthors = async (): Promise<StoredAuthor[]> => []
export const storedLibrary = async (): Promise<Library | null> => null
export const readWork = async (_author: string, _work: string): Promise<StoredWork | null> => null
export const readContents = async (_author: string, _work: string): Promise<WorkContents | null> => null
export const readSection = async (_author: string, _work: string, _n: number): Promise<MinistrySection | null> => null
export const readWorkRaw = async (_author: string, _work: string): Promise<StoredWork | null> => null
export const readSectionRaw = async (_author: string, _work: string, _n: number): Promise<MinistrySection | null> => null
export const readCompanionIndex = async (_author: AuthorId): Promise<CompanionIndex | null> => null
export const readRefs = async (_author: string, _book: number, _chapter: number): Promise<RefsRow[] | null> => null
export const subscribe = (_l: () => void) => () => {}
export const fetchListing = async (_force = false): Promise<PackListing | null> => null
export const peekListing = (): PackListing | null | undefined => null
export const status = async (_author: string): Promise<OfflineStatus> => ({ kind: 'none' })
export const download = async (_author: string, _onProgress?: (fraction: number) => void) => false
export const cancel = (_author: string) => {}
export const remove = async (_author: string) => {}
