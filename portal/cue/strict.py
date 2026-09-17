import json
import sys

from pattern import classify, perceived


def head_of(show):
    for f in show["fixtures"]:
        if not f["type"].startswith("par"):
            return f["address"] - 1
    return None


def lamp_offsets(show):
    return [f["address"] - 1 for f in show["fixtures"] if f["type"].startswith("par")]


def settled_runs(kinds):
    runs = []
    i = 0
    n = len(kinds)
    while i < n:
        if kinds[i] == "UNPATTERNED":
            i += 1
            continue
        j = i
        while j + 1 < n and kinds[j + 1] == kinds[i]:
            j += 1
        runs.append((i, j, kinds[i]))
        i = j + 1
    return runs


def blend_ok(levels, a, b):
    if b - a < 2:
        return True
    for k in range(len(levels[a])):
        seq = [levels[t][k] for t in range(a, b + 1)]
        tol = max(3.0, (max(seq) - min(seq)) * 0.06)
        rise = all(seq[t + 1] >= seq[t] - tol for t in range(len(seq) - 1))
        fall = all(seq[t + 1] <= seq[t] + tol for t in range(len(seq) - 1))
        if not (rise or fall):
            return False
    return True


def scan(lights, slew_pad=1):
    show = json.load(open(lights))
    frames = show["frames"]
    fps = show.get("fps", 40)
    off = lamp_offsets(show)
    head = head_of(show)
    lev = [[perceived(f, o) for o in off] for f in frames]
    kinds = [classify(v) for v in lev]
    n = len(frames)

    bumped = [False] * n
    for a in (show.get("accents") or []):
        t0 = float(a.get("t", 0))
        decay = float(a.get("decay", 0.22))
        i0 = max(0, int(t0 * fps) - 1)
        i1 = min(n, int((t0 + decay * 1.2) * fps) + 2)
        for t in range(i0, i1):
            bumped[t] = True
    for t in range(n):
        if kinds[t] != "UNPATTERNED" or not bumped[t]:
            continue
        v = lev[t]
        top = max(range(len(v)), key=lambda k: v[k])
        rest = [v[k] for k in range(len(v)) if k != top]
        if rest and classify(rest) != "UNPATTERNED" and v[top] >= max(rest) - 1:
            kinds[t] = "bumped"

    bad_shape = []
    i = 0
    while i < n:
        if kinds[i] != "UNPATTERNED":
            i += 1
            continue
        j = i
        while j < n and kinds[j] == "UNPATTERNED":
            j += 1
        a = i - 1
        b = j
        if a < 0 or b >= n or not blend_ok(lev, a, min(b, n - 1)):
            bad_shape.append((i / fps, (j - i) / fps))
        i = j

    limits = show.get("limits") or {}
    max_pan = limits.get("max_pan_per_frame") or 7
    max_tilt = limits.get("max_tilt_per_frame") or 7
    bad_head = []
    if head is not None:
        pan = [f[head] for f in frames]
        tilt = [f[head + 2] for f in frames]
        for name, seq, cap in (("pan", pan, max_pan), ("tilt", tilt, max_tilt)):
            for t in range(1, n):
                d = abs(seq[t] - seq[t - 1])
                if d > cap + slew_pad:
                    bad_head.append((t / fps, "%s jumps %d in one frame" % (name, d)))
            turns = 0
            start = 0
            for t in range(2, n):
                d0 = seq[t - 1] - seq[t - 2]
                d1 = seq[t] - seq[t - 1]
                if abs(d0) >= 2 and abs(d1) >= 2 and d0 * d1 < 0:
                    if turns == 0:
                        start = t
                    turns += 1
                elif turns:
                    if turns >= 3 and (t - start) / fps < 1.0:
                        bad_head.append((start / fps, "%s reverses %d times in %.2fs"
                                         % (name, turns, (t - start) / fps)))
                    turns = 0
    return {"frames": n, "fps": fps, "bad_shape": bad_shape, "bad_head": bad_head,
            "kinds": kinds}


def main():
    song = sys.argv[1] if len(sys.argv) > 1 else "raga-of-revenge"
    lights = sys.argv[2] if len(sys.argv) > 2 else "/tmp/%s.cuelights.json" % song
    r = scan(lights)
    n = r["frames"]
    unp = sum(1 for k in r["kinds"] if k == "UNPATTERNED")
    print("  %s: %d frames at %d fps" % (song, n, r["fps"]))
    print("    frames not in a named shape      : %d (%.2f%%)" % (unp, unp / n * 100))
    print("    of those, not a clean transition : %d stretches" % len(r["bad_shape"]))
    for t, d in r["bad_shape"][:8]:
        print("        %7.2fs  %.0fms unaccounted" % (t, d * 1000))
    print("    head movements without a pattern : %d" % len(r["bad_head"]))
    for t, w in r["bad_head"][:8]:
        print("        %7.2fs  %s" % (t, w))
    return 1 if (r["bad_shape"] or r["bad_head"]) else 0


if __name__ == "__main__":
    sys.exit(main())
