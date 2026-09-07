#!/usr/bin/env python3
"""Before a single frame: can this rig make the show this song asks for?

A limit is only useful while there is still time to do something else. The layout
has always said how fast a head turns and whether the room owns a strobe; nothing
read it before choosing a gesture, so an impossible move was discovered at the
instant it was needed -- when the only remaining option is to fail more tidily.

This asks the question early. For each gesture the show wants, and each rig we
have: can it, can it nearly, or must something else be found.

    python3 readers/lights/preflight.py levels
    python3 readers/lights/preflight.py levels --rig mainstage
"""
import sys, os, json, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))

ROLE = lambda k: ("par" if k in ("par", "wash", "uplight")
                  else "head" if k in ("head", "beam", "spot", "sky")
                  else "strip" if k in ("strip", "bar")
                  else "screen" if k in ("screen", "wall")
                  else k)

# Each gesture says what it needs. "kinds" is how many of a role, "cap" an
# attribute, "limit" a physical demand computed against the layout's own numbers.
GESTURES = [
    dict(name="flash on the beat",      need_role="par",  n=1),
    dict(name="brighter on the bar",    need_role="par",  n=1),
    dict(name="chase across the row",   need_role="par",  n=3,
         note="fewer than three in a row and there is no row to cross"),
    dict(name="wash that breathes",     need_any=[("strip", 1), ("screen", 1), ("par", 4)],
         note="a sidechain needs a sustained surface to duck; four pars will stand in"),
    dict(name="the build climbs",       need_role="par",  n=2),
    dict(name="blackout before a drop", need_role="par",  n=1),
    dict(name="everything white on it", need_role="par",  n=4,
         note="the hit reads by area; four lamps is the floor"),
    dict(name="strobe burst",           need_role="strobe", n=1,
         sub="blinders, or every lamp white for two frames"),
    dict(name="blinder hit",            need_role="blinder", n=1,
         sub="pars at full white"),
    dict(name="CO2 jet",                need_role="co2", n=1, sub="nothing -- it is a physical effect"),
    dict(name="the tune walks the row", need_role="par", n=4,
         note="pitch across three positions is a shrug"),
    dict(name="colour on the harmony",  need_cap="colour", n=1),
    dict(name="LED wall",               need_role="screen", n=1, sub="uplights washing the back wall"),
    dict(name="heads fan on the drop",  need_role="head", n=2, motor=True),
]


def layouts():
    out = {}
    for p in sorted(glob.glob(os.path.join(HERE, "*", "layout.json"))):
        try: d = json.load(open(p))
        except Exception: continue
        if d.get("fixtures"): out[d.get("room") or os.path.basename(os.path.dirname(p))] = d
    return out


def count(lay, role):
    return sum(1 for f in lay["fixtures"] if ROLE(f.get("kind")) == role)


def with_cap(lay, cap):
    return sum(1 for f in lay["fixtures"] if cap in (f.get("can") or []))


def head_move(lay, seconds):
    """How much of its range can a head cover in the time available? The show's
    hardest ask is repositioning during the bar before a drop."""
    lim = (lay.get("limits") or {}).get("max_pan_per_s")
    if not lim: return None
    return lim * seconds


def check(lay, g, bar_s):
    if g.get("need_cap"):
        have = with_cap(lay, g["need_cap"])
        return ("yes" if have >= g["n"] else "no"), f"{have} fixtures can do {g['need_cap']}"
    if g.get("need_any"):
        for role, n in g["need_any"]:
            if count(lay, role) >= n:
                return "yes", f"{count(lay, role)} {role}"
        wants = ", ".join(f"{n} {r}" for r, n in g["need_any"])
        return "no", f"needs one of: {wants}"
    role = g["need_role"]
    have = count(lay, role)
    if have < g["n"]:
        return "no", f"{have} {role}, needs {g['n']}"
    if g.get("motor"):
        reach = head_move(lay, bar_s)
        if reach is None:
            return "unknown", f"{have} heads, but the layout states no max_pan_per_s"
        widest = 0.62                      # the fan the show asks for, in range units
        if reach < widest:
            return "no", (f"{have} heads, but they cover {reach:.2f} of range in a bar "
                          f"and the fan is {widest:.2f} wide")
        return "yes", (f"{have} heads; a bar gives {reach:.2f} of range and the fan needs "
                       f"{widest:.2f}, so {reach/widest:.1f}x headroom")
    return "yes", f"{have} {role}"


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else "levels"
    mp = None
    for c in (os.path.join(ROOT, "synth", "truth", slug + ".map.json"),
              os.path.join(ROOT, "synth", "songs", slug + ".map.json")):
        if os.path.exists(c): mp = c; break
    if not mp:
        print(f"no map for {slug}"); return
    m = json.load(open(mp))
    bar_s = m["grid"]["period"] * 4
    only = sys.argv[sys.argv.index("--rig") + 1] if "--rig" in sys.argv else None

    print(f"{slug}: {m['grid']['bpm']:.1f} bpm, one bar is {bar_s:.3f} s")
    print(f"the show wants {len(GESTURES)} gestures\n")
    for name, lay in layouts().items():
        if only and name != only: continue
        res = [(g, *check(lay, g, bar_s)) for g in GESTURES]
        yes = sum(1 for _, v, _ in res if v == "yes")
        print(f"{name}   {len(lay['fixtures'])} fixtures   {yes}/{len(res)} possible")
        for g, verdict, why in res:
            if verdict == "yes": continue
            sub = g.get("sub")
            print(f"   {verdict.upper():7} {g['name']:24} {why}")
            if sub: print(f"           {'':24} instead: {sub}")
            elif g.get("note"): print(f"           {'':24} {g['note']}")
        print()


if __name__ == "__main__":
    main()
