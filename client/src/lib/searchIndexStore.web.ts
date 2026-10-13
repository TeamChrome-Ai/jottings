/** Web: the index is rebuilt per page load (V8 builds it in well under a second); nothing is stored. */
export async function loadIndexBytes(_key: string): Promise<Uint8Array | null> { return null }
export function saveIndexBytes(_key: string, _bytes: Uint8Array): void {}
