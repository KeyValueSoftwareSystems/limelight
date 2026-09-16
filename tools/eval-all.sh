#!/usr/bin/env bash
# Run the show eval over every installed show file, on every rig it should play.
#
#   tools/eval-all.sh              every show, every rig
#   tools/eval-all.sh arc4-head    every show, one rig
#
# Exits non-zero if any show fails on any rig, so it can gate a publish.
set -uo pipefail
cd "$(dirname "$0")/.."

RIGS=${1:-$(ls portal/venues | grep -v '\.js$')}
FAIL=0

for show in portal/showfiles/*.show.json; do
  name=$(basename "$show" .show.json)
  score="hub/files/score/${name%%.*}.score"
  [[ -f "$score" ]] || score="hub/files/score/$(echo "$name" | sed 's/-designed$//').score"
  if [[ ! -f "$score" ]]; then
    echo "skip  $name — no score at $score"
    continue
  fi
  for rig in $RIGS; do
    [[ -f "portal/venues/$rig/manifest.json" ]] || continue
    if node tools/eval-show.js "$score" "$show" --rig "$rig" > /tmp/eval.$$ 2>&1; then
      echo "pass  $name on $rig"
    else
      FAIL=1
      echo "FAIL  $name on $rig"
      grep '^  FAIL' /tmp/eval.$$ | sed 's/^/      /'
    fi
    rm -f /tmp/eval.$$
  done
done

exit $FAIL
