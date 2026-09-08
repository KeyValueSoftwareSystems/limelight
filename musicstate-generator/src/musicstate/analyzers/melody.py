"""L2 — the dominant melodic line: a monophonic f0 contour.

pYIN (librosa, always available) tracks the single most-prominent pitch, sampled
onto a sixteenth-note grid derived from the beat clock and named to the nearest
note. Unvoiced frames are ``null`` — never a guessed pitch. On the whole mix this
follows the lead line loosely; the reference's per-vocals-stem version (Demucs) is
the deep upgrade and writes the same field.

Writes ``state["melody"]``; ``port.to_map`` lifts it into ``observations.melody``.
"""
from __future__ import annotations

import logging

import librosa
import numpy as np

from ..config import HOP_LENGTH
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.melody")

_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FMIN_NOTE = "C2"   # ~65 Hz
_FMAX_NOTE = "C7"   # ~2093 Hz


def hz_to_note(hz: float) -> str:
    midi = int(round(69 + 12 * np.log2(hz / 440.0)))
    return _NOTES[midi % 12] + str(midi // 12 - 1)


class MelodyAnalyzer(Analyzer):
    name = "pyin-melody"
    level = "L2"

    def __init__(self, hop_length: int = HOP_LENGTH):
        self.hop_length = hop_length

    def analyze(self, audio, sample_rate, ctx):
        hop = self.hop_length
        hop_s = float(ctx.get("hop_s", hop / sample_rate))
        duration = float(ctx.get("duration_s", len(audio) / sample_rate))

        f0, voiced, vprob = librosa.pyin(
            audio, sr=sample_rate, hop_length=hop,
            fmin=librosa.note_to_hz(_FMIN_NOTE), fmax=librosa.note_to_hz(_FMAX_NOTE),
        )

        sixteenth = self._sixteenth_seconds(ctx)
        notes = []
        voiced_conf = []
        t = 0.0
        while t <= duration:
            i = int(round(t / hop_s))
            if 0 <= i < len(f0) and voiced[i] and np.isfinite(f0[i]) and f0[i] > 0:
                conf = round(float(vprob[i]), 3)
                notes.append({"at": round(t, 3), "hz": round(float(f0[i]), 2),
                              "note": hz_to_note(f0[i])})
                voiced_conf.append(conf)
            else:
                notes.append({"at": round(t, 3), "hz": None, "note": None})
            t += sixteenth

        frac = round(len(voiced_conf) / len(notes), 3) if notes else 0.0
        mean_conf = round(float(np.mean(voiced_conf)), 3) if voiced_conf else 0.0
        log.debug("%d sixteenths, %.0f%% voiced", len(notes), frac * 100)

        return AnalyzerResult(
            status="ok",
            patch={"melody": {
                "rate": "per_sixteenth",
                "of": "mix",
                "how": f"pyin f0, {_FMIN_NOTE}..{_FMAX_NOTE}, unvoiced=null",
                "voiced_fraction": frac,
                "notes": notes,
            }},
            confidence={"melody": mean_conf},
            notes="pyin on the whole mix; per-vocals-stem is the deep upgrade",
        )

    @staticmethod
    def _sixteenth_seconds(ctx) -> float:
        beats = ctx.get("beats") or []
        if len(beats) >= 2:
            gaps = np.diff(beats)
            beat = float(np.median(gaps))
        else:
            beat = 0.5  # 120 bpm fallback
        return max(beat / 4.0, 0.02)
