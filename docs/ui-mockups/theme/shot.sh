#!/usr/bin/env bash
# Render the theme mockups to PNG.
#
# Two guards, both learned the hard way on PR #87:
#   1. DOM guard  — grep the rendered DOM for copy that only exists in one
#      screen, so a silently-empty render cannot be photographed and shipped.
#   2. size guard — a blank page compresses to almost nothing; compare each PNG
#      against a floor so "it rendered" is proven, not assumed.
set -euo pipefail

cd "$(dirname "$0")"
OUT=.
CHROME="${CHROME:-chromium}"

command -v node >/dev/null || { echo "shot.sh: node is required" >&2; exit 1; }

# 1. DOM guard
if ! node -e '
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto("file://" + process.argv[1] + "/theme-variants.html");
  const html = await p.content();
  const need = ["Obsidian coral", "Slate coral", "Parchment",
                "Your internet balance", "Save changes", "9 min"];
  const missing = need.filter((s) => !html.includes(s));
  await b.close();
  if (missing.length) { console.error("MISSING COPY: " + missing.join(", ")); process.exit(1); }
  console.log("dom guard ok: " + need.length + " markers present");
})();
' "$PWD"; then
  echo "shot.sh: render guard failed — refusing to write PNGs" >&2
  exit 1
fi

# 2. render
node -e '
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
  await p.goto("file://" + process.argv[1] + "/theme-variants.html");
  await p.waitForTimeout(400);
  await p.screenshot({ path: process.argv[1] + "/00-three-variants.png", fullPage: true });
  await b.close();
  console.log("wrote 00-three-variants.png");
})();
' "$PWD"

# 3. size guard
python3 - "$PWD/00-three-variants.png" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
size = p.stat().st_size
if size < 120_000:
    sys.exit(f"shot.sh: {p.name} is only {size} bytes — looks blank")
print(f"size guard ok: {p.name} {size:,} bytes")
PY

echo "done"
