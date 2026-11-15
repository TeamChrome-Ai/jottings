#!/bin/bash
# A debug APK for the emulator checks (scripts/read-aloud-service-check.sh, scripts/android-auto-check.sh) that talks
# to a server on the emulator's host and to nothing else: no signing key, no production server. It differs from a
# release build in three places, all in this copy of the tree and none of them committed:
#   - the app's server is http://10.0.2.2:8787 (the emulator's name for its host), where `PORT=8787 berean` runs with
#     stand-in recordings (scripts/read-aloud-fixture.mjs);
#   - plain http to that address is allowed (the release allows none);
#   - the debug build carries its JavaScript inside it, compiled as the release's is, so it runs with no Metro.
# It is built for the emulator's processor alone (ABIS=x86_64), a quarter of the native build and of the APK.
# Run in a copy of the tree that is not a git checkout you care about (it edits shared/brand.json):
#   scripts/android-local-build.sh        needs node on PATH and ANDROID_HOME; leaves client/android/app/build/outputs/apk/debug/app-debug.apk
set -euo pipefail
cd "$(dirname "$0")/.."
HOST_URL=${HOST_URL:-http://10.0.2.2:8787}
HOST_NAME=$(echo "$HOST_URL" | sed -E 's#^https?://([^:/]+).*#\1#')

sed -i -E "s#(\"site\": *)\"[^\"]*\"#\1\"$HOST_URL\"#" shared/brand.json
grep -q "\"site\": \"$HOST_URL\"" shared/brand.json || { echo "could not point the app at $HOST_URL"; exit 1; }

[ -d node_modules ] && [ -d client/node_modules ] || npm ci --no-audit --no-fund
cd client
npm run prebuild:android

XML=android/app/src/main/res/xml/network_security_config.xml
grep -q "$HOST_NAME" $XML || sed -i "s#</network-security-config>#  <domain-config cleartextTrafficPermitted=\"true\"><domain includeSubdomains=\"false\">$HOST_NAME</domain></domain-config>\n</network-security-config>#" $XML
grep -q "$HOST_NAME" $XML || { echo "could not allow http to $HOST_NAME"; exit 1; }

GRADLE=android/app/build.gradle
grep -q '^    debuggableVariants = \[\]' $GRADLE || sed -i 's#^react {#react {\n    debuggableVariants = []#' $GRADLE
grep -q '^    debuggableVariants = \[\]' $GRADLE || { echo "could not have the debug build carry its JavaScript"; exit 1; }

cd android
./gradlew assembleDebug --no-daemon -PreactNativeArchitectures=${ABIS:-x86_64}
ls -la app/build/outputs/apk/debug/app-debug.apk
