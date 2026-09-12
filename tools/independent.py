import json, pathlib
import numpy as np

rng = np.random.default_rng(7)
ROUNDS = 4000


def slope(v):
    if len(v) < 2:
        return 0.0
    k = max(1, len(v) // 3)
    return float(np.mean(v[-k:]) - np.mean(v[:k]))


rows = []
for f in sorted(pathlib.Path("scores").glob("*.score")):
    d = json.load(open(f))
    B = d["bars"]
    base = d["grid"]["first_bar"]
    here = []
    for q in d.get("phrases", []):
        lo, hi = q["from_bar"] - base, q["to_bar"] - base + 1
        if hi - lo < 2:
            continue
        def lane(k):
            v = B.get(k) or []
            v = [x if x is not None else 0.0 for x in v[lo:hi]]
            return np.asarray(v, dtype=float)
        w, p, cs = lane("width"), lane("pump"), lane("chord_sure")
        ch = (B.get("chord") or [])[lo:hi]
        turns = sum(1 for i in range(1, len(ch)) if ch[i] and ch[i] != ch[i - 1])
        if not len(w) or not len(p):
            continue
        here.append({
            "doing": q["doing"], "song": f.stem,
            "width_mean": float(w.mean()), "width_slope": slope(w),
            "width_range": float(w.max() - w.min()),
            "pump_mean": float(p.mean()), "pump_slope": slope(p),
            "harm_rate": turns / max(1, hi - lo),
            "harm_sure": float(cs.mean()),
        })
    keys = [k for k in (here[0] if here else {}) if k not in ("doing", "song")]
    for k in keys:
        col = np.asarray([h[k] for h in here], dtype=float)
        sd = col.std() or 1.0
        for h, z in zip(here, (col - col.mean()) / sd):
            h[k] = float(z)
    rows += here

keys = ["width_mean", "width_slope", "width_range",
        "pump_mean", "pump_slope", "harm_rate", "harm_sure"]
names = sorted({r["doing"] for r in rows})
data = {k: np.asarray([r[k] for r in rows]) for k in keys}
print(f"{len(rows)} subsections, {len(names)} behaviours, "
      f"{len(keys)} independent features, {ROUNDS} permutations\n")
print(f"{'behaviour':15} {'n':>4}  {'best independent feature':28} {'effect':>7} {'p':>7}")
verdict = {}
for nm in names:
    mask = np.asarray([r["doing"] == nm for r in rows])
    n = int(mask.sum())
    best = (1.0, None, 0.0)
    for k in keys:
        v = data[k]
        real = abs(v[mask].mean() - v[~mask].mean())
        hits = 0
        for _ in range(ROUNDS):
            sh = rng.permutation(mask)
            if abs(v[sh].mean() - v[~sh].mean()) >= real:
                hits += 1
        p = (hits + 1) / (ROUNDS + 1)
        if p < best[0]:
            best = (p, k, real)
    p, k, eff = best
    verdict[nm] = (n, k, eff, p)
    mark = "  <-- survives" if p < 0.01 else ("  weak" if p < 0.05 else "  PREDICTS NOTHING")
    print(f"{nm:15} {n:>4}  {str(k):28} {eff:7.3f} {p:7.4f}{mark}")
