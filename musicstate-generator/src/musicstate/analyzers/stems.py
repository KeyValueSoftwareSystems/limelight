"""L2 observation — per-stem loudness, in dB against the mix, one value per bar.

Consumes the separated waveforms from StemSeparationAnalyzer (ctx["stems_audio"]);
this analyzer only measures. Each stem's RMS over a bar is expressed in dB relative
to the mix's whole-song RMS, so summed as energy the stems track the mix bar by
bar — which is the invariant a separator preserves and the scorer checks. (The old
field normalised each stem by its own maximum, which cannot sum to a mix.)
"""
from __future__ import annotations

import logging

import numpy as np

from ..config import DEMUCS_MODEL
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.stems")


class StemsAnalyzer(Analyzer):
    name = "htdemucs"
    level = "L2"

    def analyze(self, audio, sample_rate, ctx):
        stems = ctx.get("stems_audio") or {}
        downs = ctx.get("downbeats") or []
        if not stems or len(downs) < 8:
            return AnalyzerResult(status="not_computed", patch={},
                                  notes="no separated stems or too few bars")

        names = list(stems.keys())
        audio = np.asarray(audio, dtype=np.float64)
        mix_ref = float(np.sqrt(np.mean(audio ** 2))) or 1e-6
        bar = float(np.median(np.diff(downs))) if len(downs) > 1 else 2.0

        def bar_rms(y, t0, t1):
            a, b = int(t0 * sample_rate), int(min(t1, len(y) / sample_rate) * sample_rate)
            seg = np.asarray(y[a:b], dtype=np.float64)
            return float(np.sqrt(np.mean(seg ** 2))) if len(seg) else 1e-9

        sources = {n: [] for n in names}
        for i, t in enumerate(downs):
            t1 = downs[i + 1] if i + 1 < len(downs) else t + bar
            for n in names:
                sources[n].append(round(20.0 * float(np.log10(bar_rms(stems[n], t, t1) / mix_ref + 1e-9)), 2))

        arrs = {n: np.array(sources[n]) for n in names}
        levels = {n: {"present": bool(arrs[n].max() > -50.0)} for n in names}
        vocal_fraction = (round(float((arrs["vocals"] > arrs["vocals"].max() - 20.0).mean()), 3)
                          if "vocals" in arrs else None)

        return AnalyzerResult(
            status="ok",
            patch={"stems": {
                "model": DEMUCS_MODEL, "names": names, "rate": "per_downbeat",
                "comparable": True,
                "unit": "dB of the stem's RMS over one bar, against the mix's whole-song RMS",
                "sources": sources, "at": [round(float(t), 3) for t in downs],
                "levels": levels, "vocal_present_fraction": vocal_fraction,
            }},
            confidence={"stems": 0.7},
            notes="per-bar dB levels vs the mix (comparable)",
        )
