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

def render(map_path, out_path):
    full = json.load(open(map_path))
    s = SHELL
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
    kb = render(default_map(), "limelight.html")
    print(f"limelight.html  {kb} KB  ({len(LAY)} rigs: {', '.join(sorted(LAY))})")
    for p in sorted(glob.glob("maps/model/*.map.json")):
        name = os.path.basename(p)[:-len(".map.json")].replace(".", "-")
        out = os.path.join("shows", name + ".html")
        print(f"  shows/{name}.html  {render(p, out)} KB")
PY
