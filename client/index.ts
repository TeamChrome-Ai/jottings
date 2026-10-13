// the first chapter on screen starts loading before the app renders (src/lib/earlyChapter.ts)
import './src/lib/earlyChapter'
// expo-router's entry, plus the headless tasks Android may start the app for, which must be registered before it does:
// the widgets' drawing and the background check for friend invites
import 'expo-router/entry'
import { registerWidgets } from './src/widgets'
import { defineInviteTask } from './src/lib/inviteTask'

registerWidgets()
defineInviteTask()
