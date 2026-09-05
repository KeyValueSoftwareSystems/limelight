#!/usr/bin/env python3
"""Build a standalone emulator around a map. Stdlib only.

    python3 synth/build_emulator.py synth/truth/levels.map.json
    python3 synth/build_emulator.py synth/maps/dheeraj/levels.map.json -o dheeraj.html

One HTML file with the map, every rig and all three readers inlined. It opens
from a filesystem with no server and no network, which is what makes it
shareable -- the person you send it to needs nothing installed.

The audio is NOT inlined. They pick their own copy, because the repo holds
scores and never songs, and because a 20 MB base64 blob in a page is not a
sensible thing to send anyone.
"""
import json, os, sys, argparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "readers", "src")


def compact(m):
    """What the recipe reads, without the parts only the score view needs.

    frames is the big one -- ten thousand rows of it, which no reader touches
    today and which would triple the file for nothing."""
    obs = dict(m.get("observations") or {})
    obs.pop("frames", None)
    return {"accents": m.get("accents"), "obs": obs,
            "sections": (m.get("sections") or {}).get("entries", []) if isinstance(
                m.get("sections"), dict) else (m.get("sections") or []),
            "stems": m.get("stems")}


def build(map_path, out_path):
    m = json.load(open(map_path))
    lays = {}
    for name, p in (("club", "readers/lights/club/layout.json"),
                    ("venue", "readers/lights/venue.json"),
                    ("the-grind", "readers/lights/grind.json")):
        fp = os.path.join(ROOT, p)
        if os.path.exists(fp): lays[name] = json.load(open(fp))
    if not lays:
        raise SystemExit("no layouts found")

    html = open(os.path.join(SRC, "app.html")).read()
    for key, val in (("__MAP__", compact(m)), ("__MAPFULL__", m), ("__LAYOUTS__", lays)):
        html = html.replace(key, json.dumps(val, separators=(",", ":")))
    # the learned tier rides along as base64 when it exists, and is simply absent
    # when it does not -- the score view checks before using it
    vec = ""
    vp = (m.get("vectors") or {}).get("file")
    if vp:
        for cand in (os.path.join(os.path.dirname(os.path.abspath(map_path)), vp),
                     os.path.join(ROOT, "synth", "maps", "dheeraj", vp)):
            if os.path.exists(cand):
                import base64
                vec = base64.b64encode(open(cand, "rb").read()).decode(); break
    html = html.replace("__VECB64__", vec)

    for key, f in (("__RECIPE__", "recipe4.js"), ("__DRONES__", "drones.js"),
                   ("__RENDER__", "render_gl.js"), ("__SKY__", "sky.js"),
                   ("__SCORELANES__", "score_lanes.js"), ("__APP__", "appglue.js")):
        html = html.replace(key, open(os.path.join(SRC, f)).read())
    import re
    left = sorted(set(re.findall(r"__[A-Z0-9]+__", html)))
    if left:
        raise SystemExit(f"placeholders not filled: {left}")
    open(out_path, "w").write(html)
    return m, lays, len(html)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("map"); ap.add_argument("-o", "--out", default=None)
    a = ap.parse_args()
    out = a.out or os.path.join(
        ROOT, "emulator-" + os.path.basename(a.map).replace(".map.json", "") + ".html")
    m, lays, n = build(a.map, out)
    print(f"  {m['song']['title']}   {m['song']['length']}s   {m['grid']['bpm']} bpm")
    print(f"  {len(m.get('beats',[]))} beats · "
          f"{len((m.get('sections') or {}).get('entries', []))} sections · "
          f"{len(m.get('moments',[]))} moments · "
          f"{len((m.get('accents') or {}).get('events', []))} accents")
    rigs = ", ".join("%s (%d)" % (k, len(v["fixtures"])) for k, v in lays.items())
    print(f"  rigs: {rigs}")
    print(f"  -> {os.path.relpath(out, ROOT)}  ({n/1024:.0f} KB)")
    print("  open it in Chrome and pick your own copy of the song. Nothing uploads.")

if __name__ == "__main__":
    main()
