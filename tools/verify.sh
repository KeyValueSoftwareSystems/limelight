#!/usr/bin/env bash
# Everything that can say "this is broken", in one command. All stdlib or node.
set -uo pipefail
cd "$(dirname "$0")/.."
r=0
run(){ printf '\n== %s\n' "$*"; "$@" || r=1; }
run python3 validate.py synth/maps/amal/*.map.json
run python3 validate.py synth/songs/*.map.json
run node readers/src/apptest.js
run node readers/src/smooth.js
for s in shows/*.html; do run node readers/src/showaudit.js "$s"; done
run python3 listen/metaeval.py levels
printf '\n== falsification: a corrupted map must score near zero\n'
python3 - <<'PY2'
import sys, copy, json
sys.path.insert(0, 'listen')
import mapeval as ME

base = 'synth/maps/amal/levels.map.json'
m = json.load(open(base))
per = m['grid']['period']
ok = True

def score(mm, label):
    global ok
    t = ME.evaluate('levels', m=mm)['total']
    good = t < 0.10
    ok = ok and good
    print('  %-34s %.3f  %s' % (label, t, 'ok' if good else 'PROBLEM: should be near zero'))

half = copy.deepcopy(m)
half['grid']['phase'] += per / 2
half['beats'] = [t + per / 2 for t in m['beats']]
half['downbeats'] = [t + per / 2 for t in m['downbeats']]
score(half, 'every beat half a beat late')

empty = copy.deepcopy(m)
for k in ('beats', 'downbeats'):
    empty[k] = []
empty['grid']['period'] = None
score(empty, 'no grid at all')

sys.exit(0 if ok else 1)
PY2
[ $? -eq 0 ] || r=1
printf '\n%s\n' "$([ $r -eq 0 ] && echo 'all checks passed' || echo 'SOMETHING FAILED -- see above')"
exit $r
