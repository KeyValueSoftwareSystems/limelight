"""Unit tests for MomentTimingAnalyzer (re-time drops/stops to the loudness step)."""
from __future__ import annotations

import numpy as np

from musicstate.analyzers.moment_timing import MomentTimingAnalyzer, _envelope, _sustained


def _step_track(sr=22050, bpm=120, bars=8, step_beat=10):
    period = 60.0 / bpm
    n = int(period * 4 * bars * sr)
    y = (np.random.default_rng(0).standard_normal(n) * 0.02).astype(np.float32)
    beats = [round(b * period, 4) for b in range(bars * 4)]
    y[int(beats[step_beat] * sr):] += 0.5                # a sustained loudness step
    return y, sr, beats, period


def test_sustained_finds_the_step():
    y, sr, beats, _ = _step_track(step_beat=10)
    env = _envelope(y, sr, 0.005)
    on = _sustained(env, beats[10], 0.005, (0.5, 1.0, 1.5, 2.0))
    off = _sustained(env, beats[3], 0.005, (0.5, 1.0, 1.5, 2.0))
    assert on is not None and off is not None and on > off


def test_retimes_a_mislabelled_drop_onto_the_step():
    y, sr, beats, _ = _step_track(step_beat=10)
    # a drop wrongly placed two beats early (beat 8); the step is at beat 10
    ctx = {"beats": beats, "downbeats": beats[0::4], "tempo_bpm": 120.0,
           "events": [{"t": beats[8], "type": "drop", "conf": 0.7}]}
    res = MomentTimingAnalyzer().analyze(y, sr, ctx)
    drop = next(e for e in res.patch["events_retimed"] if e["type"] == "drop")
    assert abs(drop["t"] - beats[10]) < 1e-6
    assert res.patch["moment_timing"]["moved"][0]["now"] == round(beats[10], 6)


def test_no_drops_is_not_computed():
    y, sr, beats, _ = _step_track()
    ctx = {"beats": beats, "downbeats": beats[0::4], "tempo_bpm": 120.0,
           "events": [{"t": beats[4], "type": "build", "conf": 0.4}]}
    res = MomentTimingAnalyzer().analyze(y, sr, ctx)
    assert res.status == "not_computed"
