"""L1 — accents: discrete percussion onsets as {at, strength, on_grid}.

The DSP layer computes a continuous onset-strength envelope; a lighting reader,
though, reacts hit-by-hit — the chase steps on individual onsets and heads
punctuate on the strong ones. This peaks the envelope into discrete events, ranks
each hit's strength across the whole song (so a hard hit reads as hard regardless
of the record's absolute level), and flags whether it sits on the beat grid.

Librosa only, so it is part of the reliable core and always runs.
"""
from __future__ import annotations

import logging

import librosa
import numpy as np

from ..config import HOP_LENGTH
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.accents")


class AccentsAnalyzer(Analyzer):
    name = "librosa-accents"
    level = "L1"

    def __init__(self, hop_length: int = HOP_LENGTH):
        self.hop_length = hop_length

    def analyze(self, audio, sample_rate, ctx):
        hop = self.hop_length
        onset = ctx.get("onset")
        if onset is None:
            onset = librosa.onset.onset_strength(y=audio, sr=sample_rate, hop_length=hop)
        onset = np.asarray(onset, dtype=float)

        frames = librosa.onset.onset_detect(
            onset_envelope=onset, sr=sample_rate, hop_length=hop, units="frames")
        if len(frames) == 0:
            return AnalyzerResult(
                status="not_computed",
                patch={"accents": {"of": "onset", "events": [],
                                   "how": "librosa onset_detect", "note": "no onsets found"}},
                notes="no onsets")

        times = librosa.frames_to_time(frames, sr=sample_rate, hop_length=hop)
        raw = onset[np.clip(frames, 0, len(onset) - 1)]

        # Rank each hit against the whole song's distribution, so the quietest hits
        # land near 0 and the loudest near 1 -- the range that is actually there.
        # Mapped into a musical band (~0.08..0.52): most hits are modest and the top
        # decile crosses the "stab" threshold a reader uses.
        order = np.argsort(np.argsort(raw))
        rank01 = order / max(1, len(order) - 1)
        strengths = 0.08 + 0.44 * rank01

        on_grid = self._grid_flags(times, ctx.get("beats") or [])

        events = [{"at": round(float(t), 3), "strength": round(float(s), 3), "on_grid": bool(g)}
                  for t, s, g in zip(times, strengths, on_grid)]

        return AnalyzerResult(
            status="ok",
            patch={"accents": {
                "of": "onset",
                "how": "librosa onset_detect on the onset-strength envelope; strength is the "
                       "hit's rank across the song; on_grid is proximity to the sixteenth grid",
                "events": events,
                "note": "Individual percussion onsets. A reader steps its chase on these and "
                        "punctuates the strong ones; most sit off the beat.",
            }},
            confidence={"accents": 0.6},
            notes=f"{len(events)} onsets",
        )

    def _grid_flags(self, times, beats):
        if len(beats) < 2:
            return [False] * len(times)
        beats = np.asarray(beats, dtype=float)
        period = float(np.median(np.diff(beats)))
        if period <= 0:
            return [False] * len(times)
        sub = period / 4.0
        phase = float(beats[0])
        tol = min(0.045, sub * 0.35)
        flags = []
        for t in times:
            nearest = phase + round((t - phase) / sub) * sub
            flags.append(abs(nearest - t) <= tol)
        return flags
