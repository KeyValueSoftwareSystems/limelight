#!/usr/bin/env python3
"""The plan, before any frames: what I heard, what I have, how I will spend it.

Renjith, 9 Sept: "if there is a way for me to verify the pre-flight, to make sure
the agent figured out how to use the rig well beforehand and how well it
understood the song beforehand, it would really help."

pre-flight answers yes/no per dimension. This answers the question above it --
WHICH capability carries WHICH dimension, and whether anything is idle or
overdriven. It exists because the alternative was Renjith reacting to finished
frames and me swinging between extremes on his last sentence.

The allocation is arithmetic, not taste. Every dimension has a measured rate.
Every capability has a resolution -- how many distinct states it can show per
second before it stops reading. Match them:

    a 2.13/s pulse needs a capability with many states per second   -> intensity
    a 0.54/s "how much is playing" needs a few states per second    -> extent
    a 0.01/s build can live on three positions                      -> place

Get that wrong in either direction and it looks bad for a reason you can name: a
slow capability driven fast flickers; a fast capability driven slow is wasted.

    python3 readers/lights/plan.py levels --rig three
"""
import sys, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# How fast a capability can change before it stops reading as a change. These are
# perceptual ceilings, not electrical ones -- a par can strobe at 20 Hz and a room
# cannot count it.
def resolution(n_lit, span_ok, has_strobe, out_hz):
    return {
      "intensity": (out_hz,      f"{n_lit} lamps, continuous"),
      "extent":    (1.0,         f"{n_lit} lamps -> {n_lit+1} countable states"),
      "hue":       (2.0,         f"{n_lit} lamps, continuous, but a room reads ~2 changes/s"),
      "place":     (0.5 if span_ok else 0.0,
                                 f"{n_lit} positions" + ("" if span_ok else " -- clustered, unusable")),
      "time":      (out_hz,      f"one frame is {1000.0/out_hz:.1f} ms"),
      "focus":     (0.5,         "one lamp brighter than the rest"),
      "shock":     (0.5 if has_strobe else 0.0,
                                 "a strobe" if has_strobe else "none on this rig"),
      "memory":    (0.1,         "repeat a look when the song repeats"),
    }

def compute(slug, rig, xs=None, zs=None, map_path=None):
    """The plan as data, so a page can recompute it while lamps are dragged.
       xs/zs override the layout's own positions without writing to disk.
       map_path is the score being examined -- the pre-flight has to run on the
       map you are looking at, not on a hard-coded one, or it is answering about
       somebody else's work."""
    dp = os.path.join(ROOT, "synth", "dimensions", slug + ".dimensions.json")
    lp = os.path.join(ROOT, "readers", "lights", rig, "layout.json")
    mp = map_path if (map_path and os.path.exists(map_path)) else None
    if not mp:
        mp = next((c for c in (os.path.join(ROOT,"synth","maps","amal",slug+".map.json"),
                               os.path.join(ROOT,"synth","truth",slug+".map.json"))
                   if os.path.exists(c)), None)
    if not (os.path.exists(dp) and os.path.exists(lp) and mp):
        return {"error": "need a map, its dimensions, and a layout"}
    dims = json.load(open(dp))["dimensions"]
    nm   = json.load(open(dp)).get("not_measured") or []
    lay  = json.load(open(lp)); m = json.load(open(mp))
    pars = [f for f in lay["fixtures"] if f.get("kind") == "par"]
    for i, f in enumerate(pars):                       # apply the drag
        if xs and i < len(xs): f["at"][0] = float(xs[i])
        if zs and i < len(zs): f["at"][2] = float(zs[i])
    n = len(pars)
    px = [f["at"][0] for f in pars if f.get("at")]
    pz = [f["at"][2] for f in pars if f.get("at")]
    span = (max(px)-min(px)) if len(px) > 1 else 0.0
    depth = (max(pz)-min(pz)) if len(pz) > 1 else 0.0
    room = (lay.get("size_m") or {}).get("w", 0) or 1
    span_ok = span >= room * 0.35 and n >= 3
    caps = set()
    for f in lay["fixtures"]: caps.update(f.get("can") or [])
    out_hz = (lay.get("limits") or {}).get("output_hz", 44.0)
    RES = resolution(n, span_ok, "strobe" in caps, out_hz)

    # nearest-neighbour distance: two lamps in the same place are one lamp
    close = None
    for i in range(len(px)):
        for j in range(i+1, len(px)):
            d = ((px[i]-px[j])**2 + (pz[i]-pz[j])**2) ** 0.5
            if close is None or d < close: close = d

    rows, used, unpayable = [], {}, []
    for d in dims:
        chans = d["channel"].split("+")
        rate = d.get("rate_hz") or 0.0
        fit = [c for c in chans if RES.get(c, (0,""))[0] >= max(rate, 0.001)]
        if not fit:
            unpayable.append({"key": d["key"], "rate": rate, "wants": "+".join(chans)})
            continue
        pick = min(fit, key=lambda c: RES[c][0])
        ceil = RES[pick][0]
        used.setdefault(pick, []).append(d["key"])
        rows.append({"key": d["key"], "rate": rate, "on": pick, "ceiling": ceil,
                     "headroom": (ceil/rate) if rate > 0 else None,
                     "tight": bool(rate > 0 and ceil/rate < 2)})
    idle = [k for k in ("intensity","extent","hue","place","focus","shock")
            if RES[k][0] > 0 and k not in used]
    fixes = []
    for cap in idle:
        for u in nm:
            if u.get("channel") == cap:
                fixes.append({"cap": cap, "measure": u["key"], "what": u["what"]})
    g = m["grid"]; mo = m.get("moments") or []
    return {
      "song": slug, "rig": rig, "map_file": os.path.basename(mp),
      "heard": {"bpm": g["bpm"], "period": g["period"], "length": m["song"]["length"],
                "drops": [x["at"] for x in mo if x.get("kind") == "drop"],
                "chapters": len(m.get("chapters") or [])},
      "geometry": {"n": n, "span": round(span,2), "depth": round(depth,2),
                   "room_w": room, "row": span_ok,
                   "closest_pair": round(close,2) if close is not None else None},
      "resolution": {k: {"hz": v[0], "what": v[1]} for k, v in RES.items()},
      "rows": rows, "idle": idle, "unpayable": unpayable, "fixes": fixes,
      "positions": [[round(f["at"][0],2), round(f["at"][2],2)] for f in pars],
    }


def main(slug, rig):
    dp = os.path.join(ROOT, "synth", "dimensions", slug + ".dimensions.json")
    lp = os.path.join(ROOT, "readers", "lights", rig, "layout.json")
    mp = None
    for c in (os.path.join(ROOT, "synth", "maps", "amal", slug + ".map.json"),
              os.path.join(ROOT, "synth", "truth", slug + ".map.json")):
        if os.path.exists(c): mp = c; break
    if not (os.path.exists(dp) and os.path.exists(lp) and mp):
        print("  need a map, its dimensions, and a layout"); return
    dims = json.load(open(dp))["dimensions"]
    lay  = json.load(open(lp)); m = json.load(open(mp))

    pars = [f for f in lay["fixtures"] if f.get("kind") == "par"]
    n = len(pars)
    xs = sorted(f["at"][0] for f in pars if f.get("at"))
    span = (xs[-1] - xs[0]) if len(xs) > 1 else 0.0
    room = (lay.get("size_m") or {}).get("w", 0) or 1
    span_ok = span >= room * 0.35 and n >= 3
    caps = set()
    for f in lay["fixtures"]: caps.update(f.get("can") or [])
    has_strobe = "strobe" in caps
    out_hz = (lay.get("limits") or {}).get("output_hz", 44.0)
    RES = resolution(n, span_ok, has_strobe, out_hz)

    # ---- what I heard ------------------------------------------------------
    g = m["grid"]; dur = m["song"]["length"]
    mo = m.get("moments") or []
    drops = [x["at"] for x in mo if x.get("kind") == "drop"]
    print(f"\n  WHAT I HEARD  -- {slug}")
    print(f"    {g['bpm']:.1f} bpm, a beat every {g['period']:.3f} s, {dur:.0f} s long")
    print(f"    {len(drops)} drops: " + " ".join(f"{d:.1f}" for d in drops[:6]))
    print(f"    {len(m.get('chapters') or [])} chapters, "
          f"{len([x for x in mo if x.get('kind')=='quiet'])} quiet moments")

    # ---- what I have -------------------------------------------------------
    print(f"\n  WHAT I HAVE  -- {rig}: {n} pars, {span:.1f} m of a {room:.1f} m room")
    for k in ("intensity","extent","hue","place","focus","shock"):
        r, what = RES[k]
        flag = "" if r > 0 else "   <- not available"
        print(f"    {k:10} {('%.1f/s' % r) if r else '  --  ':>8}   {what}{flag}")

    # ---- the allocation ----------------------------------------------------
    print(f"\n  HOW I WILL SPEND IT")
    print(f"    {'dimension':10} {'needs':>8}  {'on':10} {'ceiling':>8}  headroom")
    used, unplaceable = {}, []
    for d in dims:
        chans = d["channel"].split("+")
        rate = d.get("rate_hz") or 0.0
        # the cheapest capability that can still carry this rate
        fit = [c for c in chans if RES.get(c, (0,""))[0] >= max(rate, 0.001)]
        if not fit:
            unplaceable.append((d["key"], rate, "+".join(chans))); continue
        pick = min(fit, key=lambda c: RES[c][0])          # scarce first, so fast
        ceil = RES[pick][0]                                # capability stays free
        used.setdefault(pick, []).append(d["key"])
        if rate <= 0:                      # a one-off, not a rate: headroom is moot
            print(f"    {d['key']:10} {'one-off':>8}  {pick:10} {ceil:7.1f}/s  {'--':>7}")
            continue
        head = ceil / rate
        warn = "   TIGHT" if head < 2 else ""
        print(f"    {d['key']:10} {rate:7.2f}/s  {pick:10} {ceil:7.1f}/s  {head:6.1f}x{warn}")
    for k, rate, ch in unplaceable:
        print(f"    {k:10} {rate:7.2f}/s  {'--':10} {'':>8}   NOTHING on this rig can carry {ch}")

    # ---- utilisation -------------------------------------------------------
    print(f"\n  UTILISATION")
    idle = [k for k in ("intensity","extent","hue","place","focus","shock")
            if RES[k][0] > 0 and k not in used]
    for k, ds in used.items():
        print(f"    {k:10} carries {', '.join(ds)}")
    print(f"    idle       {', '.join(idle) if idle else 'nothing -- every capability has a job'}")
    if idle:
        nm = json.load(open(dp)).get("not_measured") or []
        for cap in idle:
            want = [u for u in nm if u.get("channel") == cap]
            for u in want:
                print(f"      -> {cap} would have a job if we measured "
                      f"`{u['key']}` ({u['what']})")
    if unplaceable:
        print(f"    unpayable  {', '.join(k for k,_,_ in unplaceable)}")
    print(f"\n  Verify two things: that WHAT I HEARD matches the record, and that")
    print(f"  nothing in HOW I WILL SPEND IT is idle or marked TIGHT.\n")

if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    rig = sys.argv[sys.argv.index("--rig")+1] if "--rig" in sys.argv else "three"
    main(a[0] if a else "levels", rig)
