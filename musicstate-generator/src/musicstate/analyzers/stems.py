"""L2 observation — Demucs source separation → per-stem presence timeline.

Adds a real vocal/instrument-presence signal. Observation tier: it enriches, never
contradicts, the L2 interface fields. Heavy (downloads htdemucs, runs a net), so it
belongs to the deep set only.
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

    def available(self) -> tuple[bool, str]:
        try:
            import demucs  # noqa: F401
            import torch  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            return False, f"demucs/torch missing ({exc.__class__.__name__})"
        return True, ""

    def analyze(self, audio, sample_rate, ctx):
        import librosa
        import torch
        from demucs.apply import apply_model
        from demucs.pretrained import get_model

        model = get_model(DEMUCS_MODEL)
        model.cpu().eval()
        model_sr = model.samplerate
        log.debug("separating with %s at %dHz", DEMUCS_MODEL, model_sr)

        resampled = librosa.resample(audio, orig_sr=sample_rate, target_sr=model_sr)
        wav = torch.from_numpy(np.stack([resampled, resampled])).float()  # fake stereo
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)
        with torch.no_grad():
            sources = apply_model(model, wav[None], device="cpu", progress=False)[0]
        sources = sources * ref.std() + ref.mean()

        names = list(model.sources)
        hop = int(0.1 * model_sr)
        levels = {}
        for i, name in enumerate(names):
            mono = sources[i].mean(0).numpy()
            levels[name] = librosa.feature.rms(y=mono, hop_length=hop)[0]
        t_axis = librosa.frames_to_time(np.arange(len(next(iter(levels.values())))),
                                        sr=model_sr, hop_length=hop)

        def presence(rms):
            top = np.percentile(rms, 99) or 1.0
            return np.clip(rms / top, 0, 1)

        pres = {name: presence(rms) for name, rms in levels.items()}
        downbeats = ctx.get("downbeats") or []
        per_downbeat = []
        for t in downbeats:
            j = int(np.clip(np.searchsorted(t_axis, t), 0, len(t_axis) - 1))
            per_downbeat.append({"t": round(float(t), 3),
                                 **{name: round(float(pres[name][j]), 3) for name in names}})

        vocal_fraction = None
        if "vocals" in pres:
            vocal_fraction = round(float((pres["vocals"] > 0.15).mean()), 3)

        return AnalyzerResult(
            status="ok",
            patch={"stems": {"model": DEMUCS_MODEL, "names": names, "rate": "per_downbeat",
                             "per_downbeat": per_downbeat, "vocal_present_fraction": vocal_fraction}},
            confidence={"stems": 0.6},
            notes="per-stem presence vs own 99th pct; observation tier",
        )
