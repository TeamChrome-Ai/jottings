/** The web has no lock-screen controls of ours to put a picture on (lib/mediaArt.ts is the phone's). */
export const mediaArt = (): Promise<string | undefined> => Promise.resolve(undefined)
