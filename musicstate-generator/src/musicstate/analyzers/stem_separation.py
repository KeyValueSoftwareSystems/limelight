"""L2 — separate the mix into stems once, and hand the waveforms downstream.

The enabler for every per-stem field: melody (vocals pitch), stems (per-bar dB
levels), and — later — accents and chords. demucs is heavy, so the separated mono
waveforms are cached to disk keyed by the source file, and reused on the next run.
The waveforms are published in ctx["stems_audio"]; nothing here writes the map.
"""
from __future__ import annotations

import hashlib
import logging
import os

import numpy as np

from ..config import DEMUCS_MODEL, SAMPLE_RATE, stems_cache_dir
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.stem_separation")

_NAMES = ["drums", "bass", "other", "vocals"]


class StemSeparationAnalyzer(Analyzer):
    name = "demucs-separate"
    level = "L2"

    def available(self) -> tuple[bool, str]:
        try:
            import demucs  # noqa: F401
            import torch  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            return False, f"demucs/torch missing ({exc.__class__.__name__})"
        return True, ""

    def _cache_key(self, audio, ctx) -> str:
        src = ctx.get("source_path")
        if src:
            return os.path.splitext(os.path.basename(src))[0]
        return hashlib.sha1(np.asarray(audio, dtype=np.float32).tobytes()).hexdigest()[:16]

    def analyze(self, audio, sample_rate, ctx):
        cache = os.path.join(stems_cache_dir(), self._cache_key(audio, ctx))
        paths = {n: os.path.join(cache, f"{n}.npy") for n in _NAMES}

        if all(os.path.exists(p) for p in paths.values()):
            stems = {n: np.load(p) for n, p in paths.items()}
            log.debug("loaded cached stems from %s", cache)
        else:
            stems = self._separate(audio, sample_rate)
            os.makedirs(cache, exist_ok=True)
            for n, arr in stems.items():
                np.save(paths[n], arr.astype(np.float32))
            log.debug("separated and cached stems to %s", cache)

        return AnalyzerResult(
            status="ok", patch={},
            ctx={"stems_audio": stems, "stems_sr": SAMPLE_RATE, "stems_names": _NAMES},
            notes=f"{len(stems)} stems at {SAMPLE_RATE} Hz",
        )

    def _separate(self, audio, sample_rate):
        import librosa
        import torch
        from demucs.apply import apply_model
        from demucs.pretrained import get_model

        model = get_model(DEMUCS_MODEL)
        model.cpu().eval()
        msr = model.samplerate
        resampled = librosa.resample(audio, orig_sr=sample_rate, target_sr=msr)
        wav = torch.from_numpy(np.stack([resampled, resampled])).float()
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)
        with torch.no_grad():
            sources = apply_model(model, wav[None], device="cpu", progress=False)[0]
        sources = sources * ref.std() + ref.mean()
        out = {}
        for i, name in enumerate(model.sources):
            if name not in _NAMES:
                continue
            mono = sources[i].mean(0).numpy()
            out[name] = librosa.resample(mono, orig_sr=msr, target_sr=SAMPLE_RATE).astype(np.float32)
        return out
