#!/usr/bin/env python3
"""The protocol view bakes the same show as the raw score.

The hub will serve scores through the protocol endpoint (the format_v1 view):
`parts` become `sections` with rise/stems embedded, and the top-level `parts`
array is gone. Our reader must extract the *same* DMX from that view as it does
from the raw score, or the show changes the day we switch the data source.

So: bake a raw score, bake its format_v1 view, and assert the frames and the
timeline match byte for byte. This fails if the reader still reaches for
`parts` (a section's embedded `rise` would be lost) -- exactly the gap the
arranger's partRise change closes.

Needs node (bake.js). Run with any python3; score_api is a sibling module.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
BAKE = os.path.join(REPO, "readers", "lights", "bake.js")
sys.path.insert(0, os.path.join(REPO, "hub"))   # score_api moved into hub/
import score_api  # noqa: E402

PASS = FAIL = 0


def ok(label, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok  {label}")
    else:
        FAIL += 1
        print(f"FAIL  {label}" + (f" — {detail}" if detail else ""))


def _stems(drums):
    return {"drums": {"is": "full" if drums else "none", "level": drums},
            "bass": {"is": "none", "level": 0.0}}


# A raw pipeline score with a rising middle part: energy alone would call it
# `break`, only the part's `rise` lifts it to `build`. That is the field the
# protocol view carries on the section instead of a top-level `parts` entry.
RAW = {
    "score": "parity", "version": 1,
    "grid": {"bpm": 120, "first_beat_s": 0.0, "beats_per_bar": 4,
             "bars": 16, "first_bar": 0, "last_bar": 15},
    "parts": [
        {"from_bar": 0,  "to_bar": 3,  "role": "opening", "rise": -0.02, "stems": _stems(0.0)},
        {"from_bar": 4,  "to_bar": 7,  "role": "rising",  "rise": 0.20,  "stems": _stems(0.4)},
        {"from_bar": 8,  "to_bar": 11, "role": "steady",  "rise": 0.00,  "stems": _stems(0.5)},
        {"from_bar": 12, "to_bar": 15, "role": "peak",    "rise": 0.00,  "stems": _stems(0.9)},
    ],
    "bars": {"intensity": [0.05, 0.05, 0.05, 0.05, 0.30, 0.32, 0.31, 0.33,
                           0.30, 0.30, 0.30, 0.30, 0.90, 0.90, 0.90, 0.90]},
}


def bake(score_obj):
    """Bake a score object to its lights.json (frames + timeline)."""
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "in.score")
        out = os.path.join(d, "out.lights.json")
        with open(src, "w") as f:
            json.dump(score_obj, f)
        r = subprocess.run(["node", BAKE, src, "1", "--lights", out],
                           capture_output=True, text=True, timeout=180)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout)[-400:])
        with open(out) as f:
            return json.load(f)


def test_format_v1_bakes_the_same_show():
    fmt = score_api.format_v1(RAW)
    ok("format_v1 drops the top-level parts array", "parts" not in fmt)
    ok("format_v1 carries rise on each section",
       all("rise" in s for s in fmt["sections"]), str(fmt["sections"][:1]))

    from_raw = bake(RAW)
    from_fmt = bake(fmt)

    ok("baked frames are identical", from_raw["frames"] == from_fmt["frames"],
       f"raw {len(from_raw['frames'])} vs fmt {len(from_fmt['frames'])} frames")
    for k in ("beats", "downbeats", "sections", "phases", "duration", "fps"):
        ok(f"baked {k} is identical", from_raw.get(k) == from_fmt.get(k))


if __name__ == "__main__":
    test_format_v1_bakes_the_same_show()
    print(f"{PASS} passed, {FAIL} failed")
    raise SystemExit(1 if FAIL else 0)
