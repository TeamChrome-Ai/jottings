#!/bin/bash
# Read aloud in the device voice with the app off screen (report #36). The device voice is the phone's speech engine,
# another app's process, so nothing of the app's own plays. 1.3.5 then kept no foreground service while it read, and
# once the app was neither on screen nor the previous app, Android cached it and froze it: the reading stood still
# mid-chapter. This turns the device voice on, reads John 3, sends the app home behind Settings, and fails if Android
# cached or froze the app or the reading stopped moving on.
#   scripts/read-aloud-device-voice-check.sh [apk]   an emulator (Android 14 or later, which freezes cached apps) on adb
set -u
# the app's package and link scheme are the brand's (shared/brand.json)
BRAND=$(dirname "$0")/../shared/brand.json
PKG=$(sed -n 's/.*"androidPackage": *"\([^"]*\)".*/\1/p' "$BRAND" | head -1)
SCHEME=$(sed -n 's/.*"scheme": *"\([^"]*\)".*/\1/p' "$BRAND" | head -1)
ui() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml | sed 's/>/>\n/g'; }
tap() {
  local b
  b=$(ui | grep -E "content-desc=\"$1\"|text=\"$1\"" | grep "${2:-}" | head -1 | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' | grep -o '[0-9]*' | tr '\n' ' ')
  set -- $b
  [ -n "${4:-}" ] && adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}
launch() { adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; }
john3() { adb shell am start -W -a android.intent.action.VIEW -d $SCHEME://read/43/3 $PKG >/dev/null; sleep 10; }
verse() { ui | grep -o 'text="John 3:[0-9]*"' | head -1 | sed 's/.*://; s/"//'; }
shown() { for _ in $(seq 1 10); do ui | grep -q "$1" && return 0; sleep 2; done; return 1; }
voiceOn() { ui | grep 'content-desc="Use the device voice"' | grep Switch | grep -q 'checked="true"'; }

if [ -n "${1:-}" ]; then
  adb install -r "$1" | tail -1
  adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
  adb shell cmd locale set-app-locales $PKG --user 0 --locales en-US
fi
adb shell dumpsys package $PKG | grep -m1 -o 'versionName=[^ ]*'
adb shell input keyevent 224
adb shell am force-stop $PKG
launch; sleep 15
tap "Skip the welcome" && sleep 2
john3
tap "Read aloud" || { echo "FAIL: no Read aloud on John 3"; exit 1; }
shown 'content-desc="Listening settings"' || { echo "FAIL: no player bar"; exit 1; }
tap "Listening settings"
shown 'content-desc="Use the device voice"' || { echo "FAIL: no Listening sheet"; exit 1; }
adb shell input swipe 540 2000 540 1000 500; sleep 2
voiceOn || { tap "Use the device voice" Switch; sleep 2; }
voiceOn || { echo "FAIL: could not turn the device voice on"; exit 1; }
adb shell input keyevent 4; sleep 1
tap "Stop reading"; sleep 1
# a clean process: nothing left of the recording's media service
adb shell am force-stop $PKG
launch; sleep 12
john3
tap "Read aloud"
shown 'text="Device voice"' || { echo "FAIL: the device voice is not reading"; exit 1; }
sleep 4

from=$(verse)
adb shell input keyevent 3
adb shell am start -W -a android.settings.SETTINGS >/dev/null; sleep 2
adb shell input keyevent 3
states=""
for _ in $(seq 1 30); do
  sleep 3
  st=$(adb shell dumpsys activity lru | grep " [0-9]*:$PKG/" | awk '{print $2}')
  fz=$(adb shell dumpsys activity processes $PKG | grep -o -m1 'isFrozen=[a-z]*' | cut -d= -f2)
  states="$states $st$([ "$fz" = true ] && echo /frozen)"
done
launch; sleep 4
to=$(verse)
echo "the app off screen, every 3 s:$states"
echo "read on from John 3:$from to John 3:$to"
fail=0
echo "$states" | grep -q cch && { echo "FAIL: Android cached the app while it read"; fail=1; } || echo "ok: never cached"
echo "$states" | grep -q frozen && { echo "FAIL: Android froze the app while it read"; fail=1; } || echo "ok: never frozen"
[ -n "$from" ] && [ -n "$to" ] && [ "$to" -ge $(( from + 5 )) ] && echo "ok: the reading went on off screen" \
  || { echo "FAIL: the reading did not go on off screen"; fail=1; }
tap "Stop reading"
exit $fail
