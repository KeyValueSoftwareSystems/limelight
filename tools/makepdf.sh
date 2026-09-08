#!/usr/bin/env bash
# Regenerate docs/anatomy-of-a-song-map.pdf from the standalone HTML.
#
# The HTML is the source: it opens in any browser with no Claude Code and no
# server, and carries its own print stylesheet -- A4, the light palette on paper
# whatever the reader's OS theme is, and break rules so a table row never splits
# down the middle. Chrome does the rendering because it is the only engine here
# that supports the CSS the page is built with.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="docs/anatomy-of-a-song-map.html"
OUT="docs/anatomy-of-a-song-map.pdf"
CHROME="${CHROME:-$(command -v google-chrome || command -v google-chrome-stable \
        || command -v chromium || command -v chromium-browser || true)}"
[ -n "$CHROME" ] || { echo "need Chrome or Chromium; set CHROME=/path/to/it"; exit 1; }
"$CHROME" --headless=new --disable-gpu --no-sandbox --virtual-time-budget=12000 \
  --run-all-compositor-stages-before-draw --no-pdf-header-footer \
  --print-to-pdf="$PWD/$OUT" "file://$PWD/$SRC"
command -v pdfinfo >/dev/null && pdfinfo "$OUT" | grep -E "^Pages|^Page size"
echo "$OUT"
