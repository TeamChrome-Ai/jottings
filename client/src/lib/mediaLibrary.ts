import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import type { AudioPlayer } from 'expo-audio'

/** What a controller of the media session asks for (a car, the lock screen, a headset), as the service sends it. `seq`
 *  numbers the commands; `Described.ack` says which have been dealt with. */
export interface CarCommand {
  seq: number
  /** `tree`: something is about to browse, so the tree on file must be the app's. `find`: a search wants its results.
   *  `gone`: the car that was connected has left. */
  type: 'play' | 'pause' | 'stop' | 'next' | 'previous' | 'speed' | 'find' | 'tree' | 'gone'
  /** `play`: an entry of the tree. */
  id?: string
  /** `play`: the words of "play John 3" ('' for a bare "play something"). `find`: the search. */
  query?: string
  /** `speed`: the speed asked for; none steps to the next. */
  speed?: number
}
/** The reading as the media session shows it. */
export interface Described {
  /** A reading is in hand; off, the phone shows no notification. */
  on: boolean
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error'
  id?: string
  title?: string
  subtitle?: string
  art?: string
  speed: number
  speedLabel: string
  error?: string
  ack: number
}
interface Native {
  listen(): void
  describe(r: Described): void
  /** What names the tree on file, null for none. */
  catalogueKey(): string | null
  publish(key: string, json: string): void
  /** The entry to continue from, as it was last set. */
  place(): string | null
  setPlace(json: string | null, parent: string): void
  found(query: string, items: string): void
  own(player: AudioPlayer): void
  addListener(event: 'onCommand', fn: (c: CarCommand) => void): { remove(): void }
}

/** Android's media session for read-aloud and the library a car browses (modules/media-library); null elsewhere. */
export const mediaLibrary = Platform.OS === 'android' ? requireOptionalNativeModule<Native>('MediaLibrary') : null
