#!/bin/bash
# Android Auto, as far as an emulator can show it. The emulator's system images carry only a stub of Android Auto, so
# the car here is Google's Media Controller Test app (github.com/googlesamples/android-media-controller), which lists
# the phone's media apps and makes the calls a car makes: browse, play an entry, play from a search, a custom action.
# The app is stopped first each time, as it is when a phone has been in a pocket all morning. Fails unless
#   - the app is listed among the media apps Android Auto supports;
#   - its roots are Continue listening and Bible;
#   - Psalm 23, asked for by its entry of a stopped app, is playing within START_S seconds (5);
#   - one media session shows for the reading, and its service is in the foreground;
#   - the session claims no place in time: no position that runs, no seek on offer;
#   - the phone app, opened while the car's reading goes on, shows the chapter being read on its Read tab;
#   - "John 3" sent as a search plays John 3;
#   - the speed button steps the speed;
#   - Pause pauses;
#   - with the life of Christ as the reader's path, Matthew 2 asked for of a stopped app goes on into Luke 1, the
#     path's next portion, not Matthew 3.
#   scripts/android-auto-check.sh [apk]   an emulator on adb with the test app installed; the apk installed first.
#   The app must be one that reads from a server it can reach (scripts/android-local-build.sh) holding recordings of
#   Psalm 23, John 3, Matthew 2 and Luke 1 (scripts/read-aloud-fixture.mjs). SHOTS=dir keeps a screenshot of each
#   step. It leaves the life of Christ as the reader's path on that emulator.
set -u
BRAND=$(dirname "$0")/../shared/brand.json
PKG=$(sed -n 's/.*"androidPackage": *"\([^"]*\)".*/\1/p' "$BRAND" | head -1)
NAME=$(sed -n 's/.*"name": *"\([^"]*\)".*/\1/p' "$BRAND" | head -1)
SCHEME=$(sed -n 's/.*"scheme": *"\([^"]*\)".*/\1/p' "$BRAND" | head -1)
MCT=com.example.android.mediacontroller
START_S=${START_S:-5}

ui() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml | sed 's/>/>\n/g'; }
centre() { grep -o '\[[0-9]*,[0-9]*\]\[[0-9]*,[0-9]*\]' | head -1 | grep -o '[0-9]*' | tr '\n' ' ' | awk '{ if (NF == 4) print int(($1 + $3) / 2), int(($2 + $4) / 2) }'; }
# tap the first thing whose text is exactly $1
tap() { local at; at=$(ui | grep -E "text=\"$1\"|content-desc=\"$1\"" | centre); [ -n "$at" ] && adb shell input tap $at; }
# tap the $2 button on the row of the list whose text is $1 (the nearest one below the row's top)
tap_in_row() {
  local dump y at
  dump=$(ui)
  y=$(echo "$dump" | grep "text=\"$1\"" | centre | awk '{print $2}')
  [ -n "$y" ] || return 1
  at=$(echo "$dump" | grep "text=\"$2\"" | while read -r line; do echo "$line" | centre; done | awk -v y="$y" '{ d = $2 - y; if (d < 0) d = -d; if (best == "" || d < bestd) { best = $0; bestd = d } } END { print best }')
  [ -n "$at" ] && adb shell input tap $at
}
texts() { ui | grep -o 'text="[^"]*"' | sed 's/^text="//; s/"$//' | grep -v '^$'; }
shot() { [ -n "${SHOTS:-}" ] && { mkdir -p "$SHOTS"; adb exec-out screencap -p > "$SHOTS/$1.png"; }; return 0; }
# the app's own media sessions, one line each: state and description
sessions() { adb shell dumpsys media_session | awk -v pkg="package=$PKG" '$1 == pkg { mine = 1 } mine && /state=PlaybackState/ { s = $0; sub(/.*state=PlaybackState \{state=/, "", s); sub(/,.*/, "", s) } mine && /metadata:/ { d = $0; sub(/.*description=/, "", d); print s " | " d; mine = 0 }'; }
state() { sessions | head -1; }
# wait until the session's line matches $1, up to $2 seconds; prints the seconds it took
until_state() { local t0 t; t0=$(date +%s.%N); for _ in $(seq 1 $(( $2 * 4 ))); do if state | grep -q "$1"; then t=$(date +%s.%N); echo "$t - $t0" | bc; return 0; fi; sleep 0.25; done; return 1; }
# the test app's page for the app: its list, then CONTROL on the app's row
control() {
  adb shell am force-stop $MCT
  adb shell monkey -p $MCT -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  sleep 3
  tap_in_row "$NAME" CONTROL
  sleep 2
}
# on the control page: choose what the field holds ($1: Search, "Media ID"), type $2, press PLAY
play() {
  ui | grep 'class="android.widget.Spinner"' | centre | { read -r x y; adb shell input tap "$x" "$y"; }
  sleep 1; tap "$1"; sleep 1
  ui | grep 'class="android.widget.EditText"' | centre | { read -r x y; adb shell input tap "$x" "$y"; }
  adb shell input keyevent KEYCODE_MOVE_END
  for _ in $(seq 1 24); do adb shell input keyevent 67; done
  adb shell input text "$(echo "$2" | sed 's/ /%s/g')"
  tap PLAY
}
# swipe on through the test app's pages to the one headed $1 (an emulator with no GPU sometimes loses a swipe)
page() { for _ in 1 2 3 4 5 6; do texts | grep -qx "$1" && return 0; adb shell input swipe 900 1200 100 1200 200; sleep 1; done; return 1; }

if [ -n "${1:-}" ]; then
  adb install -r "$1" | tail -1
  adb shell pm grant $PKG android.permission.POST_NOTIFICATIONS
  adb shell cmd locale set-app-locales $PKG --user 0 --locales en-US
fi
adb shell dumpsys package $PKG | grep -m1 -o 'versionName=[^ ]*'
adb shell pm list packages | grep -q "$MCT" || { echo "FAIL: the Media Controller Test app is not installed"; exit 1; }
fail=0
ok() { echo "ok: $1"; }
bad() { echo "FAIL: $1"; fail=1; }

adb shell input keyevent 224
adb shell am force-stop $PKG
adb shell am force-stop $MCT
adb shell monkey -p $MCT -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 4
shot app-list
texts | sed -n '/Auto supported/,$p' | grep -qx "$NAME" && ok "$NAME is among the media apps Android Auto supports" \
  || { bad "$NAME is not among the media apps Android Auto supports"; exit 1; }

adb shell am force-stop $PKG
control
page "App-provided MediaItems"
roots=$(texts | sed -n '/App-provided MediaItems/,$p' | sed 1d | tr '\n' ',')
shot roots
[ "$roots" = "Continue listening,Bible," ] && ok "the roots are Continue listening and Bible" || bad "the roots are \"$roots\""

adb shell am force-stop $PKG
control
play "Media ID" c/19/23
took=$(until_state "PLAYING.*Psalms 23" 20) && ok "Psalm 23 from a stopped app was playing after $took s" || bad "Psalm 23 never played from a stopped app: $(state)"
[ -n "$took" ] && [ "$(echo "$took <= $START_S" | bc)" = 1 ] || bad "it took more than $START_S s"
shot cold-start
n=$(sessions | wc -l)
[ "$n" -eq 1 ] && ok "one media session for the reading" || { bad "$n media sessions for one reading:"; sessions; }
fg=$(adb shell dumpsys activity services $PKG | grep -A40 LibraryService | grep -o 'isForeground=[a-z]*' | head -1)
[ "$fg" = "isForeground=true" ] && ok "the media service is in the foreground" || bad "the media service is not in the foreground ($fg)"

# the session's own line: its position and the actions it offers (256 is ACTION_SEEK_TO)
sleep 3
line=$(adb shell dumpsys media_session | awk -v pkg="package=$PKG" '$1 == pkg { mine = 1 } mine && /state=PlaybackState/ { print; exit }')
position=$(echo "$line" | sed -n 's/.*position=\([0-9]*\).*/\1/p'); actions=$(echo "$line" | sed -n 's/.*, actions=\([0-9]*\), custom.*/\1/p')
[ "$position" = 0 ] && [ -n "$actions" ] && [ $(( actions & 256 )) -eq 0 ] && ok "the session claims no place in time (position 0 after 3 s of reading, no seek on offer)" \
  || bad "the session claims a place in time (position $position, actions $actions)"

# the phone app opened from the launcher while the car's reading goes on: its Read tab is at the chapter being read
adb shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
sleep 10
tap "Skip the welcome" && sleep 3
tap Read
sleep 6
reading=$(state | sed 's/.* | //; s/,.*//')
shot reader
texts | grep -q "^$reading" && ui | grep -q 'content-desc="Pause"' && ok "the reader, opened during the car's reading, shows $reading with its player bar" \
  || bad "the reader, opened during the car's reading of $reading, shows \"$(texts | grep -m1 ' ▾$')\""
# the test app again, from its list: it connects anew
control

play Search "John 3"
until_state "John 3" 15 >/dev/null && ok "\"John 3\" sent as a search plays John 3" || bad "\"John 3\" did not play John 3: $(state)"
shot voice

speed() { adb shell dumpsys media_session | grep -o "mName='[^,]*" | head -1 | sed "s/mName='//"; }
before=$(speed)
page "App-provided Custom Actions"
tap "$before"
sleep 2
after=$(speed)
shot speed
[ -n "$before" ] && [ -n "$after" ] && [ "$before" != "$after" ] && ok "the speed button stepped from \"$before\" to \"$after\"" || bad "the speed button did not step (\"$before\", then \"$after\")"
# back to the speed it began at, so a second run begins where this one did
for _ in 1 2 3 4 5; do tap "$(speed)"; sleep 1; done

adb shell cmd media_session dispatch pause
until_state "PAUSED" 5 >/dev/null && ok "Pause pauses" || bad "Pause did not pause: $(state)"
adb shell cmd media_session dispatch stop

# a reader on a path: the chapter's end goes on into the path's next portion with no screen up
adb shell am start -W -a android.intent.action.VIEW -d $SCHEME://paths $PKG >/dev/null
sleep 6
tap "The life of Christ"
sleep 3
tap Start || tap "Switch to it" || tap Resume || tap "Keep going"
sleep 3
shot path
adb shell am force-stop $PKG
control
play "Media ID" c/40/2/21
until_state "PLAYING.*Matthew 2" 20 >/dev/null || bad "Matthew 2 never played: $(state)"
if until_state "PLAYING.*Luke 1" 90 >/dev/null; then ok "on the life of Christ, Matthew 2 from a stopped app went on into Luke 1"
else bad "on the life of Christ, Matthew 2 did not go on into Luke 1: $(state)"; fi
shot path-next
adb shell cmd media_session dispatch stop
exit $fail
