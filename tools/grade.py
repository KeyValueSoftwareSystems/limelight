import json
import sys
from pathlib import Path

import mir_eval
import numpy as np


def spans(times, end):
    edges = [0.0] + [t for t in sorted(times) if 0 < t < end] + [end]
    return np.array([[edges[i], edges[i + 1]] for i in range(len(edges) - 1)])


def boundaries(score):
    g = score["grid"]
    bar = (60.0 / g["bpm"]) * g["beats_per_bar"]
    out = []
    for p in score["parts"][1:]:
        b = p["from_bar"]
        out.append(0.0 if b <= 0 else g["first_beat_s"] + (b - 1) * bar)
    return out


def main():
    slug = sys.argv[1] if len(sys.argv) > 1 else "levels"
    truth = json.loads(Path(f"truth/{slug}.parts.json").read_text())
    score = json.loads(Path(f"scores/{slug}.score").read_text())
    end = score["song"]["length_s"]

    ours = boundaries(score)
    theirs = sorted(truth["boundaries_said_right"] + truth["boundaries_said_missing"])

    ref = spans(theirs, end)
    est = spans(ours, end)

    for window in (0.5, 3.0):
        f, p, r = mir_eval.segment.detection(ref, est, window=window, trim=True)
        print(f"  within {window:>4.1f}s   F {f:.3f}   precision {p:.3f}   recall {r:.3f}")

    print()
    print("  what we said vs what you said")
    for t in theirs:
        near = min(ours, key=lambda x: abs(x - t)) if ours else None
        gap = abs(near - t) if near is not None else 999
        mark = "found" if gap < 3.0 else "MISSED"
        print(f"    yours {t:>7.1f}s   ours {near:>7.1f}s   {gap:>5.1f}s off   {mark}")
    judged = max(theirs) + 6.0
    extra = [o for o in ours if all(abs(o - t) >= 3.0 for t in theirs)]
    near = [o for o in extra if o < judged]
    for o in near:
        print(f"    yours     --      ours {o:>7.1f}s            EXTRA")
    beyond = len(extra) - len(near)
    if beyond:
        print(f"    ({beyond} more of ours past {judged:.0f}s, in the stretch you have not judged yet)")


if __name__ == "__main__":
    main()
