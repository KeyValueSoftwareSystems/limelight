#!/usr/bin/env python3
"""The execution plan: what the rig will do, section by section, before it runs.

Renjith, 9 Sept: "this is like a query planner ... it's actually a plan upfront,
including sections, and how it's going to end up. What you have done in preflight
is not the same thing."

Correct. plan.py is a capability INVENTORY -- it says the beat goes on brightness
at 2.13 a second. It never says what happens at 19.9 s. This says that.

A database planner emits an ordered set of operations with costs before touching a
row, and you can read it. Same shape here: one row per section of the song, each
naming which lamps are involved, how bright, which of the song's two colour worlds,
what gesture, and WHY -- the field in the map that justifies it. Then the recipe
executes this rather than deciding for itself, which is what makes the plan honest
rather than a description written after the fact.

    python3 readers/lights/showplan.py levels --rig three
"""
import sys, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _en_at(en, t):
    if not en: return 0.5
    g = lambda i: en[i] if isinstance(en[i], list) else [en[i]["at"], en[i]["v"]]
    k = -1
    for i in range(len(en)):
        if g(i)[0] <= t: k = i
        else: break
    if k < 0: return g(0)[1]
    t0, v0 = g(k)
    if k + 1 >= len(en): return v0
    t1, v1 = g(k + 1)
    u = (t - t0) / (t1 - t0) if t1 > t0 else 0
    return v0 + (v1 - v0) * max(0.0, min(1.0, u))


def compute(slug, rig="three", xs=None):
    lp = os.path.join(ROOT, "readers", "lights", rig, "layout.json")
    mp = next((c for c in (os.path.join(ROOT,"synth","maps","amal",slug+".map.json"),
                           os.path.join(ROOT,"synth","truth",slug+".map.json"))
               if os.path.exists(c)), None)
    if not (os.path.exists(lp) and mp):
        return {"error": "need a map and a layout"}
    lay = json.load(open(lp)); m = json.load(open(mp))
    pars = [f for f in lay["fixtures"] if f.get("kind") == "par"]
    for i, f in enumerate(pars):
        if xs and i < len(xs): f["at"][0] = float(xs[i])
    n = len(pars)
    px = [f["at"][0] for f in pars if f.get("at")]
    span = (max(px) - min(px)) if len(px) > 1 else 0.0
    room = (lay.get("size_m") or {}).get("w", 0) or 1
    row = span >= room * 0.35 and n >= 3

    g = m["grid"]; per = g["period"]; bar = 4 * per; dur = m["song"]["length"]
    en = m.get("energy") or []
    ent = lambda o: o if isinstance(o, list) else ((o or {}).get("entries") or [])
    chs = ent(m.get("chapters"))
    mo  = ent(m.get("moments"))
    hits = sorted(x["at"] for x in mo if x.get("kind") in ("drop", "stop"))

    # the peak, from the energy the map already carries -- the structural scalar
    phrase = 8 * bar
    blocks = [(t, _en_at(en, t + phrase / 2)) for t in
              [i * phrase for i in range(max(1, int(dur // phrase)))]]
    peak_t = max(blocks, key=lambda b: b[1])[0] if blocks else 0.0
    reach = max(phrase, max(peak_t, dur - peak_t))
    arc = lambda t: max(0.18, 1 - 0.82 * min(1.0, abs(t - peak_t) / reach))

    rows = []
    for i, c in enumerate(chs):
        t0 = c.get("at", c.get("t")) or 0.0
        t1 = (chs[i+1].get("at", chs[i+1].get("t")) if i + 1 < len(chs) else dur)
        name = c.get("name") or "part"
        e = _en_at(en, (t0 + t1) / 2)
        a = arc(t0)
        after = t0 > peak_t
        # Events INSIDE a section are their own rows, not a property of the whole
        # section. Reading the first draft caught this: a 9-bar break containing a
        # drop was given the drop's gesture for all nine bars, while the section
        # actually named "drop" got the ordinary one because the hit sat just
        # outside it. A drop is an instant; a section is a stretch.
        ev = [{"at": round(x["at"], 2), "kind": x["kind"],
               "gesture": ("all three, full, after a 2-beat gap" if x["kind"] == "drop"
                           else "everything to zero")}
              for x in mo if x.get("kind") in ("drop", "stop") and t0 <= x["at"] < t1]
        hits_here = [e["at"] for e in ev]

        # --- the decisions, and each one names the field that justifies it ------
        if name == "stop":        lit, why = 0, "moments: a stop"
        elif name == "quiet":     lit, why = 1, "chapters: quiet"
        elif e > 0.55 or name in ("drop","build","chorus"): lit, why = min(n,3), f"energy {e:.2f}"
        elif e > 0.28:            lit, why = min(n,2), f"energy {e:.2f}"
        else:                     lit, why = 1, f"energy {e:.2f}"

        bed  = {"intro":0.06,"verse":0.10,"break":0.03,"build":0.13,"drop":0.16,
                "quiet":0.02,"stop":0.0,"outro":0.08,"chorus":0.14}.get(name, 0.08)
        bed *= (0.45 + 0.55 * a)
        gain = {"intro":0.55,"verse":0.88,"break":0.45,"build":0.95,"drop":1.0,
                "quiet":0.55,"stop":0.0,"outro":0.62,"chorus":1.0}.get(name, 0.80)
        gain *= (0.78 + 0.22 * a)
        world = "warm" if name in ("drop","build","chorus","outro") else "cool"
        if after: world += " (warmer, post-peak)"
        gesture = ("pair split apart"   if name == "build" and row
                   else "one lamp only"      if lit == 1
                   else "blackout"           if lit == 0
                   else "pair holds, centre pulses")

        rows.append({
          "i": i, "name": name, "at": round(t0, 2), "until": round(t1, 2),
          "bars": round((t1 - t0) / bar, 1), "energy": round(e, 3),
          "arc": round(a, 2), "post_peak": after,
          "lit": lit, "bed": round(min(1, bed), 3), "pulse": round(min(1, gain), 3),
          "world": world, "gesture": gesture, "events": ev,
          "why": why,
        })
    return {
      "song": slug, "rig": rig, "peak_at": round(peak_t, 1),
      "peak_from": "the map's energy curve (the audio itself says 210 s for Levels -- "
                   "the two disagree and the map is what the recipe reads)",
      "bar_s": round(bar, 4), "row": row, "span": round(span, 2), "lamps": n,
      "sections": rows,
      "note": "the recipe executes this; it does not decide for itself",
    }


if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    rig = sys.argv[sys.argv.index("--rig")+1] if "--rig" in sys.argv else "three"
    r = compute(a[0] if a else "levels", rig)
    if "error" in r: print("  " + r["error"]); sys.exit(1)
    print(f"\n  THE PLAN -- {r['song']} on {r['rig']}, {r['lamps']} lamps, "
          f"peak at {r['peak_at']} s, bar {r['bar_s']} s\n")
    print(f"  {'at':>7} {'bars':>5}  {'section':8} {'lit':>3} {'bed':>5} {'pulse':>5} "
          f"{'world':8} gesture")
    for s in r["sections"]:
        print(f"  {s['at']:7.1f} {s['bars']:5.1f}  {s['name']:8} {s['lit']:3d} "
              f"{s['bed']:5.2f} {s['pulse']:5.2f} {s['world'][:8]:8} {s['gesture']}"
              )
        for e in s["events"]:
            print(f"  {e['at']:7.1f} {'':5}    {'|-> '+e['kind']:12} {e['gesture']}")
    print()
