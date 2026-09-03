#!/usr/bin/env python3
"""Baseline listener: audio in, map out. Stdlib only, no model, no dependencies.

    python3 listen/baseline.py synth/out/01-metronome.wav > cand.json

This is deliberately the NAIVE implementation, and it is committed as a floor to
beat rather than as a good answer. It measures onset energy across the full band
and takes the highest-scoring comb, which are precisely the two choices that
produced two of this project's real bugs. Replace it; the loop only needs a
command that reads a WAV path and writes a map to stdout.
"""
import json, math, os, sys, wave

HOP_MS = 2.0
BPM_LO, BPM_HI = 60.0, 180.0


def read_wav(path):
    with wave.open(path, "rb") as w:
        sr, n, ch = w.getframerate(), w.getnframes(), w.getnchannels()
        raw = w.readframes(n)
    step = 2 * ch
    return [int.from_bytes(raw[i:i + 2], "little", signed=True) / 32768.0
            for i in range(0, len(raw) - step + 1, step)], sr


def flux(buf, sr):
    """Half-wave-rectified energy difference, full band.

    Full band is the naive part and it is the point: whichever voice has the
    sharpest transients dominates this sum regardless of which voice carries the
    pulse, so a record whose hats are busier than its kick will pull the grid off
    the beat. Fitting on the low band is the fix, and it belongs to whoever
    replaces this file."""
    hop = max(1, int(sr * HOP_MS / 1000.0))
    en = [max((abs(x) for x in buf[i:i + hop]), default=0.0)
          for i in range(0, len(buf) - hop, hop)]
    # index j must mean time j*hop/sr, so the difference is stored at j and not at
    # j-1; getting this wrong shifts every onset one bin early and is invisible
    # until a single-bin lookup returns zero for every candidate grid
    return [0.0] + [max(0.0, en[j] - en[j - 1]) for j in range(1, len(en))], hop


def peak(fx, c, w=2):
    """Largest flux within +/- w bins of a beat.

    A beat's onset does not land in the exact bin arithmetic predicts -- the
    envelope is quantised to 2 ms and a transient's rising edge straddles bins --
    so a single-bin lookup returns zero for the correct grid as readily as for a
    wrong one, and the search then ranks nothing at all. The window is +/- 4 ms,
    which is a property of the envelope's resolution and nowhere near the 70 ms
    the bench grades on, so it cannot launder accuracy."""
    lo, hi = max(0, c - w), min(len(fx), c + w + 1)
    return max(fx[lo:hi]) if hi > lo else 0.0


def comb(fx, hop, sr, period_s, phase_s, dur):
    """Mean flux landing on the beats of one candidate grid.

    Normalising by beat count is the conventional choice and it is also a trap: a
    grid at half the true tempo hits only the loud events and none of the quiet
    ones, so its mean can beat the correct grid's. That is the tempo octave error,
    and it lives in this one division."""
    per_s = sr / hop
    n, tot = 0, 0.0
    t = phase_s
    while t < dur:
        tot += peak(fx, int(t * per_s)); n += 1
        t += period_s
    return (tot / n) if n else 0.0


def fit(fx, hop, sr, dur):
    per_s = sr / hop
    best = (0.0, None, None)
    for bpm10 in range(int(BPM_LO * 10), int(BPM_HI * 10) + 1, 10):     # 1 bpm coarse
        p = 60.0 / (bpm10 / 10.0)
        for ph_i in range(0, int(p * per_s), 4):
            s = comb(fx, hop, sr, p, ph_i / per_s, dur)
            if s > best[0]: best = (s, p, ph_i / per_s)
    _, p0, ph0 = best
    for dp in [x / 10000.0 for x in range(-120, 121, 2)]:                # fine period
        p = p0 + dp
        if p <= 0: continue
        for dphi in range(-6, 7):
            ph = ph0 + dphi / per_s
            if ph < 0: continue
            s = comb(fx, hop, sr, p, ph, dur)
            if s > best[0]: best = (s, p, ph)
    return best[1], best[2] % best[1], best[0]


def bar_phase(fx, hop, sr, period, phase, dur, bar=4):
    per_s = sr / hop
    scores = []
    for b in range(bar):
        tot, n, t = 0.0, 0, phase + b * period
        while t < dur:
            tot += peak(fx, int(t * per_s)); n += 1
            t += period * bar
        scores.append(tot / n if n else 0.0)
    top = max(range(bar), key=lambda b: scores[b])
    spread = (max(scores) - min(scores)) / max(1e-9, max(scores))
    return top, spread


def listen(path):
    buf, sr = read_wav(path)
    dur = len(buf) / sr
    fx, hop = flux(buf, sr)
    period, phase, score = fit(fx, hop, sr, dur)
    beats, t = [], phase
    while t < dur:
        beats.append(round(t, 6)); t += period
    top, spread = bar_phase(fx, hop, sr, period, phase, dur)
    downs = beats[top::4]
    return {
        "map": "0.3",
        "song": {"title": os.path.basename(path), "artist": "?", "length": round(dur, 3)},
        "made_by": {"how": "model", "who": "listen/baseline.py",
                    "warning": "Naive baseline: full-band flux, highest comb score wins. "
                               "Committed as a floor to beat."},
        "grid": {"period": round(period, 6), "phase": round(phase, 6),
                 "bpm": round(60.0 / period, 3), "bar_phase": top + 1, "locked": False,
                 "how": "full-band energy flux, comb search, mean-per-beat scoring"},
        "beats": beats,
        "downbeats": downs,
        "chapters": [{"at": 0.0, "name": "intro"}],
        "moments": [],
        "spans": [],
        "confidence": round(min(0.95, spread), 3),
        "bar_confidence_note": f"bar cue strength {spread:.3f} — near zero means the audio "
                               f"carries no bar accent and these downbeats are a guess",
    }


if __name__ == "__main__":
    print(json.dumps(listen(sys.argv[1]), indent=1))
