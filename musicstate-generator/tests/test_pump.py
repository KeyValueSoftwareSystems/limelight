"""Unit tests for PumpAnalyzer (sidechain duck-and-swell)."""
from __future__ import annotations

import numpy as np

from musicstate.analyzers.pump import PumpAnalyzer


def _track(sr=22050, bpm=120.0, secs=8.0, rising=True):
    period = 60.0 / bpm
    n = int(secs * sr)
    t = np.arange(n) / sr
    carrier = np.sin(2 * np.pi * 2000.0 * t)          # above the 250 Hz high-pass
    phase = (t % period) / period
    env = (0.2 + 0.8 * phase) if rising else (1.0 - 0.8 * phase)
    y = (carrier * env).astype(np.float32)
    beats = [round(i * period, 4) for i in range(int(secs / period))]
    return y, sr, beats


def test_pump_detects_rising_recovery():
    y, sr, beats = _track(rising=True)
    res = PumpAnalyzer().analyze(y, sr, {"beats": beats})
    assert res.status == "ok"
    assert res.patch["pump"]["depth"] > 0.1
    assert res.patch["pump"]["present"] is True


def test_pump_negative_when_it_decays():
    y, sr, beats = _track(rising=False)
    res = PumpAnalyzer().analyze(y, sr, {"beats": beats})
    assert res.patch["pump"]["depth"] < 0.0
    assert res.patch["pump"]["present"] is False


def test_pump_no_beats_not_computed():
    y, sr, _ = _track()
    res = PumpAnalyzer().analyze(y, sr, {"beats": []})
    assert res.status == "not_computed"
