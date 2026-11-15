#!/bin/bash
# 2 Corinthians 8:9 at the default reading settings on a 1080x2340, 450 dpi phone: React Native measures its third line
# as fitting ("in order that") while an Android 15+ TextView breaks it one word earlier, so the drawn verse needs one
# line more than its view holds and "enriched." is cut off. A four-line view must end with "enriched." (ink near the
# right margin), not "might be" (ink stops near x=850); a five-line view (Android 15) holds "enriched." on its own line.
# Run on jbuild with an Android 16 emulator up (~/emu36.sh): scripts/android-verse-clip-check.sh <app.aab>
set -u
. ~/jb-lib.sh
AAB=${1:?usage: android-verse-clip-check.sh <app.aab>}
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 3; done
echo "Android $(adb shell getprop ro.build.version.release | tr -d '\r')"
adb shell wm size 1080x2340; adb shell wm density 450
bash ~/install.sh "$AAB"
adb shell am start -W -n $PKG/.MainActivity >/dev/null 2>&1; sleep 15
tap_label Skip >/dev/null; sleep 3
open 'read/47/8?v=9' 12
bounds=$(ui | grep -o 'text="9 For ye know[^"]*"[^>]*bounds="[^"]*"' | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | tr '\n' ' ')
set -- $bounds
[ -n "${4:-}" ] || { echo "FAIL: verse 9 not on screen"; exit 1; }
adb exec-out screencap -p > /tmp/verse-clip.png
python3 - "$@" <<'EOF'
import sys
from PIL import Image
left, top, right, bottom = map(int, sys.argv[1:5])
line = round(19 * 1.6 * 450 / 160)
img = Image.open('/tmp/verse-clip.png').convert('L')
bg = img.getpixel((left // 2, (top + bottom) // 2))
band = range(bottom - line, bottom)
ink = max((x for x in range(left, right) if any(abs(img.getpixel((x, y)) - bg) > 60 for y in band)), default=left)
lines = round((bottom - top) / line)
print(f'verse 9 view: {bottom - top}px ({lines} lines), last line ink ends at x={ink}')
if lines < 5 and ink < 950:
    sys.exit('FAIL: the last line inside the view stops short; "enriched." is drawn below it and cut off')
print('PASS: "enriched." is drawn inside the verse view')
EOF
