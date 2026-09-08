#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - "$@" <<'PY'
import json, os, re, glob, sys
sys.path.insert(0, "readers/src")
from compact import compact

def layouts():
    found = {}
    for p in sorted(glob.glob("readers/lights/*/layout.json")):
        found[os.path.basename(os.path.dirname(p))] = json.load(open(p))
    for p in sorted(glob.glob("readers/lights/*.json")):
        d = json.load(open(p))
        if isinstance(d, dict) and d.get("fixtures"):
            found.setdefault(os.path.splitext(os.path.basename(p))[0], d)
    if not found:
        raise SystemExit("no layout with fixtures found under readers/lights/")
    return found

def default_map():
    for p in ("the-nights.map.json", "maps/model/the-nights.map.json"):
        if os.path.exists(p):
            return p
    got = sorted(glob.glob("maps/model/*.map.json"))
    if not got:
        raise SystemExit("no map found")
    return got[0]

LAY = layouts()
SHELL = open("readers/src/app.html").read()

def pretty(slug):
    return " ".join(w.capitalize() for w in slug.replace("-", " ").split())

def render(map_path, out_path, slug=None):
    full = json.load(open(map_path))
    slug = slug or os.path.basename(out_path)[:-5]
    s = SHELL.replace("__SONGSLUG__", slug).replace("__SONGTITLE__", pretty(slug))
    for k, v in (("__MAP__", compact(full)), ("__MAPFULL__", full), ("__LAYOUTS__", LAY)):
        s = s.replace(k, json.dumps(v, separators=(",", ":")))
    s = s.replace("__VECB64__", "")
    s = s.replace("__ROOM__",
                  ";(function(){\n" + open("synth/room.js").read() + "\n})();")
    for k, f in (("__RECIPE__", "recipe4.js"), ("__DRONES__", "drones.js"),
                 ("__RENDER__", "render_gl.js"), ("__SKY__", "sky.js"),
                 ("__SCORELANES__", "score_lanes.js"), ("__APP__", "appglue.js")):
        s = s.replace(k, open("readers/src/" + f).read())
    left = sorted(set(re.findall(r"__[A-Z0-9]+__", s)))
    if left:
        raise SystemExit("unfilled placeholders: " + ", ".join(left))
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    open(out_path, "w").write(s)
    return len(s) // 1024

args = sys.argv[1:]
if args:
    kb = render(args[0], args[1] if len(args) > 1 else "limelight.html")
    print(f"{args[1] if len(args)>1 else 'limelight.html'}  {kb} KB")
else:
    kb = render(default_map(), "limelight.html", "the-nights")
    print(f"limelight.html  {kb} KB  ({len(LAY)} rigs: {', '.join(sorted(LAY))})")
    # One show per song, built from the BEST map anyone has for that song rather
    # than from whatever maps/model happens to hold. The scorer already writes
    # what each map is worth to synth/learning/mapeval.jsonl, so the ranking is
    # read from there instead of being decided here -- one writer per fact, and
    # a map that has never been scored still gets a show, ranked below one that
    # has. The Nights was the case that made this necessary: the measured map
    # in maps/model scores 0.70 and the one in maps/amal scores 0.85, and the
    # stage was showing the lower of the two because of where the file sat.
    scored = {}
    board = "synth/learning/mapeval.jsonl"
    if os.path.exists(board):
        for line in open(board):
            try: r = json.loads(line)
            except Exception: continue
            mp, tot = r.get("map"), r.get("total")
            if mp and isinstance(tot, (int, float)):
                scored[mp] = tot                      # last line wins: latest score
    best = {}
    for p in sorted(glob.glob("maps/*/*.map.json")) + sorted(glob.glob("synth/maps/*/*.map.json")):
        if (os.sep + "sketch" + os.sep in p
                or os.sep + "_broken" in p):              # guesses and falsification maps never drive a show
            continue
        stem = os.path.basename(p)[:-len(".map.json")]
        slug, _, variant = stem.partition(".")
        tie = {"full": 2}.get(variant, 1 if variant == "" else 0)
        rank = (scored.get(p, -1.0), tie)
        if rank >= best.get(slug, ((-2.0, -1), None))[0]:
            best[slug] = (rank, p)
    for slug in sorted(best):
        out = os.path.join("shows", slug + ".html")
        (score, _), src = best[slug]
        why = f"{src}  ({'scores %.2f' % score if score >= 0 else 'not scored yet'})"
        print(f"  shows/{slug}.html  {render(src, out, slug)} KB   from {why}")
PY
