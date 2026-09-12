#!/usr/bin/env python3
"""Generate device-type driver profiles FROM rig.py -- imported, never copied.

rig.py (in experimentation/music_sync) is the verified authority for this rig's
channel map, colours and geometry. This script reads those constants at import time
and writes JSON profiles the JS driver runtime consumes, so the channel truth lives
in exactly one place and the reader can never drift from the hardware.

    python3 readers/lights/drivers/gen_profiles.py
    RIG_PY_DIR=/path/to/music_sync python3 .../gen_profiles.py

Output: readers/lights/drivers/profiles/{par7,head13}.profile.json
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "profiles")


def find_rig():
    cands = [os.environ.get("RIG_PY_DIR"),
             os.path.join(HERE, "../../../../experimentation/music_sync"),
             os.path.join(HERE, "../../../../../experimentation/music_sync")]
    for c in cands:
        if c and os.path.isfile(os.path.join(c, "rig.py")):
            return os.path.abspath(c)
    sys.exit("could not find rig.py; set RIG_PY_DIR to experimentation/music_sync")


def main():
    sys.path.insert(0, find_rig())
    import rig  # noqa: E402  -- the authority

    # PAR: 7-channel. Brightness lives in the colour channels (rig.set_par scales
    # r/g/b by level and holds the master dimmer full), so brightness = "colour".
    par_channels = [None] * 7
    par_channels[rig.PAR_DIM] = {"role": "master", "default": 255}
    par_channels[rig.PAR_R] = {"role": "colour.r", "default": 0}
    par_channels[rig.PAR_G] = {"role": "colour.g", "default": 0}
    par_channels[rig.PAR_B] = {"role": "colour.b", "default": 0}
    par_channels[rig.PAR_STROBE] = {"role": "strobe", "default": 0}
    par_channels[rig.PAR_PROG] = {"role": "keep_zero", "default": 0}
    par_channels[rig.PAR_SPEED] = {"role": "keep_zero", "default": 0}
    par7 = {
        "type": "par7", "footprint": 7, "brightness": "colour",
        "can": ["colour", "level", "strobe"],
        "channels": par_channels,
        "strobe": {"max_hz": 25},
        "park": {"level": 0},
        "note": "generated from rig.py; brightness scales the colour channels, master held full",
    }

    # HEAD: 13-channel, absolute channels 29..41. Brightness is the master dimmer.
    off = lambda ch: ch - rig.HEAD  # absolute channel -> profile offset
    head_channels = [None] * 13
    head_channels[off(rig.H_PAN)] = {"role": "pan", "default": 0}
    head_channels[off(rig.H_PAN_FINE)] = {"role": "pan_fine", "default": 0}
    head_channels[off(rig.H_TILT)] = {"role": "tilt", "default": 0}
    head_channels[off(rig.H_TILT_FINE)] = {"role": "tilt_fine", "default": 0}
    head_channels[off(rig.H_SPEED)] = {"role": "speed", "default": 0}
    head_channels[off(rig.H_DIM)] = {"role": "master", "default": 0}
    head_channels[off(rig.H_STROBE)] = {"role": "strobe", "default": 0}
    head_channels[off(rig.H_COLOUR)] = {"role": "colour_wheel", "default": 0}
    head_channels[off(rig.H_GOBO)] = {"role": "gobo", "default": 0}
    head_channels[off(rig.H_PRISM)] = {"role": "prism", "default": 0}
    for ch in rig.HEAD_KEEP_ZERO:
        head_channels[off(ch)] = {"role": "keep_zero", "default": 0}

    wheel = [{"name": n, "value": v, "rgb": list(rgb)} for n, v, rgb in rig.COLOURS]
    head13 = {
        "type": "head13", "footprint": 13, "brightness": "master",
        "can": ["colour", "level", "move", "strobe", "gobo", "prism"],
        "channels": head_channels,
        "colour_wheel": wheel,
        "spin_min": rig.COLOUR_SPIN_MIN,
        "gobo": {"open": rig.GOBO_OPEN, "flower": rig.GOBO_FLOWER},
        "prism": {"off": rig.PRISM_OFF, "six": rig.PRISM_6},
        # normalized park pose from rig's DMX facts; the bridge uses rig.park_frame()
        # for the real rig, this is the portable fallback.
        "park": {"pan": rig.PAN_WALL_CENTRE / 255.0, "tilt": rig.TILT_UP / 255.0,
                 "level": 0, "speed": 200 / 255.0},
        "limits": {"max_pan_per_frame": 7, "max_tilt_per_frame": 7},
        "note": "generated from rig.py; the real-rig bridge parks via rig.park_frame()",
    }

    os.makedirs(OUT, exist_ok=True)
    for name, prof in (("par7", par7), ("head13", head13)):
        p = os.path.join(OUT, f"{name}.profile.json")
        json.dump(prof, open(p, "w"), indent=1)
        print(f"  {name}: {prof['footprint']}ch, can={prof['can']} -> {os.path.relpath(p, HERE)}")


if __name__ == "__main__":
    main()
