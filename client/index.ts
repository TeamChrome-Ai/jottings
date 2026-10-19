// the first chapter on screen starts loading before the app renders (src/lib/earlyChapter.ts)
import './src/lib/earlyChapter'
// expo-router's entry, plus the headless tasks Android may start the app for, which must be registered before it does:
// the widgets' drawing, the background check for friend invites, and the one that keeps read-aloud's timers running
import 'expo-router/entry'
import { registerWidgets } from './src/widgets'
import { defineInviteTask } from './src/lib/inviteTask'
import { registerReadAloudTask } from './src/lib/readAloudClock'
import { noteLaunch } from './src/lib/readAloudLog'

registerWidgets()
defineInviteTask()
registerReadAloudTask()
// a launch in the read-aloud log after a reading that never stopped is how Android closing the app shows
noteLaunch()
