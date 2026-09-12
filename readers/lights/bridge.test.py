#!/usr/bin/env python3
"""bridge.py maps intents to DMX in Python for the live tick path, so it must apply
the SAME head aim window as the JS drivers (read from head13.profile.json, one
source of truth) and HOLD the head's pose when an intent carries no pan/tilt --
otherwise a blackout beat re-aims the head at park (straight up) and back.

Runs with the panel's rig.py copy (RIG_PY_DIR points there); no packets are sent."""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("RIG_PY_DIR", os.path.join(HERE, "panel"))
sys.path.insert(0, HERE)
import bridge  # noqa: E402

PASS = FAIL = 0
def ok(label, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ok  {label}")
    else: FAIL += 1; print(f"FAIL  {label}" + (f" -- {detail}" if detail else ""))

sys.path.insert(0, bridge.find_rig())
import rig  # noqa: E402
profile = json.load(open(os.path.join(HERE, "drivers", "profiles", "head13.profile.json")))
aim = bridge.load_aim(profile)
ok("the bridge reads the aim anchors from the driver profile", aim["pan"] == [0, 169, 255] and aim["tilt"] == [0, 40, 255], str(aim))

last = {"pan": rig.PAN_WALL_CENTRE, "tilt": rig.TILT_UP}
pan, tilt = bridge.head_pose({"pan": 0.5, "tilt": 0.5, "level": 1}, aim, last)
ok("0.5 is the wall on both axes (pan 169, tilt 40)", pan == 169 and tilt == 40, f"{pan}/{tilt}")
pan, tilt = bridge.head_pose({"pan": 1.0, "tilt": 1.0}, aim, last)
ok("pan 1 / tilt 1 reach the full travel", pan == 255 and tilt == 255, f"{pan}/{tilt}")
pan, tilt = bridge.head_pose({"pan": 0.25, "tilt": 0.75}, aim, last)
ok("the halves are linear about the wall (pan .25 -> 84/85, tilt .75 -> 147/148)", 84 <= pan <= 85 and 147 <= tilt <= 148, f"{pan}/{tilt}")
win = {"pan": [148, 190], "tilt": [40, 92]}
pan, tilt = bridge.head_pose({"pan": 0.5, "tilt": 0.0}, win, last)
ok("a two-anchor aim is still a plain window", pan == 169 and tilt == 40, f"{pan}/{tilt}")

held = {"pan": 160, "tilt": 55}
pan, tilt = bridge.head_pose({"level": 0}, aim, held)
ok("an intent without pan/tilt HOLDS the last pose instead of re-aiming at park", (pan, tilt) == (160, 55), f"{pan}/{tilt}")

# the safety slew cap is still there on top
ok("the per-frame slew cap is unchanged", bridge.MAX_STEP == 7)

print(f"{PASS} passed, {FAIL} failed")
raise SystemExit(1 if FAIL else 0)
