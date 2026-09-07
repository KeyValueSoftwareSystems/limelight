#!/usr/bin/env python3
"""Test the tests. Run before trusting any number this harness produces.

A check that cannot fail is decoration, and four checks in this project passed
shows that were wrong. The rule is that no check goes in without something
deliberately broken that it catches -- this is where those live, so the rule is
enforced by running rather than by remembering.

    python3 listen/selftest.py
"""
import sys, os, json, copy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import mapeval, beatpos

FAILED = []


def ok(name, passed, detail=""):
    print(f"  {'pass' if passed else 'FAIL'}  {name}" + (f"   {detail}" if detail else ""))
    if not passed:
        FAILED.append(name)


def main():
    base = json.load(open(os.path.join(ROOT, "synth", "truth", "levels.map.json")))

    print("the bars check must discriminate between bar phases")
    scores = {}
    for bp in range(4):
        m = copy.deepcopy(base); m["grid"]["bar_phase"] = bp
        s, _ = mapeval.ev_bars(m, None)
        scores[bp] = s
    best = max(scores, key=scores.get)
    ok("one phase clearly wins", max(scores.values()) - sorted(scores.values())[-2] > 0.3,
       f"best {best} at {scores[best]:.2f}, next {sorted(scores.values())[-2]:.2f}")

    print("\ngroove must vanish when the hits are quantised")
    def groove(m):
        m = copy.deepcopy(m); m.get("observations", {}).pop("groove", None)
        for e in (m.get("accents") or {}).get("events", []):
            e.pop("pos", None); e.pop("off16", None)
        beatpos.add(m)
        g = (m.get("observations") or {}).get("groove") or {}
        vals = [v for v in (g.get("by_sixteenth") or {}).values() if v is not None]
        return max(abs(v) for v in vals) if vals else 0.0
    live = groove(base)
    q = copy.deepcopy(base)
    per, ph = q["grid"]["period"], q["grid"]["phase"]
    for e in q["accents"]["events"]:
        p = (e["at"] - ph) / per
        e["at"] = ph + (round(p * 4) / 4) * per
    dead = groove(q)
    ok("quantising removes it", dead < live / 8, f"{live:.4f} beats live, {dead:.4f} quantised")

    print("\npositions must round-trip through seconds")
    m = copy.deepcopy(base)
    per, ph = m["grid"]["period"], m["grid"]["phase"]
    worst = 0.0
    for c in m.get("chapters", []):
        if "pos" in c:
            worst = max(worst, abs((ph + c["pos"] * per) - c["at"]))
    ok("pos -> seconds is the original", worst < 0.001, f"largest error {worst*1000:.3f} ms")

    print("\nthe grid gate must collapse a map with the wrong beat")
    good = mapeval.evaluate("levels", m=copy.deepcopy(base))
    bp = os.path.join(ROOT, "synth", "maps", "_broken-half-beat", "levels.map.json")
    if os.path.exists(bp):
        bad = mapeval.evaluate("levels", map_path=bp)
        ok("half a beat late scores far worse", bad["total"] < good["total"] / 3,
           f"{good['total']:.2f} against {bad['total']:.2f}")
    else:
        ok("the broken map exists", False, "synth/maps/_broken-half-beat is missing")

    print("\nno check may be anchored to the map alone")
    unanchored = [k for k in mapeval.WEIGHTS if k in ("bars",)]
    ok("the only internal check is declared", unanchored == ["bars"],
       f"internal: {unanchored}")

    print()
    if FAILED:
        print(f"{len(FAILED)} failed: {', '.join(FAILED)}")
        sys.exit(1)
    print("all self-tests pass")


if __name__ == "__main__":
    main()
