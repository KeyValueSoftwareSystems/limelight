"""L2 — the 4/4 phase whose bar-lines carry the kick, decided from the recording.

Ports listen/barphase.py. ear-style downbeats can sit on the quietest beat of the
bar; the low band (kick) says where the bar actually begins. allin1's downbeats are
a strong prior — overridden only if the low-band evidence clears a margin. Sections
are measured independently of phase in this pipeline, so only downbeats move.
"""
from __future__ import annotations

import librosa
import numpy as np

from ..config import BAR_PHASE_FMAX, BAR_PHASE_MARGIN, HOP_LENGTH, N_FFT
from .base import Analyzer, AnalyzerResult


def _low_energy_per_beat(audio, sr, beats, hop=HOP_LENGTH, fmax=BAR_PHASE_FMAX):
    """Kick-band (<= fmax Hz) energy sampled at each beat."""
    S = np.abs(librosa.stft(audio, n_fft=N_FFT, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    low = S[freqs <= fmax].sum(axis=0)
    times = librosa.frames_to_time(np.arange(low.shape[0]), sr=sr, hop_length=hop)
    idx = np.clip(np.searchsorted(times, np.asarray(beats, dtype=float)), 0, len(low) - 1)
    return low[idx]


class BarPhaseAnalyzer(Analyzer):
    name = "bar-phase"
    level = "L2"

    def __init__(self, hop_length=HOP_LENGTH, margin=BAR_PHASE_MARGIN):
        self.hop_length = hop_length
        self.margin = margin

    def analyze(self, audio, sample_rate, ctx):
        beats = ctx.get("beats") or []
        downbeats = ctx.get("downbeats") or []
        if len(beats) < 16 or not downbeats:
            return AnalyzerResult(status="not_computed",
                                  patch={"downbeats": downbeats}, notes="too few beats")
        cur = beats.index(downbeats[0]) if downbeats[0] in beats else 0
        e = _low_energy_per_beat(audio, sample_rate, beats, self.hop_length)
        total = float(e.mean()) or 1.0
        # score is the low-band energy on a phase's bar-lines relative to the mean beat:
        # > 1 means the kick sits there. Scores average 1 across the four phases.
        score = {p: float(e[p::4].mean()) / total for p in range(4)}
        best = max(score, key=score.get)

        from_allin1 = bool(ctx.get("from_allin1"))
        # allin1 is a strong prior: override only if the kick phase clears it by `margin`
        # (an ADDITIVE gap in ratio units — a multiplicative gap degenerates when the
        # current phase carries almost no low band, which is exactly the bug case).
        override = (score[best] - score[cur]) > self.margin if from_allin1 else True
        chosen = best if (override and best != cur) else cur

        new_downbeats = [round(float(t), 4) for t in beats[chosen::4]]
        decision = {
            "moved_by_beats": (chosen - cur) % 4 if chosen != cur else 0,
            "from_phase": cur, "to_phase": chosen,
            "decided_by": "low band (<=%g Hz) on the claimed bar lines vs the other beats" % BAR_PHASE_FMAX,
            "scores_by_phase": {str(p): round(score[p], 3) for p in range(4)},
            "allin1_prior": from_allin1,
            "why": "ear-style phase can land on the quietest beat of the bar; the kick says where "
                   "the bar begins. allin1 downbeats are a strong prior, overridden only past a "
                   "margin. Only downbeats move — sections are measured independently.",
        }
        return AnalyzerResult(
            status="ok",
            patch={"downbeats": new_downbeats, "bar_phase_decision": decision},
            confidence={"downbeats": round(min(1.0, score[chosen] / max(score.values())), 3)},
            ctx={"downbeats": new_downbeats},
            notes=f"phase {cur} -> {chosen}",
        )
