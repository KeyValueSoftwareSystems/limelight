#!/usr/bin/env python3
"""Do the chapter boundaries land where the music actually changes?

Two independent opinions about structure, which is the point:

  chapters            ear.py segments a bar-level feature profile
  observations.novelty a model measured frame-to-frame change in its own
                       embedding space and never saw ear.py's features

So this is not a thing graded against its own output. It is also not a verdict:
neither side is truth, and where they disagree it says only that one of them is
wrong, not which. Recorded so a reader knows how much to trust a boundary, and
so a listening session knows where to listen first.

Nothing here edits chapters. A model does not get to overwrite a measurement,
and two writers for one fact is how they start disagreeing (rule 8).
"""
import bisect, glob, json, os, statistics, sys


def peaks(at, val, keep=0.60):
    """Local maxima above a share of the song's own biggest change."""
    if not at or not val:
        return []
    top = max(val) or 1.0
    out = []
    for i in range(1, len(val) - 1):
        if val[i] >= val[i - 1] and val[i] > val[i + 1] and val[i] >= keep * top:
            out.append(at[i])
    return out


def nearest(xs, x):
    if not xs:
        return None
    i = bisect.bisect_left(xs, x)
    best = None
    for j in (i - 1, i, i + 1):
        if 0 <= j < len(xs):
            d = xs[j] - x
            if best is None or abs(d) < abs(best):
                best = d
    return best


def main(paths):
    print("  %-20s %7s %7s %9s %9s %8s" %
          ("song", "chaps", "peaks", "matched", "median s", "orphans"))
    for p in sorted(paths):
        m = json.load(open(p))
        name = os.path.basename(p)[: -len(".map.json")]
        nv = (m.get("observations") or {}).get("novelty") or {}
        at, val = nv.get("at") or [], nv.get("value") or []
        chaps = [c.get("at") for c in (m.get("chapters") or [])
                 if isinstance(c.get("at"), (int, float))]
        pk = peaks(at, val)
        if not pk or len(chaps) < 2:
            print("  %-20s %7d %7d       --        --       --" %
                  (name, len(chaps), len(pk)))
            continue
        grid = m.get("grid") or {}
        per = grid.get("period") or 0.5
        win = 2 * 4 * per                      # within two bars is the same event
        pk_s = sorted(pk)
        offs = [d for d in (nearest(pk_s, c) for c in chaps)
                if d is not None and abs(d) <= win]
        # a novelty peak with no chapter near it: the music changed and the map
        # did not say so
        orphans = [x for x in pk_s
                   if (nearest(sorted(chaps), x) is None
                       or abs(nearest(sorted(chaps), x)) > win)]
        print("  %-20s %7d %7d %8.0f%% %9.2f %8d" %
              (name, len(chaps), len(pk_s), 100.0 * len(offs) / len(chaps),
               statistics.median([abs(o) for o in offs]) if offs else float("nan"),
               len(orphans)))
        obs = m.setdefault("observations", {})
        obs["structure_check"] = {
            "between": "chapters and observations.novelty",
            "how": ("novelty local maxima at or above 60% of this song's biggest "
                    "change, matched to chapter boundaries within two bars"),
            "chapters": len(chaps),
            "novelty_peaks": len(pk_s),
            "chapters_matched": len(offs),
            "median_gap_s": round(statistics.median([abs(o) for o in offs]), 3) if offs else None,
            "novelty_peaks_with_no_chapter": len(orphans),
            "orphan_times": [round(x, 2) for x in orphans[:40]],
            "not": ("neither side is truth and this does not say which is wrong "
                    "where they disagree. chapters are not edited from this: a "
                    "model does not overwrite a measurement, and one fact keeps "
                    "one writer. A median gap of 0.00 s is NOT precision: "
                    "novelty is sampled per downbeat and chapters land on "
                    "downbeats, so both are already on the same grid and an "
                    "exact match is the only thing a hit can look like"),
        }
        json.dump(m, open(p, "w"), indent=1); open(p, "a").write("\n")
    print("\n  matched  = chapter boundaries that a novelty peak agrees with")
    print("  median s = do not read this as precision. Both sides sit on the")
    print("             downbeat grid already, so a hit can only be 0.00.")
    print("  orphans  = novelty peaks with no chapter near them: the music")
    print("             changed and the map did not say so. Those times are")
    print("             where a listening session should start.")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:]] or glob.glob("maps/model/*.map.json")
    main([a for a in args if "the-nights.map.json" not in a])
