"""Unit tests for BarPhaseAnalyzer (kick-band downbeat phase)."""
from __future__ import annotations

import numpy as np

from musicstate.analyzers.bar_phase import BarPhaseAnalyzer, _low_energy_per_beat


def _kick_track(sr=22050, bpm=120, bars=8, kick_phase=0):
    period = 60.0 / bpm
    n = int(period * 4 * bars * sr)
    y = np.zeros(n, dtype=np.float32)
    beats = []
    for b in range(bars * 4):
        t = b * period
        beats.append(round(t, 4))
        i = int(t * sr)
        if b % 4 == kick_phase:                       # a 60 Hz thud on the true downbeat
            tt = np.arange(int(0.12 * sr)) / sr
            y[i:i + len(tt)] += (np.sin(2 * np.pi * 60 * tt) * np.exp(-tt * 25)).astype(np.float32)
        else:                                         # a quiet 4 kHz tick elsewhere
            tt = np.arange(int(0.02 * sr)) / sr
            y[i:i + len(tt)] += (0.2 * np.sin(2 * np.pi * 4000 * tt)).astype(np.float32)
    return y, sr, beats, period


def test_low_energy_peaks_on_the_kick_phase():
    y, sr, beats, _ = _kick_track(kick_phase=2)
    e = _low_energy_per_beat(y, sr, np.array(beats), hop=512, fmax=150.0)
    means = [e[p::4].mean() for p in range(4)]
    assert int(np.argmax(means)) == 2


def test_analyzer_moves_downbeats_to_the_kick():
    y, sr, beats, _ = _kick_track(kick_phase=2)
    # incoming downbeats claim phase 0 (a quiet beat); allin1 did NOT set them
    ctx = {"beats": beats, "downbeats": beats[0::4], "from_allin1": False}
    res = BarPhaseAnalyzer().analyze(y, sr, ctx)
    assert res.status == "ok"
    assert res.patch["downbeats"] == [round(t, 4) for t in beats[2::4]]
    assert res.patch["bar_phase_decision"]["to_phase"] == 2


def test_allin1_prior_is_not_overridden_without_margin():
    y, sr, beats, _ = _kick_track(kick_phase=2)
    # allin1 set phase 0; evidence favours 2 but an absurd margin holds the prior
    ctx = {"beats": beats, "downbeats": beats[0::4], "from_allin1": True}
    res = BarPhaseAnalyzer(margin=5.0).analyze(y, sr, ctx)
    assert res.patch["downbeats"] == [round(t, 4) for t in beats[0::4]]
    assert res.patch["bar_phase_decision"]["moved_by_beats"] == 0
