#!/usr/bin/env python3
"""Does the beat grid sit where the drummer actually plays?

The grid comes from a tempo tracker reading the full mix. The kick onsets come
from a separated drum stem and a different onset detector. Two methods, so this
is not a thing being graded against its own output -- but they do share one
recording, and that is worth remembering before calling any of it truth.

A systematic offset is the interesting result. Scatter is the drummer; a mean
that sits off zero is the map being wrong in a way every reader inherits.
"""
import json, glob, os, statistics, sys

def near(sorted_xs, x):
    import bisect
    i = bisect.bisect_left(sorted_xs, x)
    best = None
    for j in (i-1, i, i+1):
        if 0 <= j < len(sorted_xs):
            d = sorted_xs[j] - x
            if best is None or abs(d) < abs(best): best = d
    return best

rows = []
for p in sorted(glob.glob("maps/model/*.map.json")):
    if ".sketch" in p: continue
    m = json.load(open(p))
    name = os.path.basename(p)[:-len(".map.json")]
    beats = m.get("beats") or []
    ev = (m.get("accents") or {}).get("events") or []
    kicks = sorted(a["at"] for a in ev if a.get("of") == "kick")
    if len(beats) < 8 or len(kicks) < 12:
        rows.append((name, len(beats), len(kicks), None, None, None)); continue
    # only beats that have a kick within a quarter of a beat: the rest are beats
    # the drummer did not play, and averaging those in measures nothing
    per = statistics.median(beats[i+1]-beats[i] for i in range(len(beats)-1))
    offs = []
    for b in beats:
        d = near(kicks, b)
        if d is not None and abs(d) <= per*0.25: offs.append(d)
    if len(offs) < 8:
        rows.append((name, len(beats), len(kicks), None, None, None)); continue
    rows.append((name, len(beats), len(kicks),
                 statistics.mean(offs)*1000, statistics.median(offs)*1000,
                 100.0*len(offs)/len(beats)))

print("  %-16s %6s %6s %9s %9s %8s" % ("song","beats","kicks","mean ms","median ms","covered"))
for n,nb,nk,mn,md,cov in rows:
    if mn is None:
        print("  %-16s %6d %6d       --        --       --   (too few paired hits)" % (n,nb,nk))
    else:
        flag = "  <-- systematic" if abs(mn) > 12 else ""
        print("  %-16s %6d %6d %9.1f %9.1f %7.0f%%%s" % (n,nb,nk,mn,md,cov,flag))
print("\n  negative = the grid fires BEFORE the drum. Scatter is the drummer;")
print("  a mean away from zero is the map being early or late for every reader.")
