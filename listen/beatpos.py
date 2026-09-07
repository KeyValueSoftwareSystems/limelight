#!/usr/bin/env python3
"""Give every timed thing in a map a MUSICAL position, not just a timestamp.

Seconds are an address in a recording. They are not a musical fact, and because
they are only addresses nothing in a map forces two fields to agree about where a
bar begins. That is not abstract: Amal's chapters all sit on beat 0 of a bar and
the drop kicks all sit on beat 2, both internally consistent and contradicting
each other about the most basic fact in the song. Had the file said "bar 11 beat
1" for both, the contradiction could not have been written down.

So each timed entry gains one number:

    pos  -- beats from the grid origin.

42.0 is beat 42 exactly. 42.26 is a hit a sixteenth and a hair after beat 42, and
that hair IS the groove: the deviation lives in the number rather than needing a
field of its own. Seconds come back as phase + pos * period whenever a reader
wants them, so a grid correction fixes everything downstream for free instead of
leaving the structure stranded where it was.

bar and beat are derived from pos and bar_phase, never stored, because storing a
derived value is how the two get to disagree.

`at` is kept alongside. Nothing has to change at once, and a reader that wants
seconds still finds them.

    python3 listen/beatpos.py levels
    python3 listen/beatpos.py levels --write
"""
import sys, os, json

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# every field that carries a time, and how to reach the number inside it
TIMED = [
    ("chapters",              None,        "at"),
    ("moments",               None,        "at"),
    ("spans",                 None,        "from"),
    ("spans",                 None,        "to"),
    ("sections.entries",      None,        "at"),
    ("sections.entries",      None,        "to"),
    ("accents.events",        None,        "at"),
    ("observations.chords.events", None,   "at"),
]


def dig(m, path):
    cur = m
    for k in path.split("."):
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur if isinstance(cur, list) else None


def add(m):
    g = m.get("grid") or {}
    per, ph = g.get("period"), g.get("phase")
    if not per:
        return None
    bp = g.get("bar_phase", 0)
    to_pos = lambda t: round((t - ph) / per, 4)

    touched = {}
    for path, _, key in TIMED:
        rows = dig(m, path)
        if not rows:
            continue
        n = 0
        for r in rows:
            if not isinstance(r, dict) or key not in r:
                continue
            r["pos" if key == "at" else "pos_" + key] = to_pos(r[key])
            n += 1
        if n:
            touched[f"{path}.{key}"] = n

    # the melody is [t, name, midi]; a fourth slot carries its position
    mel = ((m.get("observations") or {}).get("melody") or {}).get("notes")
    if isinstance(mel, list):
        n = 0
        for i, e in enumerate(mel):
            if e and isinstance(e, list) and len(e) >= 3:
                if len(e) == 3:
                    e.append(to_pos(e[0]))
                else:
                    e[3] = to_pos(e[0])
                n += 1
        if n:
            touched["observations.melody.notes"] = n

    # groove: how far each drum hit sits from the nearest sixteenth, in beats.
    # A quantised record reads near zero. Swing shows up as a consistent bias on
    # the off-sixteenths, which is the thing snapT was destroying.
    ev = ((m.get("accents") or {}).get("events")) or []
    devs = []
    for e in ev:
        if "pos" not in e:
            continue
        d = e["pos"] - round(e["pos"] * 4) / 4
        e["off16"] = round(d, 4)
        devs.append(d)
    groove = None
    if len(devs) >= 20:
        devs_sorted = sorted(devs)
        med = devs_sorted[len(devs_sorted) // 2]
        spread = devs_sorted[int(len(devs_sorted) * 0.84)] - devs_sorted[int(len(devs_sorted) * 0.16)]
        # split by which sixteenth of the beat each hit falls on
        byslot = {0: [], 1: [], 2: [], 3: []}
        for e in ev:
            if "off16" not in e:
                continue
            byslot[int(round(e["pos"] * 4)) % 4].append(e["off16"])
        groove = {
            "how": ("deviation of each drum hit from the nearest sixteenth, in beats, "
                    "kept per hit as off16. A quantised record reads near zero on every "
                    "slot; swing shows as a consistent bias on the off-slots. This is "
                    "the information snapT was overwriting."),
            "median_beats": round(med, 4),
            "spread_beats": round(spread, 4),
            "by_sixteenth": {str(k): (round(sum(v) / len(v), 4) if v else None)
                             for k, v in byslot.items()},
            "hits": len(devs),
        }
        m.setdefault("observations", {})["groove"] = groove

    m["position"] = {
        "how": ("pos is beats from the grid origin: seconds = grid.phase + pos * "
                "grid.period. bar and beat are DERIVED from pos and grid.bar_phase and "
                "are never stored, because a stored derived value is how two fields "
                "get to disagree about where a bar begins."),
        "bar_of":  "floor((pos - bar_phase) / 4)",
        "beat_of": "(pos - bar_phase) mod 4",
        "fields": touched,
    }
    return touched, groove, bp


def bar_report(m):
    """Do the structural marks land on bar lines? This is the check that would
    have caught tonight's contradiction on the day it was written."""
    g = m.get("grid") or {}
    bp = g.get("bar_phase", 0)
    out = {}
    for path, key in (("chapters", "pos"), ("moments", "pos"),
                      ("spans", "pos_from"), ("sections.entries", "pos")):
        rows = dig(m, path) or []
        vals = [r[key] for r in rows if isinstance(r, dict) and key in r]
        if not vals:
            continue
        on = sum(1 for v in vals if abs(((v - bp) % 4)) < 0.02 or abs(((v - bp) % 4) - 4) < 0.02)
        out[path] = (on, len(vals))
    return out, bp


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    write = "--write" in sys.argv
    for slug in (args or ["levels"]):
        p = None
    # maps/model is where the measured maps actually live. These tools only
    # looked in synth/truth and synth/songs, so none of them had ever run on
    # levels, starlight, mizhiyoram or dont-look-down -- including pump.py,
    # which finds the one production element the record is built on.
        for c in (os.path.join(ROOT, "maps", "model", slug + ".full.map.json"),
                  os.path.join(ROOT, "maps", "model", slug + ".map.json"),
                  os.path.join(ROOT, "synth", "truth", slug + ".map.json"),
                  os.path.join(ROOT, "synth", "songs", slug + ".map.json")):
            if os.path.exists(c):
                p = c; break
        if not p:
            print(f"{slug}: no map"); continue
        m = json.load(open(p))
        r = add(m)
        if not r:
            print(f"{slug}: no grid.period"); continue
        touched, groove, bp = r
        print(f"\n{slug}   bar_phase {bp}")
        for k, n in sorted(touched.items()):
            print(f"   {n:5d} positions  {k}")
        if groove:
            print(f"   groove: median {groove['median_beats']:+.4f} beats, "
                  f"spread {groove['spread_beats']:.4f}, over {groove['hits']} hits")
            print("           by sixteenth:", groove["by_sixteenth"])
        rep, bp = bar_report(m)
        print("   do the structural marks land on bar lines?")
        for k, (on, tot) in rep.items():
            flag = "" if on == tot else "   <-- MISMATCH"
            print(f"     {k:22} {on:3d} / {tot:3d}{flag}")
        if write:
            json.dump(m, open(p, "w"), indent=1)
            print(f"   -> {os.path.relpath(p, ROOT)}")
