#!/usr/bin/env python3
"""The balance sheet: what the song asks for, against what a rig can actually pay.

Renjith, 9 Sept -- "you have to find that balance sheet to use all of the
capabilities the lights have". Pre-flight answers yes/no per dimension. This
answers the next question: WHICH pattern spends that capability, and which
capabilities are sitting unspent.

    python3 readers/lights/balance.py levels --rig three
"""
import sys, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The group vocabulary. A single lamp has level and hue; N lamps IN A ROW have
# these as well, and they are the capabilities we were leaving unspent.
PATTERNS = {
  "hold":        ("1+", "level",        "a steady bed. the room, not the song"),
  "pulse":       ("1+", "level+time",   "brightness on the beat. weakest visual rhythm cue there is"),
  "ball":        ("3+", "level+place",  "one brightness TRAVELS and lands on the beat, accelerating"),
  "chase":       ("3+", "level+place",  "sequential, one lamp at a time, constant speed"),
  "dark chase":  ("3+", "level+extent", "all lit, one dark, the gap moves. spends every lamp"),
  "bounce":      ("3+", "level+place",  "L-C-R-C. never teleports, lands centre on the backbeat"),
  "phase fan":   ("2+", "level+time",   "same effect per lamp, offset in time. kills unison"),
  "split":       ("2+", "level+extent", "pair driven apart. same total light, less symmetry"),
  "wing":        ("3+", "level+place",  "centre leads, outers mirror it"),
  "count":       ("1+", "extent",       "HOW MANY are lit. countable at 3, invisible at 101"),
  "colour wave": ("3+", "hue+place",    "a hue travelling the axis"),
  "bump":        ("1+", "level",        "one frame to full. punctuation"),
  "gap":         ("1+", "level+time",   "everything to zero. the most expensive thing in the rig"),
}

# which pattern spends which dimension, for a row of pars
SPEND = {
  "pulse":   ["ball", "bounce", "phase fan"],
  "hits":    ["bump", "ball"],
  "groove":  ["ball", "phase fan"],
  "amount":  ["count", "dark chase"],
  "balance": ["split", "wing"],
  "harmony": ["colour wave", "hold"],
  "voice":   ["count", "hold"],
  "tension": ["split", "phase fan", "count"],
  "impact":  ["bump", "gap"],
  "pitch":   [],
}

def run(slug, rig):
    dp = os.path.join(ROOT, "synth", "dimensions", slug + ".dimensions.json")
    lp = os.path.join(ROOT, "readers", "lights", rig, "layout.json")
    if not (os.path.exists(dp) and os.path.exists(lp)):
        print("  need dimensions and a layout"); return
    dims = json.load(open(dp))["dimensions"]
    lay = json.load(open(lp))
    pars = [f for f in lay["fixtures"] if f.get("kind") == "par"]
    caps = set()
    for f in lay["fixtures"]:
        caps.update(f.get("can") or [])
    n = len(pars)
    xs = sorted(f["at"][0] for f in pars if f.get("at"))
    span = (xs[-1] - xs[0]) if len(xs) > 1 else 0.0
    room = (lay.get("size_m") or {}).get("w", 0) or 1
    row = span >= room * 0.35

    print(f"  {slug} on {rig}: {n} pars, span {span:.1f} m of {room:.1f} m "
          f"({'a row -- place is available' if row else 'clustered -- no place'})")
    print(f"  declared capabilities: {', '.join(sorted(caps))}\n")
    print(f"  {'dimension':10} {'rate/s':>7}  {'asks for':16} spends it with")
    used = set()
    for d in dims:
        ps = SPEND.get(d["key"], [])
        ok = [p for p in ps if (int(PATTERNS[p][0][0]) <= n)
              and not ("place" in PATTERNS[p][1] and not row)]
        used.update(ok)
        r = d.get("rate_hz")
        print(f"  {d['key']:10} {('%.2f' % r) if r else '   -':>7}  {d['channel']:16} "
              f"{', '.join(ok) if ok else '-- nothing this rig owns'}")
    print()
    unspent = [p for p in PATTERNS
               if p not in used and int(PATTERNS[p][0][0]) <= n
               and not ("place" in PATTERNS[p][1] and not row)]
    print(f"  patterns this rig can do but no dimension is spending: "
          f"{', '.join(unspent) if unspent else 'none -- fully spent'}")
    for p in unspent:
        print(f"      {p:12} {PATTERNS[p][2]}")

if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    rig = sys.argv[sys.argv.index("--rig") + 1] if "--rig" in sys.argv else "three"
    run(a[0] if a else "levels", rig)
