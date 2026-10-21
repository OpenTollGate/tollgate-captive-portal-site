#!/usr/bin/env bash
# Render every mockup screen to PNG at 2x. Includes the two blank-render guards
# from the ui-mockup-design skill: (1) compare PNG sizes across screens, (2) dump
# the DOM once and grep for our own copy so a broken template is caught.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
HTML="$DIR/tollgate-issuance.html"
OUT="$DIR"
CHROME="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"

if [ -z "$CHROME" ]; then echo "no chrome found; set CHROME=" >&2; exit 1; fi

# DOM guard: does the template actually execute? Look for copy that only the
# rendered template produces.
echo "--- DOM guard (s=3) ---"
"$CHROME" --headless=old --disable-gpu --no-sandbox --virtual-time-budget=2000 \
  --dump-dom "file://$HTML?s=3" 2>/dev/null | grep -o "Pick a bundle" | head -1 \
  || { echo "DOM GUARD FAILED: template did not render"; exit 1; }

# phone screens vs desktop screens
shot() {
  local s="$1" name="$2" w="$3" h="$4"
  "$CHROME" --headless=old --disable-gpu --no-sandbox --hide-scrollbars \
    --virtual-time-budget=2500 \
    --window-size="${w},${h}" --force-device-scale-factor=2 \
    --screenshot="$OUT/$name.png" "file://$HTML?s=$s" >/dev/null 2>&1
  echo "$name.png $(stat -c%s "$OUT/$name.png") bytes"
}

shot s1 01-settings-before 1180 2000
shot s2 02-settings-after  1180 1500
shot s3 03-sell-desktop    1180 1700
shot s4 04-sell-phone       390  844
shot s5 05-portal-phone     390  844

# Guard: byte-identical PNGs across different screens = a blank render.
echo "--- size guard (identical sizes across screens mean a blank page) ---"
stat -c '%s %n' "$OUT"/*.png | awk '{print $1}' | sort | uniq -d | while read -r s; do
  echo "WARNING: duplicate PNG size $s — possible blank render"
done
echo "done"
