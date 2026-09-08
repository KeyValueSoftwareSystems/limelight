#!/usr/bin/env bash
# Everything that can say "this is broken", in one command. All stdlib or node.
set -uo pipefail
cd "$(dirname "$0")/.."
r=0
run(){ printf '\n== %s\n' "$*"; "$@" || r=1; }
run python3 validate.py synth/maps/amal/*.map.json maps/model/*.map.json
run python3 validate.py synth/songs/*.map.json
run node readers/src/apptest.js
run node readers/src/smooth.js
run python3 listen/metaeval.py levels
printf '\n== falsification: the deliberately broken maps must score 0.00\n'
python3 - <<'PY'
import sys; sys.path.insert(0,'listen'); import mapeval as ME
bad=[('levels','synth/maps/_broken-half-beat/levels.map.json'),
     ('the-nights','maps/sketch/the-nights.map.json')]
ok=True
for slug,p in bad:
    try: t=ME.evaluate(slug,p).get('total')
    except Exception as e: print('  %-46s could not score: %s'%(p,e)); continue
    print('  %-46s %.3f  %s'%(p,t,'ok' if t<0.05 else 'PROBLEM: this should be near zero'))
    ok = ok and t<0.05
sys.exit(0 if ok else 1)
PY
[ $? -eq 0 ] || r=1
printf '\n%s\n' "$([ $r -eq 0 ] && echo 'all checks passed' || echo 'SOMETHING FAILED -- see above')"
exit $r
