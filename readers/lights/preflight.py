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

# What each gesture NEEDS, expressed as a capability rather than a fixture name.
# The layouts already declare capability -- level, colour, strobe, move, pixels --
# on every one of their fixtures, and reasoning from that instead of from the kind
# is the difference between a hand-written substitution and a derived one. The
# small rig owns no fixture called a strobe, and its blinders declare `strobe`, so
# the burst is possible there and nobody had to write down that blinders can flash.
GESTURES = [
    dict(name="flash on the beat",      cap="level",  n=1),
    dict(name="brighter on the bar",    cap="level",  n=1),
    dict(name="chase across the row",   cap="level",  n=3, spread=True,
         note="three lamps that are not spread across the room is not a row"),
    dict(name="wash that breathes",     cap="level",  n=4,
         note="a sidechain needs a sustained surface; four lamps will hold one"),
    dict(name="the build climbs",       cap="level",  n=2),
    dict(name="blackout before a drop", cap="level",  n=1),
    dict(name="everything white on it", cap="level",  n=4),
    dict(name="strobe burst",           cap="strobe", n=2),
    dict(name="colour on the harmony",  cap="colour", n=2),
    dict(name="the tune walks the row", cap="level",  n=4, spread=True),
    dict(name="a surface that holds a colour", cap="pixels", n=1,
         sub="uplights washing the back wall, if any have colour"),
    dict(name="heads fan on the drop",  cap="move",   n=2, motor=True),
    dict(name="CO2 jet",                kind="co2",   n=1,
         sub="nothing. it is a physical effect and no lamp substitutes for it"),
]


def layouts():
    out = {}
    for p in sorted(glob.glob(os.path.join(HERE, "*", "layout.json"))):
        try: d = json.load(open(p))
        except Exception: continue
        if d.get("fixtures"): out[d.get("room") or os.path.basename(os.path.dirname(p))] = d
    return out


def having(lay, cap):
    return [f for f in lay["fixtures"] if cap in (f.get("can") or [])]


def kinds_of(fixtures):
    from collections import Counter
    c = Counter(f.get("kind") for f in fixtures)
    return ", ".join(f"{n} {k}" for k, n in c.most_common(3))


def spread_of(fixtures):
    """How far apart are they? Three lamps in the same corner are not a row."""
    xs = [f["at"][0] for f in fixtures if f.get("at")]
    return (max(xs) - min(xs)) if len(xs) > 1 else 0.0


def head_move(lay, seconds):
    """How much of its range can a head cover in the time available? The show's
    hardest ask is repositioning during the bar before a drop."""
    lim = (lay.get("limits") or {}).get("max_pan_per_s")
    if not lim: return None
    return lim * seconds


def check(lay, g, bar_s):
    if g.get("kind"):
        have = [f for f in lay["fixtures"] if f.get("kind") == g["kind"]]
        return ("yes" if len(have) >= g["n"] else "no"), f"{len(have)} {g['kind']}"
    have = having(lay, g["cap"])
    if len(have) < g["n"]:
        return "no", f"{len(have)} fixtures can {g['cap']}, needs {g['n']}"
    if g.get("spread"):
        w = spread_of(have)
        room = (lay.get("size_m") or {}).get("w", 0)
        if room and w < room * 0.35:
            return "no", (f"{len(have)} can {g['cap']} but they span {w:.1f} m of a "
                          f"{room:.1f} m room -- not a row")
    if g.get("motor"):
        lim = (lay.get("limits") or {}).get("max_pan_per_s")
        if not lim:
            return "unknown", f"{len(have)} can move, but the layout states no max_pan_per_s"
        reach, widest = lim * bar_s, 0.62
        if reach < widest:
            return "no", (f"{len(have)} can move but cover {reach:.2f} of range in a bar, "
                          f"and the fan is {widest:.2f} wide")
        return "yes", (f"{len(have)} can move ({kinds_of(have)}); a bar gives {reach:.2f} "
                       f"of range against {widest:.2f} needed, {reach/widest:.1f}x headroom")
    return "yes", f"{len(have)} can {g['cap']} ({kinds_of(have)})"


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
