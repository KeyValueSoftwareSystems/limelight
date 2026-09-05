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
    best = {}
    for p in sorted(glob.glob("maps/model/*.map.json")):
        stem = os.path.basename(p)[:-len(".map.json")]
        slug, _, variant = stem.partition(".")
        rank = {"full": 2}.get(variant, 1 if variant == "" else 0)
        if rank >= best.get(slug, (-1, None))[0]:
            best[slug] = (rank, p)
    for slug in sorted(best):
        out = os.path.join("shows", slug + ".html")
        print(f"  shows/{slug}.html  {render(best[slug][1], out, slug)} KB")
PY
