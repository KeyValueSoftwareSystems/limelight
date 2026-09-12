#!/usr/bin/env python3
"""Generate the current rig's layout.json FROM rig.py -- imported, never copied.

The layout is per-fixture (id, device type, position, DMX address/universe); the
device *types* it references (par7, head13) are described by the driver profiles
(gen_profiles.py). Positions come from rig.py's geometry so the reader's spatial
taste (inner/outer split, spread) matches the room.

    python3 readers/lights/gen_layout.py
Output: readers/lights/arc4-head.layout.json
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))


def find_rig():
    for c in [os.environ.get("RIG_PY_DIR"),
              os.path.join(HERE, "../../../experimentation/music_sync"),
              os.path.join(HERE, "../../../../experimentation/music_sync")]:
        if c and os.path.isfile(os.path.join(c, "rig.py")):
            return os.path.abspath(c)
    sys.exit("could not find rig.py; set RIG_PY_DIR to experimentation/music_sync")


def main():
    sys.path.insert(0, find_rig())
    import rig

    fixtures = []
    for a in rig.PAR_ADDRS:
        fixtures.append({
            "id": f"par_{a}", "type": "par7",
            "angle_deg": rig.PAR_ANGLE_DEG[a],
            "at": [round(rig.par_wall_x(a) / 100.0, 3), 0.0, 0.0],  # metres, on the arc
            "universe": rig.UNIVERSE, "address": a,
        })
    fixtures.append({
        "id": "head", "type": "head13",
        "at": [0.0, 0.0, 0.0],
        "universe": rig.UNIVERSE, "address": rig.HEAD,
    })

    layout = {
        "layout": "0.4", "rig": "arc4-head",
        "note": "generated from rig.py; positions in metres on a 150cm-radius arc",
        "fixtures": fixtures,
        "limits": {"max_pan_per_frame": 7, "max_tilt_per_frame": 7},
    }
    out = os.path.join(HERE, "arc4-head.layout.json")
    json.dump(layout, open(out, "w"), indent=1)
    print(f"  arc4-head: {len(fixtures)} fixtures "
          f"({sum(1 for f in fixtures if f['type']=='par7')} par + "
          f"{sum(1 for f in fixtures if f['type']=='head13')} head) -> {os.path.relpath(out, HERE)}")


if __name__ == "__main__":
    main()
