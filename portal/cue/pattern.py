import json
import os
import sys
from collections import Counter

SHAPES = {
    (0,): "solo", (1,): "solo", (2,): "solo", (3,): "solo",
    (0, 1): "half", (2, 3): "half", (1, 2): "inner", (0, 3): "outer",
    (0, 2): "alternate", (1, 3): "alternate",
    (0, 1, 2): "three", (1, 2, 3): "three", (0, 1, 3): "three", (0, 2, 3): "three",
}


def perceived(frame, off):
    v = (frame[off + 1] * 0.299 + frame[off + 2] * 0.587 + frame[off + 3] * 0.114) * (
        frame[off] / 255.0
    )
    return (max(v, 0.0) / 255.0) ** 0.625 * 255.0


def rungs(v, tol):
    out = []
    for x in sorted(v, reverse=True):
        if not out or out[-1] - x > tol:
            out.append(x)
    return out


def classify(v):
    mx = max(v)
    if mx < 6:
        return "dark"
    tol = max(5.0, mx * 0.10)
    rg = rungs(v, tol)
    if len(rg) == 1:
        return "flat"
    if len(rg) == 2:
        hi = tuple(i for i, x in enumerate(v) if x >= rg[0] - tol)
        return SHAPES.get(hi, "UNPATTERNED")
    n = len(v)
    d = [v[i + 1] - v[i] for i in range(n - 1)]
    if all(x > 0 for x in d) or all(x < 0 for x in d):
        return "ramp"
    if n == 4 and abs(v[0] - v[3]) <= tol and abs(v[1] - v[2]) <= tol:
        return "mirror"
    if n == 4 and abs(v[0] - v[1]) <= tol and abs(v[2] - v[3]) <= tol:
        return "halves"
    peak = v.index(mx)
    rise = all(v[i] <= v[i + 1] + tol for i in range(peak))
    fall = all(v[i] >= v[i + 1] - tol for i in range(peak, n - 1))
    if rise and fall:
        return "peak"
    return "UNPATTERNED"


def scan(lights, step=0.1):
    show = json.load(open(lights))
    frames = show["frames"]
    fps = show.get("fps", 40)
    off = [f["address"] - 1 for f in show["fixtures"] if f["type"].startswith("par")]
    heads = [f["address"] - 1 for f in show["fixtures"] if not f["type"].startswith("par")]
    rows = []
    t = 0.0
    while t < show["duration"]:
        f = frames[min(len(frames) - 1, int(round(t * fps)))]
        v = [perceived(f, o) for o in off]
        h = (f[heads[0]], f[heads[0] + 2]) if heads else (0, 0)
        rows.append((round(t, 2), v, h, classify(v)))
        t += step
    return rows


def main():
    song = sys.argv[1] if len(sys.argv) > 1 else "raga-of-revenge"
    lights = sys.argv[2] if len(sys.argv) > 2 else "/tmp/%s.cuelights.json" % song
    rows = scan(lights)
    tot = len(rows)
    counts = Counter(r[3] for r in rows)
    print("  %d samples at 100ms, %s" % (tot, song))
    for k, n in counts.most_common():
        print("    %-12s %5d  %5.1f%%" % (k, n, n / tot * 100.0))
    bad = [r for r in rows if r[3] == "UNPATTERNED"]
    if not bad:
        print("\n  every sample is a shape a designer could name")
        return
    print("\n  unpatterned samples:")
    for t, v, h, _ in bad[:30]:
        print("    %7.2fs  " % t + "  ".join("%5.1f" % x for x in v)
              + "   head %3d/%3d" % h)
    if len(bad) > 30:
        print("    ... and %d more" % (len(bad) - 30))
    runs = []
    cur = None
    for t, v, h, k in rows:
        if k == "UNPATTERNED":
            cur = [t, t] if cur is None else [cur[0], t]
        elif cur:
            runs.append(tuple(cur))
            cur = None
    if cur:
        runs.append(tuple(cur))
    print("\n  longest unpatterned stretches:")
    for a, b in sorted(runs, key=lambda r: -(r[1] - r[0]))[:10]:
        print("    %7.2fs - %7.2fs  (%.1fs)" % (a, b, b - a + 0.1))


if __name__ == "__main__":
    main()
