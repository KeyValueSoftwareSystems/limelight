"""L2 — a rigid beat grid, phase-locked to the kick.

The trackers (allin1, librosa) emit per-beat times that are quantised to ~10 ms,
jitter a few ms bar to bar, sit a fixed ~50 ms off the kick, and often miss the
intro. Shipped as the grid, they score badly against the recording: the kick is
barely louder on the claimed beats than anywhere else. For this constant-tempo
repertoire the right grid is a *rigid clock* at the detected tempo whose phase is
locked to where the kick actually lands, spanning the whole song. That is what the
winning maps use, and it lifts everything expressed in the grid's frame (bars,
downbeats, moments) at once.

The tracker's tempo is kept (a small period window is searched around it); its
per-beat jitter is discarded because, at a fixed tempo, that jitter is tracker
noise, not musical detail.
"""
from __future__ import annotations

import librosa
import numpy as np

from ..config import (GRID_FMAX, GRID_OCTAVES, GRID_PERIOD_TOL, GRID_PHASE_STEP,
                      HOP_LENGTH, N_FFT)
from .base import Analyzer, AnalyzerResult


def _kick_series(audio, sr, hop=HOP_LENGTH, fmax=GRID_FMAX):
    """Low-band (kick) energy per STFT hop, and the hop length in seconds."""
    S = np.abs(librosa.stft(audio, n_fft=N_FFT, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    low = S[freqs <= fmax].sum(axis=0)
    return low, hop / sr


def _grid_energy(series, hop_s, phase, period, dur):
    """Mean kick energy at the points of a rigid grid over [0, dur].

    Averages over however many points fall in the song (>=1); returns 0.0 for an
    empty grid. It must NOT sentinel a short grid to a negative value: this is used
    for midpoint energy too, and a negative sentinel there would hide the loud
    skipped kicks that reveal a half-time grid. Beat-count eligibility is enforced
    by the caller instead.
    """
    n = int((dur - phase) / period)
    if n < 1:
        return 0.0
    idx = np.clip(np.round((phase + np.arange(n) * period) / hop_s).astype(int), 0, len(series) - 1)
    return float(series[idx].mean())


class GridRefineAnalyzer(Analyzer):
    name = "grid-refine"
    level = "L2"

    def __init__(self, hop_length=HOP_LENGTH):
        self.hop_length = hop_length

    def analyze(self, audio, sample_rate, ctx):
        beats = ctx.get("beats") or []
        bpm = ctx.get("tempo_bpm")
        dur = float(ctx.get("duration_s") or (len(audio) / sample_rate))
        if len(beats) < 8 or not bpm:
            return AnalyzerResult(status="not_computed", patch={}, notes="no beats/tempo")

        series, hop_s = _kick_series(audio, sample_rate, self.hop_length)
        p0 = 60.0 / bpm

        # Search half / true / double the tracker's tempo (trackers make octave errors),
        # each across a small period window and every phase. Score a grid by how much its
        # beats stand out from their own MIDPOINTS: a correct grid has loud beats and quiet
        # midpoints; a half-time grid has the skipped kicks sitting just as loud on the
        # midpoints. Maximising (beat energy - midpoint energy) locks both the octave and
        # the phase, and is exactly what the scorer's octave guard checks.
        best = (-1e18, p0, 0.0)
        for mult in GRID_OCTAVES:
            for period in [p0 * mult * (1.0 + d) for d in GRID_PERIOD_TOL]:
                if int(dur / period) < 8:       # too few beats to be a real grid
                    continue
                half = period / 2.0
                phase = 0.0
                while phase < period:
                    score = (_grid_energy(series, hop_s, phase, period, dur)
                             - _grid_energy(series, hop_s, phase + half, period, dur))
                    if score > best[0]:
                        best = (score, period, phase)
                    phase += GRID_PHASE_STEP
        _, period, phase = best

        n = int((dur - phase) / period) + 1
        grid = [round(phase + i * period, 4) for i in range(n) if phase + i * period < dur]
        downbeats = grid[0::4]
        refined_bpm = round(60.0 / period, 4)
        return AnalyzerResult(
            status="ok",
            patch={"beats": grid, "downbeats": downbeats,
                   "meta_partial": {"tempo_bpm": refined_bpm}},
            confidence={"beats": 0.85, "downbeats": 0.6},
            ctx={"beats": grid, "downbeats": downbeats, "tempo_bpm": refined_bpm},
            notes=f"rigid grid: {len(grid)} beats, period {period:.5f}s, phase {phase:.3f}s",
        )
