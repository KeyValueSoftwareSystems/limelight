import subprocess
import sys
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")

CACHE = Path("work/heard")
MODEL = "htdemucs"
NAMES = ("drums", "bass", "vocals", "other")
RATE = 100


def envelopes(path, slug):
    at = CACHE / f"{slug}.{MODEL}.npz"
    if at.exists():
        z = np.load(at)
        return {k: z[k] for k in NAMES}

    work = Path("work/stems") / slug
    work.mkdir(parents=True, exist_ok=True)
    made = work / MODEL / Path(path).stem
    if not (made / "vocals.wav").exists():
        subprocess.run([sys.executable, "-m", "demucs", "-n", MODEL,
                        "-o", str(work), path], check=True)

    import soundfile as sf

    out = {}
    for name in NAMES:
        x, sr = sf.read(str(made / f"{name}.wav"), dtype="float32")
        if x.ndim > 1:
            x = x.mean(axis=1)
        hop = sr // RATE
        n = len(x) // hop
        out[name] = np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(axis=1))

    at.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(at, **out)
    for f in made.glob("*.wav"):
        f.unlink()
    return out


def per_bar(env, first_s, bar_s, bars, edges=None):
    if edges is not None:
        spans = [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]
    else:
        spans = []
        if first_s > 0.2:
            spans.append((0.0, first_s))
        spans += [(first_s + b * bar_s, first_s + (b + 1) * bar_s) for b in range(bars)]
    out = {}
    for name, v in env.items():
        rows = []
        for lo, hi in spans:
            part = v[max(0, int(lo * RATE)):max(0, int(hi * RATE))]
            rows.append(float(part.mean()) if len(part) else 0.0)
        rows = np.array(rows)
        peak = rows.max() or 1.0
        out[name] = rows / peak
    return out


def present(v, floor=0.12):
    return bool(np.median(v) > floor)


def per_tick(env, edges, per=16):
    # One value per sixteenth instead of one per bar. A bar at 128bpm is 1.875s,
    # so a kick at two hits a second sits above what a per-bar lane can even
    # represent -- the wobble it shows there is aliasing, not the drum. A light
    # that pulses on the beat needs a lane fast enough to carry the beat, and
    # the envelopes are already computed at 100Hz before anything collapses
    # them. Anchored to the bar edges, so this stays true through a tempo
    # change rather than drifting off the music.
    spans = []
    for i in range(len(edges) - 1):
        a, b = edges[i], edges[i + 1]
        step = (b - a) / per
        spans += [(a + k * step, a + (k + 1) * step) for k in range(per)]
    out = {}
    for name, v in env.items():
        rows = []
        for lo, hi in spans:
            part = v[max(0, int(lo * RATE)):max(0, int(hi * RATE))]
            rows.append(round(float(part.max()), 4) if len(part) else 0.0)
        top = max(rows) or 1.0
        out[name] = [round(x / top, 4) for x in rows]
    return out
