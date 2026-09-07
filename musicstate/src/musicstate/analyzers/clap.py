"""L4 — dense per-beat embeddings via CLAP.
"""
from __future__ import annotations

import logging
import os
import numpy as np

from ..config import CLAP_MODEL
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.clap")

class CLAPAnalyzer(Analyzer):
    name = "clap-htsat"
    level = "L4"

    def available(self) -> tuple[bool, str]:
        try:
            import torch  # noqa: F401
            import transformers  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            return False, f"torch/transformers missing ({exc.__class__.__name__})"
        return True, ""

    def analyze(self, audio, sample_rate, ctx):
        import librosa
        import torch
        from transformers import ClapModel, ClapProcessor

        # CLAP model
        model = ClapModel.from_pretrained(CLAP_MODEL).eval()
        processor = ClapProcessor.from_pretrained(CLAP_MODEL)
        
        # Audio for CLAP is typically 48kHz
        model_sr = 48000
        resampled = librosa.resample(audio, orig_sr=sample_rate, target_sr=model_sr)
        
        # Simple beat pooling approach, similar to EmbeddingAnalyzer
        beats = ctx.get("beats") or []
        edges = list(beats) + [ctx.get("duration_s", len(resampled)/model_sr)]
        
        embeddings = []
        # Process per beat.
        for a, b in zip(edges[:-1], edges[1:]):
            start = int(a * model_sr)
            end = int(b * model_sr)
            chunk = resampled[start:end]
            if len(chunk) < 100: # tiny segments
                embeddings.append(np.zeros(512, dtype="float32"))
                continue
            
            inputs = processor(audios=chunk, sampling_rate=model_sr, return_tensors="pt")
            with torch.no_grad():
                out = model.get_audio_features(**inputs)
            embeddings.append(out[0].numpy())

        vecs = np.stack(embeddings).astype("float16")
        
        contract = {"status": "ok", "model": CLAP_MODEL, "rate": "per_beat",
                    "rows": int(vecs.shape[0]), "dim": int(vecs.shape[1]), "dtype": "float16", "file": None}
        
        extra_ctx = {}
        out_stem = ctx.get("out_stem")
        if out_stem:
            path = f"{out_stem}.clap.vec.f16"
            vecs.tofile(path)
            contract["file"] = os.path.basename(path)
            extra_ctx["clap_embedding_path"] = path
            extra_ctx["clap_dim"] = int(vecs.shape[1])
            # We don't need to add n_beats again, it will be the same.

        return AnalyzerResult(
            status="ok",
            patch={"clap": contract},
            confidence={"clap": 0.8},
            ctx=extra_ctx,
            notes=f"CLAP beat-pooled, {vecs.shape[0]}x{vecs.shape[1]} float16",
        )
