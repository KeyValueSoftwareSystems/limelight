#!/usr/bin/env python3
"""Compare your frame stream against the golden one.

    python3 check.py expected/opus.frames.jsonl.gz mine/opus.frames.jsonl.gz

Stdlib only. Reads .jsonl or .jsonl.gz. Stops at the first real divergence and
tells you the time, the fixture and the field. Exit 0 means you are done.
"""
import json, gzip, sys

TOL = {"level": 0.01, "strobe": 0.05, "pan": 0.01, "tilt": 0.01, "rgb": 2}

def rows(p):
    op = gzip.open if p.endswith(".gz") else open
    with op(p, "rt") as fh:
        for n, line in enumerate(fh):
            line = line.strip()
            if line: yield n, json.loads(line)

def diff(a, b):
    if abs(a["t"] - b["t"]) > 1e-6: return f"t: expected {a['t']} got {b['t']}"
    if "look" in a and "look" in b and a["look"] != b["look"]:
        return f"look: expected {a['look']!r} got {b['look']!r}  <-- fix look selection before anything else"
    ea = {f["id"]: f for f in a["fixtures"]}
    eb = {f["id"]: f for f in b["fixtures"]}
    if set(ea) != set(eb):
        return f"fixture ids differ: missing {sorted(set(ea)-set(eb))} extra {sorted(set(eb)-set(ea))}"
    for fid, fa in ea.items():
        fb = eb[fid]
        for k in ("level", "strobe", "pan", "tilt"):
            if k in fa or k in fb:
                x, y = fa.get(k, 0.0), fb.get(k, 0.0)
                if abs(x - y) > TOL[k]: return f"{fid}.{k}: expected {x} got {y}"
        if any(c in fa for c in "rgb"):
            for c in "rgb":
                x, y = fa.get(c, 0), fb.get(c, 0)
                if abs(x - y) > TOL["rgb"]: return f"{fid}.{c}: expected {x} got {y}"
        if "pixels" in fa or "pixels" in fb:
            pa, pb = fa.get("pixels", []), fb.get("pixels", [])
            if len(pa) != len(pb): return f"{fid}.pixels: expected {len(pa)} px got {len(pb)}"
            for i, (qa, qb) in enumerate(zip(pa, pb)):
                for j, c in enumerate("rgb"):
                    if abs(qa[j] - qb[j]) > TOL["rgb"]:
                        return f"{fid}.pixels[{i}].{c}: expected {qa[j]} got {qb[j]}"
    return None

def main(gold, mine):
    g, m = rows(gold), rows(mine)
    checked = 0
    while True:
        ga = next(g, None); mb = next(m, None)
        if ga is None and mb is None: break
        if ga is None: print(f"FAIL  you produced extra frames past t={checked/40:.3f}"); return 1
        if mb is None: print(f"FAIL  your stream ends early, at frame {checked} (t={checked/40:.3f}); golden has more"); return 1
        d = diff(ga[1], mb[1])
        if d:
            print(f"FAIL  frame {checked}  t={ga[1]['t']}\n      {d}")
            print(f"\n      golden: {json.dumps(ga[1])[:400]}")
            print(f"      yours : {json.dumps(mb[1])[:400]}")
            return 1
        checked += 1
    print(f"PASS  {checked} frames identical within tolerance ({checked/40:.1f}s)")
    return 0

if __name__ == "__main__":
    if len(sys.argv) != 3: print(__doc__); sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
