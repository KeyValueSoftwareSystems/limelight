#!/usr/bin/env python3
"""Test the tests, properly. Sensitivity, specificity, discrimination, anchoring.

selftest.py proves each check reacts when its own field is broken. That is only
half a guarantee, and the missing half is the one that let four circular checks
through: it never proves a check IGNORES the other fields. A check that moves when
somebody else's field changes cannot tell a producer what to fix.

So corrupt one field at a time and watch all of them:

  the DIAGONAL is sensitivity  -- did the check notice its own field breaking?
                                 a flat diagonal means the check is blind, or is
                                 reading the map against itself.
  the OFF-DIAGONAL is specificity -- did it notice somebody else's field breaking?
                                 a busy row means the check is contaminated, and
                                 Amal improving his chords would move his grid
                                 score, teaching him nothing.

Then two things a matrix cannot show. DISCRIMINATION: run every check over every
map we have and look at the spread -- if everyone scores the same, the check
carries no information about who is doing better, whatever its diagonal says.
And ANCHORING: what is the most external thing each check touches? A check
comparing one thing we wrote against another thing we wrote has no ground under
it at all, and no amount of self-testing creates any.

    python3 listen/metaeval.py
"""
import sys, os, json, copy, random, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import mapeval

# What each check compares against. This is the field that decides whether a
# result means anything, so it is written down rather than assumed.
ANCHOR = {
    "grid":      ("recording", "kick energy under the claimed beats"),
    "bars":      ("map",       "the map's own marks against its own bar phase"),
    "moments":   ("recording", "the loudness step nearest each claimed drop or stop"),
    "downbeats": ("recording", "low band on downbeats against the other beats"),
    "sections":  ("recording", "spectral change at boundaries, against a random control"),
    "energy":    ("recording", "onset rate, high-band onset rate and band occupancy -- counts "
                               "and percentiles, none of which move when the volume does; "
                               "loudness is a lower-weighted secondary and only votes when "
                               "the record's level actually varies"),
    "accents":   ("recording", "onset strength at the claimed hits"),
    "chords":    ("recording", "chroma energy of the claimed notes"),
    "melody":    ("recording", "pitch energy, against a tritone control"),
    "stems":     ("recording", "the six claimed levels, summed as energy, against the mix's "
                               "own loudness bar by bar"),
    "pump":      ("recording", "recomputed from the audio and compared"),
}


def corrupt(m, field, rng):
    """One deliberate, specific fault per field."""
    m = copy.deepcopy(m)
    if field == "stems":
        # The fault that was actually in the file: each stem normalised by its
        # own maximum, so a stem the separator invented sits near the top of
        # its range for the whole song.
        src = (m.get("stems") or {}).get("sources") or {}
        for n, v in list(src.items()):
            if not v:
                continue
            lo, hi = min(v), max(v)
            src[n] = [round((x - lo) / max(1e-9, hi - lo), 4) for x in v]
        (m.get("stems") or {}).pop("comparable", None)
        return m
    g = m["grid"]; per, ph = g["period"], g["phase"]
    if field == "moments":
        # a drop in the wrong place: two beats late, which is the exact fault
        # ev_moments was written for after the bar-line snap was found
        for x in (m.get("moments") or []):
            if x.get("kind") in ("drop", "stop"):
                x["at"] = x["at"] + 2 * per
        return m
    if field == "grid":
        g["phase"] = ph + per / 2
        m["beats"] = [t + per / 2 for t in m.get("beats", [])]
        m["downbeats"] = [t + per / 2 for t in m.get("downbeats", [])]
    elif field == "bars":
        g["bar_phase"] = (g.get("bar_phase", 0) + 1) % 4
    elif field == "downbeats":
        b = m.get("beats") or []
        bp = (g.get("bar_phase", 0) + 1) % 4
        m["downbeats"] = [t for i, t in enumerate(b) if (i - bp) % 4 == 0]
    elif field == "moments":
        # Two beats late. Not an arbitrary number: it is the error we actually
        # found on 8 Sept, when the best-scoring map put the drop in Levels at
        # 20.85 against a real 19.88, because its detector locked onto the
        # resume after the one-beat gap instead of the drop itself.
        mo = m.get("moments") or []
        mo = mo.get("entries") if isinstance(mo, dict) else mo
        for x in (mo or []):
            if "at" in x: x["at"] = max(0.0, x["at"] + 2 * per)
            elif "t" in x: x["t"] = max(0.0, x["t"] + 2 * per)
    elif field == "sections":
        for c in m.get("chapters", []): c["at"] = max(0.0, c["at"] + 4 * per)
    elif field == "energy":
        vals = [v for _, v in m.get("energy", [])]
        rng.shuffle(vals)
        m["energy"] = [[t, vals[i]] for i, (t, _) in enumerate(m.get("energy", []))]
    elif field == "accents":
        for e in (m.get("accents") or {}).get("events", []):
            e["at"] = max(0.0, e["at"] + rng.uniform(-0.09, 0.09))
    elif field == "chords":
        NOTES = mapeval.NOTES
        for e in ((m.get("observations") or {}).get("chords") or {}).get("events", []):
            root = e["chord"][0] + ("#" if len(e["chord"]) > 1 and e["chord"][1] == "#" else "")
            if root in NOTES:
                e["chord"] = NOTES[(NOTES.index(root) + 3) % 12] + e["chord"][len(root):]
    elif field == "melody":
        for e in ((m.get("observations") or {}).get("melody") or {}).get("notes", []):
            if e and len(e) >= 3 and isinstance(e[2], (int, float)):
                e[2] = e[2] + 5
    elif field == "pump":
        p = (m.get("observations") or {}).get("pump")
        if p: p["depth"] = -p.get("depth", 0) - 0.3
    return m


def scores_of(slug, m):
    r = mapeval.evaluate(slug, m=m)
    return {k: (v["score"] if v["score"] is not None else None)
            for k, v in r.get("fields", {}).items()}


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else "levels"
    # synth/truth/ holds the synthetic songs, whose times are causes. The four
    # real recordings have no such file and this tool refused to run on them at
    # all -- which is backwards, because a check is most worth testing on the
    # audio it will actually be used against. Fall back to the measured map: the
    # point here is whether a check MOVES when its field is broken, and that does
    # not need the base to be true.
    sys.path.insert(0, HERE)
    from mapio import map_path as _mp
    for cand in (os.path.join(ROOT, "synth", "truth", slug + ".map.json"),
                 _mp(slug) or ""):
        if os.path.exists(cand):
            base = json.load(open(cand))
            print(f"base: {os.path.relpath(cand, ROOT)}")
            break
    else:
        print(f"no map to corrupt for {slug}")
        return 2
    fields = [f for f in mapeval.WEIGHTS]
    rng = random.Random(11)

    print(f"{slug}: baseline")
    b = scores_of(slug, copy.deepcopy(base))
    print("   " + "  ".join(f"{k}={'--' if b[k] is None else format(b[k],'.2f')}" for k in fields))

    rows = {}
    for f in fields:
        rows[f] = scores_of(slug, corrupt(base, f, rng))

    w = max(len(f) for f in fields)
    print(f"\ndrop in each check when one field is corrupted")
    print(" " * (w + 8) + "  ".join(f"{k[:5]:>5}" for k in fields))
    diag, off = {}, {}
    for f in fields:
        cells = []
        for k in fields:
            if b[k] is None or rows[f][k] is None:
                cells.append("    -"); continue
            d = b[k] - rows[f][k]
            cells.append(f"{d:+5.2f}")
            if k == f: diag[f] = d
            # Contamination of check k is what OTHER fields do to it -- the COLUMN,
            # not the row. I first accumulated by row, which measures how much
            # breaking field f disturbs everyone else, and labelled it as check f
            # being contaminated. Opposite thing. Caught by this tool on its first
            # run, which is the argument for having it.
            else: off.setdefault(k, []).append((abs(d), f))
        print(f"  broke {f:<{w}}  " + "  ".join(cells))

    print("\nsensitivity and specificity")
    for f in fields:
        d = diag.get(f, 0.0)
        others = off.get(f, [(0.0, "-")])
        o, who = max(others)
        verdict = ("BROKEN -- corrupting its own field made the score go UP" if d < -0.02
                   else "blind -- its own field barely moves it" if d < 0.10
                   else f"contaminated by {who}" if o > d * 0.8
                   else "ok")
        print(f"   {f:<{w}}  own {d:+.2f}   worst other {o:.2f} ({who})   {verdict}")

    print("\ndiscrimination -- does the check separate the maps we actually have?")
    maps = []
    for p in ([os.path.join(ROOT, "synth", "truth", slug + ".map.json")]
              + sorted(glob.glob(os.path.join(ROOT, "synth", "maps", "*", slug + ".map.json")))):
        if "_broken" in p: continue
        try: maps.append(scores_of(slug, json.load(open(p))))
        except Exception: pass
    for f in fields:
        vals = [s[f] for s in maps if s.get(f) is not None]
        if len(vals) < 2:
            print(f"   {f:<{w}}  only {len(vals)} map(s) claim it"); continue
        spread = max(vals) - min(vals)
        print(f"   {f:<{w}}  spread {spread:.2f} over {len(vals)} maps"
              + ("   <-- carries no information" if spread < 0.06 else ""))

    print("\nanchoring -- the most external thing each check touches")
    for f in fields:
        kind, what = ANCHOR.get(f, ("?", "?"))
        flag = "  <-- INTERNAL, cannot count as evidence" if kind == "map" else ""
        print(f"   {f:<{w}}  {kind:<10} {what}{flag}")


if __name__ == "__main__":
    main()
