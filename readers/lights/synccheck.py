#!/usr/bin/env python3
"""Measure how well a baked show lines up with its audio -- objectively, no ear.

A .lights.json carries the light timeline (its `downbeats`, in seconds, are where the
show puts the bar lines). This compares those to the audio's own onsets and reports:

  offset  -- the constant lead/lag: how far to shift the lights to best match the audio
             (feed it to the panel's delay, negative = lights early). A device/startup
             latency shows up here.
  drift   -- how much that best offset changes from the first half of the song to the
             second. Near zero = one tempo; large = the audio and the score's grid run
             at different tempos, which no single delay can fix (the audio does not match
             the score it was baked from).
  match   -- onset energy on the (shifted) bar lines vs. between them. >1.3 is a real lock.

  python3 readers/lights/synccheck.py <show.lights.json> [audio.wav]
  python3 readers/lights/synccheck.py --selftest

Needs numpy + soundfile (use experimentation/music_sync/.venv/bin/python)."""
import json
import os
import sys

import numpy as np

HOP = 512
WIN = 2048


def onset_env(x, sr):
    """Spectral-flux onset strength at HOP resolution, normalised to its max."""
    if x.ndim > 1:
        x = x.mean(1)
    n = 1 + (len(x) - WIN) // HOP
    env = np.zeros(max(0, n))
    prev = np.zeros(WIN // 2 + 1)
    win = np.hanning(WIN)
    for i in range(n):
        mag = np.abs(np.fft.rfft(x[i * HOP:i * HOP + WIN] * win))
        env[i] = np.sum(np.maximum(0.0, mag - prev))
        prev = mag
    return env / (env.max() or 1.0), sr / HOP


def _mean_on(env, fps, times, offset):
    idx = np.round((np.asarray(times) + offset) * fps).astype(int)
    idx = idx[(idx >= 0) & (idx < len(env))]
    return float(env[idx].mean()) if len(idx) else 0.0


def best_offset(env, fps, times, lo=-0.30, hi=0.30, step=0.005):
    offs = np.arange(lo, hi + 1e-9, step)
    scores = [_mean_on(env, fps, times, o) for o in offs]
    k = int(np.argmax(scores))
    return float(offs[k]), scores[k]


def analyse(env, fps, downbeats):
    downbeats = [t for t in downbeats if t is not None]
    off, on_score = best_offset(env, fps, downbeats)
    half = len(downbeats) // 2
    first, _ = best_offset(env, fps, downbeats[:half])
    last, _ = best_offset(env, fps, downbeats[half:])
    drift = last - first
    # match quality at the chosen offset: on bar lines vs. halfway between them
    on = _mean_on(env, fps, downbeats, off)
    mids = [(downbeats[i] + downbeats[i + 1]) / 2 for i in range(len(downbeats) - 1)]
    offb = _mean_on(env, fps, mids, off)
    return {"offset_s": off, "drift_s": drift, "first_half_s": first,
            "last_half_s": last, "match_ratio": on / (offb or 1e-9)}


def verdict(r):
    if r["match_ratio"] < 1.3:
        return "NO LOCK -- the audio's beats do not fall on the show's bar lines; this audio " \
               "is not the render the score was baked from (get matching audio, or re-grid)."
    if abs(r["drift_s"]) > 0.12:
        return f"DRIFT {r['drift_s']*1000:+.0f}ms across the song -- audio and score run at " \
               "different tempos; a single delay cannot fix it. Use matching audio / re-grid."
    if abs(r["offset_s"]) > 0.04:
        return f"CONSTANT OFFSET {r['offset_s']*1000:+.0f}ms -- set the panel delay to " \
               f"{round(r['offset_s']*1000)}ms (negative = lights early)."
    return "IN SYNC -- bar lines land on the audio, no meaningful offset or drift."


def selftest():
    # Build a fake onset env: impulses every 0.5s, but shifted +0.10s from t=0.
    fps = 44100 / HOP
    dur = 40.0
    env = np.zeros(int(dur * fps))
    true_off = 0.10
    downbeats = [i * 0.5 for i in range(int(dur / 0.5))]
    for t in downbeats:
        k = int(round((t + true_off) * fps))
        if 0 <= k < len(env):
            env[k] = 1.0
    r = analyse(env, fps, downbeats)
    ok = []
    # onsets sit true_off LATER than the bar lines, so the lights must shift +true_off
    # later to hit them -- that is the panel delay (positive = later).
    ok.append(("detects the constant offset (+0.10s to align lights)",
               abs(r["offset_s"] - true_off) < 0.01, f"{r['offset_s']:.3f}"))
    ok.append(("reports ~zero drift for a steady tempo", abs(r["drift_s"]) < 0.02, f"{r['drift_s']:.3f}"))
    ok.append(("locks (match ratio high)", r["match_ratio"] > 5, f"{r['match_ratio']:.1f}"))
    bad = 0
    for name, cond, det in ok:
        print(f"  {'pass' if cond else 'FAIL'}  {name}  -- {det}")
        bad += not cond
    print("all checks pass" if not bad else f"{bad} FAILED")
    sys.exit(1 if bad else 0)


def main(argv):
    if argv and argv[0] == "--selftest":
        return selftest()
    if not argv:
        print(__doc__)
        sys.exit(2)
    import soundfile as sf
    show = json.load(open(argv[0]))
    downbeats = show.get("downbeats") or []
    wav = argv[1] if len(argv) > 1 else os.path.join(os.path.dirname(argv[0]),
                                                     show.get("wav", ""))
    if not os.path.isfile(wav):
        print(f"audio not found: {wav}")
        sys.exit(2)
    x, sr = sf.read(wav)
    env, fps = onset_env(x, sr)
    r = analyse(env, fps, downbeats)
    print(f"show:  {argv[0]}")
    print(f"audio: {wav}")
    print(f"  bar lines checked: {len([t for t in downbeats if t is not None])}")
    print(f"  best offset:  {r['offset_s']*1000:+.0f} ms   (first half {r['first_half_s']*1000:+.0f}, "
          f"last half {r['last_half_s']*1000:+.0f})")
    print(f"  drift:        {r['drift_s']*1000:+.0f} ms across the song")
    print(f"  match ratio:  {r['match_ratio']:.2f}  (on bar lines vs between; >1.3 is a lock)")
    print(f"\n  {verdict(r)}")


if __name__ == "__main__":
    main(sys.argv[1:])
