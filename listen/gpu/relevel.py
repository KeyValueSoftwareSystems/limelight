"""Put a finished score's beats back on one metrical level.

The tracker locks onto half time for sustained stretches, so a song reads as
two tempos an octave apart. pipeline.py now fixes this at the source in
step_beats; this brings scores that were built before that up to date without
a GPU run, using the same one_level and the same grid assembly so a repaired
score and a freshly built one agree.

    python3 relevel.py scores/*.score
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import pipeline as P


def regrid(score, beats, downbeats, dur):
    bpm = score.get("grid", {}).get("bpm") or 120.0
    inter = [beats[i + 1] - beats[i] for i in range(len(beats) - 1)]
    inter = [g for g in inter if 0.2 < g < 2.0]
    if inter:
        bpm = round(60.0 / sorted(inter)[len(inter) // 2], 1)
    bpb = score.get("grid", {}).get("beats_per_bar") or 4
    if len(downbeats) > 2:
        gaps = [
            downbeats[i + 1] - downbeats[i]
            for i in range(min(10, len(downbeats) - 1))
        ]
        if gaps:
            c = round((sum(gaps) / len(gaps)) / (60.0 / bpm))
            if c in (2, 3, 4, 6, 8):
                bpb = c
    fb = beats[0] if beats else 0.0
    refit = P.tempo_map(beats)
    if refit:
        bpm = refit["bpm"]
    bd = (60.0 / bpm) * bpb
    out = {
        "bpm": round(bpm, 3),
        "beats_per_bar": bpb,
        "first_beat_s": round(fb, 4),
        "bars": math.ceil((dur - fb) / bd) if bd > 0 else 0,
        "steady": P.grid_steadiness(beats),
    }
    pickup = 1 if fb > 0.2 else 0
    out["first_bar"] = 0 if pickup else 1
    out["last_bar"] = out["bars"]
    if refit and refit.get("tempo"):
        out["tempo"] = refit["tempo"]
    return out


def main(paths):
    for path in paths:
        slug = os.path.basename(path)[:-6]
        with open(path) as fh:
            score = json.load(fh)
        rows = score.get("beats") or []
        times = [b["t"] for b in rows if "t" in b]
        if len(times) < 24:
            continue
        downs = {round(b["t"], 3) for b in rows if b.get("downbeat")}
        fixed, filled = P.one_level(times)
        if not filled:
            continue
        was = (score.get("grid") or {}).get("steady")
        dur = (score.get("song") or {}).get("length_s") or (fixed[-1] + 1)
        score["beats"] = [
            ({"t": t, "downbeat": True} if round(t, 3) in downs else {"t": t})
            for t in fixed
        ]
        score["grid"] = regrid(score, fixed, sorted(downs), dur)
        with open(path, "w") as fh:
            json.dump(score, fh)
        now = score["grid"]["steady"]
        print(
            f"{slug}: +{filled} beats  steady {was} -> {now}  "
            f"bpm {score['grid']['bpm']}  bars {score['grid']['bars']}"
        )


if __name__ == "__main__":
    main(sys.argv[1:])
