"""Synthesize known-pitch tones and chords — deterministic harmonic ground truth.

The click track pins a known *tempo*; this pins a known *pitch*. A steady sine at
a named note, or a sustained triad, so chroma / chord / melody detection can be
checked against an answer we set. Tones carry a couple of soft harmonics so the
chromagram looks like real (not perfectly pure) audio, and a slow amplitude
envelope so onset-based machinery has something to bite on.
"""
from __future__ import annotations

import numpy as np
import soundfile as sf

from ..config import SAMPLE_RATE as SR
_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def note_to_hz(note: str) -> float:
    """'A4' -> 440.0. Name is a pitch class (C..B, sharps) plus an octave number."""
    name = note[:-1]
    octave = int(note[-1])
    if name not in _NOTES:
        raise ValueError(f"bad note {note!r}")
    midi = 12 * (octave + 1) + _NOTES.index(name)  # MIDI: C4 = 60, A4 = 69
    return 440.0 * 2 ** ((midi - 69) / 12)


def _sine(hz: float, n: int, sr: int) -> np.ndarray:
    t = np.arange(n) / sr
    # fundamental + soft 2nd/3rd harmonics: a plausible, not-pure timbre
    y = np.sin(2 * np.pi * hz * t)
    y += 0.3 * np.sin(2 * np.pi * 2 * hz * t)
    y += 0.15 * np.sin(2 * np.pi * 3 * hz * t)
    return y.astype("float32")


def _envelope(n: int, sr: int) -> np.ndarray:
    """Short fade in/out so edges aren't clicks; flat sustain in the middle."""
    env = np.ones(n, dtype="float32")
    ramp = min(int(0.05 * sr), n // 2)
    if ramp > 0:
        env[:ramp] = np.linspace(0, 1, ramp)
        env[-ramp:] = np.linspace(1, 0, ramp)
    return env


def tone(note: str = "A4", seconds: float = 4.0, sr: int = SR, seed: int = 0) -> np.ndarray:
    """A single sustained note — monophonic ground truth for melody f0."""
    n = int(seconds * sr)
    rng = np.random.default_rng(seed)
    y = _sine(note_to_hz(note), n, sr) * _envelope(n, sr)
    y += rng.normal(0, 0.001, n).astype("float32")
    peak = float(np.max(np.abs(y))) or 1.0
    return (y / peak * 0.95).astype("float32")


def chord(notes: list[str], seconds: float = 4.0, sr: int = SR, seed: int = 0) -> np.ndarray:
    """A sustained set of notes played together — ground truth for chroma + chords.

    e.g. chord(["C4", "E4", "G4"]) is a C-major triad.
    """
    n = int(seconds * sr)
    rng = np.random.default_rng(seed)
    y = np.zeros(n, dtype="float32")
    for note in notes:
        y += _sine(note_to_hz(note), n, sr)
    y *= _envelope(n, sr)
    y += rng.normal(0, 0.001, n).astype("float32")
    peak = float(np.max(np.abs(y))) or 1.0
    return (y / peak * 0.95).astype("float32")


def write_tone(path: str, note: str = "A4", seconds: float = 4.0, sr: int = SR) -> str:
    sf.write(path, tone(note=note, seconds=seconds, sr=sr), sr)
    return path


def write_chord(path: str, notes: list[str], seconds: float = 4.0, sr: int = SR) -> str:
    sf.write(path, chord(notes, seconds=seconds, sr=sr), sr)
    return path
