"""validator.py tests — the coverage-fill and stream-drop that stop a composer
plan baking black. Plain python idiom: run with `python3 portal/validator.test.py`.

Pins the "0 states -> 94% black" failure: an uncovered section is always filled,
a binding to an unknown stream is dropped, and a good plan is left intact."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from validator import validate  # noqa: E402

CATALOG = json.load(open(os.path.join(HERE, "effects.json")))["effects"]

OVERVIEW = {
    "sections": [
        {"name": "intro", "from": {"bar": 1}, "to": {"bar": 9}},
        {"name": "drop",  "from": {"bar": 9}, "to": {"bar": 17}},
        {"name": "outro", "from": {"bar": 17}, "to": {"bar": 25}},
    ],
    "moments": [
        {"at": {"bar": 8, "beat": 1}, "time_s": 10, "type": "peak", "intensity": 1.0},
        {"at": {"bar": 16, "beat": 1}, "time_s": 20, "type": "drop", "intensity": 0.5},
    ],
    "streams": ["vocal", "drums", "bass"],
    "curves": {"energy": [0.05] * 8 + [0.9] * 8 + [0.1] * 8},
}

PASS = FAIL = 0
def ok(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1; print(f"  pass  {name}")
    else:
        FAIL += 1; print(f"  FAIL  {name}" + (f"  -- {detail}" if detail else ""))

def covered(cleaned):
    return {s["section"] for s in cleaned["states"]}

# 1. an empty plan gets every section filled (the core fix)
cleaned, report = validate({"plan": "x", "states": [], "bindings": [], "gestures": []}, CATALOG, OVERVIEW)
ok("empty plan -> every section gets a state", covered(cleaned) == {0, 1, 2}, str(covered(cleaned)))
fills = [r for r in report if r.get("code") == "state_filled"]
ok("all three fills are reported", len(fills) == 3, str(len(fills)))

# 2. energy picks the effect: low -> drone, high -> wash
by_sec = {s["section"]: s for s in cleaned["states"]}
ok("low-energy intro filled with drone", by_sec[0]["effect"] == "drone", by_sec[0]["effect"])
ok("high-energy drop filled with wash", by_sec[1]["effect"] == "wash", by_sec[1]["effect"])
ok("low-energy outro filled with drone", by_sec[2]["effect"] == "drone", by_sec[2]["effect"])

# 3. a partly-covered plan keeps the real state and fills the rest
plan = {"plan": "x",
        "states": [{"section": 1, "effect": "wash", "amount": 0.6, "why": "the drop"}],
        "bindings": [], "gestures": []}
cleaned, report = validate(plan, CATALOG, OVERVIEW)
ok("partly-covered plan reaches full coverage", covered(cleaned) == {0, 1, 2}, str(covered(cleaned)))
ok("the model's own state is kept (not overwritten)",
   next(s for s in cleaned["states"] if s["section"] == 1).get("amount") == 0.6)
ok("only the two missing sections were filled",
   len([r for r in report if r.get("code") == "state_filled"]) == 2)

# 4. a binding to an unknown stream is DROPPED (would bake a dead constant)
plan = {"plan": "x", "states": [],
        "bindings": [{"section": 0, "effect": "follow", "stream": "theremin", "why": "no"}],
        "gestures": []}
cleaned, report = validate(plan, CATALOG, OVERVIEW)
ok("binding to unknown stream is dropped", len(cleaned["bindings"]) == 0)
ok("and it is reported as an error", any(r["level"] == "error" and "theremin" in r["msg"] for r in report))

# 5. a binding to a real stream survives
plan = {"plan": "x", "states": [],
        "bindings": [{"section": 0, "effect": "follow", "stream": "vocal", "why": "lead"}],
        "gestures": []}
cleaned, _ = validate(plan, CATALOG, OVERVIEW)
ok("binding to a real stream is kept", len(cleaned["bindings"]) == 1)

# 6. a state using a gesture effect is rejected, then that section is filled
plan = {"plan": "x",
        "states": [{"section": 0, "effect": "impact", "why": "wrong kind"}],
        "bindings": [], "gestures": []}
cleaned, report = validate(plan, CATALOG, OVERVIEW)
ok("a wrong-kind state is rejected", any(r["level"] == "error" and "state[0]" in r["msg"] for r in report))
ok("and its section is still covered by a fill", 0 in covered(cleaned))

# 7. a valid gesture is preserved
plan = {"plan": "x", "states": [],
        "bindings": [], "gestures": [{"moment": 0, "effect": "impact", "why": "peak"}]}
cleaned, _ = validate(plan, CATALOG, OVERVIEW)
ok("a valid gesture survives", len(cleaned["gestures"]) == 1)

print(f"\n{PASS} passed, {FAIL} failed")
raise SystemExit(1 if FAIL else 0)
