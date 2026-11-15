// the first chapter on screen starts loading before the app renders (src/lib/earlyChapter.ts)
import './src/lib/earlyChapter'
// expo-router's entry, plus the headless tasks Android may start the app for, which must be registered before it does:
// the widgets' drawing, the background check for friend invites, and the one that keeps read-aloud's timers running.
// A car may start the app too, to browse it and to have a chapter read with no screen: read-aloud listens for it here
import 'expo-router/entry'
import { registerWidgets } from './src/widgets'
import { defineInviteTask } from './src/lib/inviteTask'
import { registerReadAloudTask } from './src/lib/readAloudClock'
import { noteLaunch } from './src/lib/readAloudLog'
import { registerCar } from './src/lib/car'

registerWidgets()
defineInviteTask()
registerReadAloudTask()
registerCar()
// a launch in the read-aloud log after a reading that never stopped is how Android closing the app shows
noteLaunch()
