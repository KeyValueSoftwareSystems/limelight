import json
import os
import shutil
import subprocess
import sys
import time
import warnings

import numpy as np

warnings.filterwarnings("ignore")
for _alias, _val in (
    ("float", float),
    ("int", int),
    ("bool", bool),
    ("object", object),
    ("complex", complex),
):
    if not hasattr(np, _alias):
        setattr(np, _alias, _val)

from madmom.features.downbeats import (  # noqa: E402
    DBNDownBeatTrackingProcessor,
    RNNDownBeatProcessor,
)

TOL = 0.12


def score_path(song):
    r = subprocess.run(
        ["node", "-e", f"console.log(require('./protocol/fixture.js').pick('{song}'))"],
        capture_output=True,
        text=True,
    )
    p = r.stdout.strip()
    return p if p and os.path.exists(p) else None


def track(song):
    audio = f"hub/files/audio/{song}.mp3"
    if not os.path.exists(audio):
        return None
    act = RNNDownBeatProcessor()(audio)
    res = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)(act)
    return [(float(t), int(b)) for t, b in res]


def apply(song, write, stamp):
    sp = score_path(song)
    if not sp:
        return f"{song:28s} no score"
    sc = json.load(open(sp))
    B = sc.get("beats") or []
    bt = [b.get("t") for b in B if isinstance(b, dict)]
    if len(bt) < 20:
        return f"{song:28s} too few beats"
    res = track(song)
    if not res:
        return f"{song:28s} no audio"
    downs = [t for t, b in res if b == 1]
    per = int(round(len(res) / max(1, len(downs))))

    arr = np.array(bt)
    matched, unmatched = [], 0
    for t in downs:
        j = int(np.argmin(np.abs(arr - t)))
        if abs(arr[j] - t) <= TOL:
            matched.append(j)
        else:
            unmatched += 1
    if not matched:
        return f"{song:28s} madmom downbeats do not land on this score's beats at all"

    phases = [j % per for j in matched] if per > 1 else [0]
    vals, counts = np.unique(phases, return_counts=True)
    phase = int(vals[int(np.argmax(counts))])
    agree = float(counts.max()) / len(phases)

    old = [i for i, b in enumerate(B) if isinstance(b, dict) and b.get("downbeat")]
    old_phase = (old[0] % per) if old and per > 1 else None

    tag = "same" if old_phase == phase else f"{old_phase}->{phase}"
    line = (
        f"{song:28s} metre {per}  phase {tag:9s} "
        f"madmom {len(downs):3d} downbeats, {len(matched)} on a score beat, "
        f"{unmatched} adrift, phase agreement {agree * 100:.0f}%"
    )

    if not write:
        return line
    if agree < 0.75:
        return line + "  [UNSTABLE, not written]"

    shutil.copy2(sp, sp + f".bak-madmom-{stamp}")
    for i, b in enumerate(B):
        if not isinstance(b, dict):
            continue
        if i % per == phase:
            b["downbeat"] = True
        elif "downbeat" in b:
            del b["downbeat"]
    sc["beats"] = B
    sc.setdefault("provenance", {})["downbeat_phase"] = {
        "to": phase,
        "metre": per,
        "decided_by": "madmom RNNDownBeatProcessor + DBNDownBeatTrackingProcessor",
        "downbeats_found": len(downs),
        "landed_on_a_score_beat": len(matched),
        "adrift": unmatched,
        "phase_agreement": round(agree, 3),
        "tool": "listen/downbeat_track.py",
    }
    json.dump(sc, open(sp, "w"))
    return line + "  [written]"


def main():
    write = "--apply" in sys.argv
    songs = [a for a in sys.argv[1:] if not a.startswith("--")]
    stamp = time.strftime("%Y%m%d-%H%M%S")
    for song in songs:
        try:
            print(apply(song, write, stamp), flush=True)
        except Exception as exc:
            print(f"{song:28s} ERR {type(exc).__name__} {str(exc)[:60]}", flush=True)
    if not write:
        print("\n(dry run - pass --apply to write)")


if __name__ == "__main__":
    main()
