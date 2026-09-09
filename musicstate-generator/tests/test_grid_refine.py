"""Unit tests for GridRefineAnalyzer (rigid grid phase-locked to the kick)."""
from __future__ import annotations

import numpy as np

from musicstate.analyzers.grid_refine import GridRefineAnalyzer, _kick_series


def _kick_track(sr=22050, bpm=128.0, secs=8.0, phase=0.223):
    period = 60.0 / bpm
    n = int(secs * sr)
    y = np.zeros(n, dtype=np.float32)
    t = phase
    while t < secs - 0.2:
        i = int(t * sr)
        tt = np.arange(int(0.12 * sr)) / sr
        y[i:i + len(tt)] += (np.sin(2 * np.pi * 60 * tt) * np.exp(-tt * 25)).astype(np.float32)
        t += period
    return y, sr, period, phase


def test_kick_series_has_energy():
    y, sr, _, _ = _kick_track()
    series, hop_s = _kick_series(y, sr)
    assert len(series) > 10 and float(series.max()) > 0


def test_grid_refine_locks_to_kick_and_is_rigid():
    y, sr, period, phase = _kick_track(phase=0.223)
    dur = len(y) / sr
    # input beats: ~55 ms early, jittery, and missing the first ~2 s (like raw allin1)
    rng = np.random.default_rng(0)
    jit = [round(phase + 0.055 + i * period + float(rng.uniform(-0.01, 0.01)), 2)
           for i in range(int(2 / period), int((dur - 0.5) / period))]
    ctx = {"beats": jit, "tempo_bpm": 128.0, "duration_s": dur}

    res = GridRefineAnalyzer().analyze(y, sr, ctx)
    b = res.patch["beats"]

    gaps = [round(b[i + 1] - b[i], 6) for i in range(len(b) - 1)]
    assert max(gaps) - min(gaps) <= 2e-4           # rigid within the 4-dp beat rounding
    assert abs(gaps[0] - period) < 1e-3            # at the detected tempo
    assert abs(b[0] - phase) < 0.02                # phase-locked to the kick, not +55 ms
    assert b[0] < period and b[-1] > dur - 2 * period  # spans the whole song, intro included
    assert res.patch["downbeats"][0] == b[0]       # downbeats seeded on phase 0


def test_no_beats_is_not_computed():
    y, sr, _, _ = _kick_track()
    res = GridRefineAnalyzer().analyze(y, sr, {"beats": [], "tempo_bpm": 128.0, "duration_s": 8.0})
    assert res.status == "not_computed"
