#!/usr/bin/env python3
"""Preprocess an MVR into a flat scene the C++ sim renders.

    python3 readers/lights/sim/gen_scene.py <file.mvr> [out_dir]

Reads ANY MVR and writes:
  <out>/scene.json         fixtures: id, kind, pos, aim, beam, universe/address,
                           channel names + offsets + idle defaults (all from the GDTF)
  <out>/models/<gdtf>/*.glb  each fixture's real 3D parts, extracted from the GDTF

The C++ renderer reads only scene.json + the .glb files -- no zip/XML/GDTF parsing
in C++. Reuses gen_mvr's GDTF channel parsing so there is one writer of that logic.

Coordinates are metres, Blender/MVR convention (x=width, y=depth, z=up).
GDTFs whose models are .3ds (not .glb) are flagged has_3ds; those parts need a
one-time Blender conversion to .glb (the renderer proxies them until then).
"""
import json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "mvr"))
from gen_mvr import gdtf_channels                      # reuse the one channel parser

KIND_PREFIX = [("uplight", "up_"), ("head", "head"), ("strobe", "strobe"),
               ("blinder", "blind"), ("strip", "strip"), ("fog", "fog"), ("par", "par")]


def _mat(s):
    """MVR Matrix string -> [v1, v2, v3, pos] as lists of floats."""
    return [[float(x) for x in g.split(",")] for g in re.findall(r"\{([^}]*)\}", s)]


def _beam_deg(desc_root):
    for b in desc_root.iter("Beam"):
        a = b.get("BeamAngle")
        if a:
            try: return round(float(a), 2)
            except ValueError: pass
    return 15.0


def _kind(name):
    n = (name or "").lower()
    for kind, pfx in KIND_PREFIX:
        if n.startswith(pfx):
            return kind
    return "fixture"


def build(mvr_path, out_dir):
    gdir = os.path.join(out_dir, "gdtf")
    mroot = os.path.join(out_dir, "models")
    os.makedirs(gdir, exist_ok=True)
    os.makedirs(mroot, exist_ok=True)
    z = zipfile.ZipFile(mvr_path)
    scene = ET.fromstring(z.read("GeneralSceneDescription.xml"))

    focus = {}
    for fp in scene.iter("FocusPoint"):
        m = fp.findtext("Matrix")
        if m:
            focus[fp.get("uuid")] = _mat(m)[3]

    cache = {}

    def load_gdtf(spec):
        if spec in cache:
            return cache[spec]
        path = os.path.join(gdir, spec)
        with open(path, "wb") as f:
            f.write(z.read(spec))                       # extract the nested .gdtf
        gz = zipfile.ZipFile(path)
        desc = ET.fromstring(gz.read("description.xml"))
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", spec)
        mdir = os.path.join(mroot, safe)
        os.makedirs(mdir, exist_ok=True)
        models = []
        for n in gz.namelist():
            if n.lower().endswith(".glb"):
                with open(os.path.join(mdir, os.path.basename(n)), "wb") as f:
                    f.write(gz.read(n))
                models.append(os.path.relpath(os.path.join(mdir, os.path.basename(n)), out_dir))
        info = {"path": path, "beam": _beam_deg(desc), "models": sorted(models),
                "has_3ds": any(x.lower().endswith(".3ds") for x in gz.namelist())}
        cache[spec] = info
        return info

    fixtures = []
    for fx in scene.iter("Fixture"):
        spec, mode = fx.findtext("GDTFSpec"), fx.findtext("GDTFMode")
        if not spec:
            continue
        g = load_gdtf(spec)
        ch = gdtf_channels(g["path"], mode)
        pos = [round(c / 1000.0, 4) for c in _mat(fx.findtext("Matrix"))[3]]
        absaddr = int(fx.findtext("Addresses/Address") or "1")
        aim = focus.get(fx.findtext("Focus"))
        aim = [round(c / 1000.0, 4) for c in aim] if aim else [pos[0], pos[1], 0.0]
        fixtures.append({
            "id": fx.get("name"), "kind": _kind(fx.get("name")),
            "gdtf": spec, "mode": mode,
            "pos": pos, "aim": aim, "beam_deg": g["beam"],
            "universe": (absaddr - 1) // 512 + 1, "address": (absaddr - 1) % 512 + 1,
            "channels": [c["attribute"] for c in ch],
            "offsets": [c["offsets"] for c in ch],
            "defaults": [c["default"] for c in ch],
            "models": g["models"], "has_3ds": g["has_3ds"],
        })

    scene_json = {"source": os.path.basename(mvr_path), "fixtures": fixtures}
    with open(os.path.join(out_dir, "scene.json"), "w") as f:
        json.dump(scene_json, f, indent=1)
    return fixtures


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: gen_scene.py <file.mvr> [out_dir]")
    mvr = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "cache")
    fixtures = build(mvr, out)
    with_glb = sum(1 for f in fixtures if f["models"])
    need_conv = sorted({f["gdtf"] for f in fixtures if f["has_3ds"] and not f["models"]})
    print(f"scene: {len(fixtures)} fixtures -> {os.path.join(out, 'scene.json')}")
    print(f"  {with_glb} fixtures have .glb models extracted")
    if need_conv:
        print(f"  need .3ds->.glb conversion (proxied for now): {', '.join(need_conv)}")


if __name__ == "__main__":
    main()
