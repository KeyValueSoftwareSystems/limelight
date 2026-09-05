"""Synthesize a known-BPM click track — deterministic ground truth for tests.

A metronome whose tempo we *set*, so beat detection can be checked against a
known answer. Every 4th click is accented (louder + higher) to give the downbeat
heuristic a real bar phase to find.
"""
from __future__ import annotations

import numpy as np
import soundfile as sf

SR = 22050


def click_track(bpm: float = 120.0, seconds: float = 16.0, sr: int = SR,
                accent_every: int = 4, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    y = np.zeros(int(seconds * sr), dtype="float32")
    period = 60.0 / bpm
    click_len = int(0.04 * sr)
    env = np.exp(-np.linspace(0, 8, click_len)).astype("float32")
    n_beats = int(seconds / period)
    for i in range(n_beats):
        start = int(i * period * sr)
        end = min(start + click_len, len(y))
        if end <= start:
            continue
        accent = (i % accent_every == 0)
        freq = 2000.0 if accent else 1000.0
        amp = 0.9 if accent else 0.5
        t = np.arange(end - start) / sr
        tone = np.sin(2 * np.pi * freq * t).astype("float32") * env[: end - start] * amp
        y[start:end] += tone
    y += rng.normal(0, 0.001, len(y)).astype("float32")  # tiny floor so it's not perfectly silent
    peak = float(np.max(np.abs(y))) or 1.0
    return (y / peak * 0.95).astype("float32")


def write_click(path: str, bpm: float = 120.0, seconds: float = 16.0, sr: int = SR) -> str:
    sf.write(path, click_track(bpm=bpm, seconds=seconds, sr=sr), sr)
    return path
