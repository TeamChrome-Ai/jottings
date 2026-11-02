#!/bin/bash
# Read aloud across a chapter's end on an Android emulator (reports #34 and #35). Android 16 QPR2 and later keep a media
# app's playback service in the foreground only while the session its notification names is in use; 1.3.3 dropped that
# session at every chapter's end, the service left the foreground, and the app, off screen, was frozen or closed. This
# reads Psalm 117 into Psalm 118 with the app on screen and fails if Android set the service inactive or it left the
# foreground. The app stays on screen because the 36.1 image's software renderer aborts in the screenshot Android takes
# when an app leaves it; with no GPU the emulator also needs three-button navigation and no lock screen.
#   scripts/read-aloud-service-check.sh [apk]   an emulator (system image 36.1 or later) on adb; the apk installed first
set -u
# the app's package and link scheme are the brand's (shared/brand.json)
BRAND=$(dirname "$0")/../shared/brand.json
PKG=$(sed -n 's/.*"androidPackage": *"\([^"]*\)".*/\1/p' "$BRAND" | head -1)
SCHEME=$(sed -n 's/.*"scheme": *"\([^"]*\)".*/\1/p' "$BRAND" | head -1)
tap() {
  local b
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  b=$(adb shell cat /sdcard/ui.xml | sed 's/>/>\n/g' | grep -E "content-desc=\"$1\"|text=\"$1\"" | head -1 | grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' | grep -o '[0-9]*' | tr '\n' ' ')
  set -- $b
  [ -n "${4:-}" ] && adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
}
service() { adb shell dumpsys activity services $PKG | grep -A40 AudioControlsService | grep -o 'isForeground=[a-z]*' | head -1 | cut -d= -f2; }

if [ -n "${1:-}" ]; then
  adb install -r "$1" | tail -1
  adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
  adb shell cmd locale set-app-locales $PKG --user 0 --locales en-US
fi
adb shell dumpsys package $PKG | grep -m1 -o 'versionName=[^ ]*'
adb shell input keyevent 224
adb shell am force-stop $PKG
adb logcat -c
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 15
tap "Skip the welcome" && sleep 2
adb shell am start -W -a android.intent.action.VIEW -d $SCHEME://read/19/117 $PKG >/dev/null
sleep 12
tap "Read aloud" || { echo "FAIL: no Read aloud on Psalm 117"; exit 1; }

states=""
for _ in $(seq 1 25); do sleep 2; states="$states $(service)"; done
echo "media service in the foreground, every 2 s:$states"
fail=0
adb shell dumpsys media_session | grep -q "description=Psalms 118" && echo "ok: the reading went on into Psalm 118" \
  || { echo "FAIL: the reading did not reach Psalm 118"; fail=1; }
inactive=$(adb logcat -d | grep "setFgsInactiveLocked: pkg=$PKG")
[ -z "$inactive" ] && echo "ok: Android never set the media service inactive" \
  || { echo "FAIL: Android set the media service inactive:"; echo "$inactive" | cut -c1-160; fail=1; }
[ "$(echo $states | tr ' ' '\n' | grep -c '^true$')" -eq 25 ] && echo "ok: the media service stayed in the foreground" \
  || { echo "FAIL: the media service left the foreground"; fail=1; }
exit $fail
