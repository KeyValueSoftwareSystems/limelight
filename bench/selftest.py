#!/usr/bin/env python3
"""Does the bench actually measure what it claims?

    python3 bench/selftest.py

Takes one map, calls it truth, then breaks it in ten specific ways and checks
the bench notices each one. No audio and no model involved, so this runs
anywhere in under a second.

Read the table it prints before you trust a single number the bench gives you
about a real model. It is also the fastest way to learn what each metric is
blind to -- note that a 30 ms jitter is invisible, by design.
"""
import json, copy, random, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bench

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "maps", "sketch", "the-nights.map.json")

def mut(m, fn):
    c = copy.deepcopy(m); fn(c)
    c["made_by"] = {"how": "sketch", "who": "selftest", "when": "2026-09-02"}
    return c

def jitter(amp, seed):
    def f(c):
        r = random.Random(seed)
        c["beats"] = [round(b + r.uniform(-amp, amp), 4) for b in c["beats"]]
        c["beats"].sort()
        bs = set(c["beats"])
        c["downbeats"] = [c["beats"][i] for i in range(0, len(c["beats"]), 4)]
    return f

def half(c):
    c["beats"] = c["beats"][::2]
    c["downbeats"] = c["beats"][::2]

def shift_bounds(dt):
    def f(c):
        for ch in c["chapters"][1:]: ch["at"] = round(ch["at"] + dt, 3)
    return f

def shrink_spans(frac):
    def f(c):
        for s in c["spans"]:
            mid = (s["from"] + s["to"]) / 2; half_w = (s["to"] - s["from"]) * frac / 2
            s["from"], s["to"] = round(mid - half_w, 3), round(mid + half_w, 3)
    return f

def swap_rise(c):
    for s in c["spans"]:
        s["rise"] = "late" if s["rise"] == "steady" else "steady"

def flat_energy(c):
    c["energy"] = [[t, 0.5] for t, _ in c["energy"]]

def invert_energy(c):
    c["energy"] = [[t, round(1.0 - v, 3)] for t, v in c["energy"]]

def drop_a_moment(c):
    c["moments"] = [m for m in c["moments"] if not (m["kind"] == "drop" and m["at"] == 112.0)]

def add_false_moment(c):
    c["moments"] = sorted(c["moments"] + [{"at": 88.0, "kind": "drop", "size": 0.7}], key=lambda x: x["at"])

CASES = [
  ("identical",          lambda c: None,          "everything 1.000. If not, the bench is broken"),
  ("beats jitter 30ms",  jitter(0.030, 1),        "beats F stays high -- 30 ms is inside the 70 ms tolerance"),
  ("beats jitter 120ms", jitter(0.120, 2),        "beats F collapses. This is the edge of audible"),
  ("half tempo",         half,                    "octave warning fires; recall halves"),
  ("chapters +2.0s",     shift_bounds(2.0),       "F at 0.5s near zero, F at 3.0s near one. Two tolerances, two verdicts"),
  ("spans shrunk 60%",   shrink_spans(0.4),       "IoU below the 0.70 pass bar"),
  ("rise shape swapped", swap_rise,               "IoU perfect, rise wrong. Position is not shape"),
  ("energy flat",        flat_energy,             "correlation undefined -- a flat curve has no direction"),
  ("energy inverted",    invert_energy,           "r near -1.0. The curve is there and it is backwards"),
  ("one drop removed",   drop_a_moment,           "one MISSED. The most expensive error in the room"),
  ("one drop invented",  add_false_moment,        "one false alarm. Cheap on the bench, brutal in a club"),
]

def main():
    truth = json.load(open(BASE))
    truth["made_by"] = {"how": "sketch", "who": "selftest-as-truth", "when": "2026-09-02"}
    print(f"\n  base map: {truth['song']['title']}  ·  {len(truth['beats'])} beats  "
          f"·  {len(truth['spans'])} spans  ·  {len(truth['moments'])} moments")
    print("  NOTE: this 'truth' is a sketch standing in for a truth file. It tests the bench, not a model.\n")
    print(f"  {'break':<20} {'beat F':>7} {'db F':>6} {'b@0.5':>6} {'b@3.0':>6} "
          f"{'mom':>7} {'false':>6} {'span':>6} {'energy r':>9}   what to notice")
    print("  " + "-" * 148)
    for name, fn, note in CASES:
        cand = mut(truth, fn)
        r = bench.run(truth, cand, quiet=True)
        er = "  n/a" if r["energy_r"] is None else f"{r['energy_r']:5.2f}"
        print(f"  {name:<20} {r['beats_f']:7.3f} {r['downbeats_f']:6.3f} "
              f"{r['boundary_f'][0]:6.3f} {r['boundary_f'][1]:6.3f} "
              f"{str(r['moments_hit'])+'/'+str(r['moments_total']):>7} {r['moments_false']:6d} "
              f"{str(r['spans_ok'])+'/'+str(r['spans_total']):>6} {er:>9}   {note}")
    print()

if __name__ == "__main__":
    main()
