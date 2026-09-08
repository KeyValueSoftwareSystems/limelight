"""L4 — dense per-beat embeddings via MERT.

Beat-pooled so the sequence is tempo-invariant nearly for free. The float array
never enters the JSON: it is written to `<stem>.vec.f16` and referenced by name.
The MusicEmbedding contract (model, rate, dim, dtype, file) is fixed, so swapping
MERT for MULE/PANNs later is a config change, not a rewrite.
"""
from __future__ import annotations

import logging
import os

import numpy as np

from ..config import MERT_MODEL
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.embedding")

FRAME_RATE = 75  # MERT hidden states ~75 Hz
WINDOW_S = 30    # chunk length to bound CPU memory on long tracks


class EmbeddingAnalyzer(Analyzer):
    name = "mert-95m"
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
        from transformers import AutoModel, Wav2Vec2FeatureExtractor

        processor = Wav2Vec2FeatureExtractor.from_pretrained(MERT_MODEL, trust_remote_code=True)
        model = AutoModel.from_pretrained(MERT_MODEL, trust_remote_code=True).eval()
        model_sr = int(processor.sampling_rate)
        resampled = librosa.resample(audio, orig_sr=sample_rate, target_sr=model_sr)

        window = int(WINDOW_S * model_sr)
        parts = []
        for start in range(0, len(resampled), window):
            chunk = resampled[start:start + window]
            if len(chunk) < int(0.5 * model_sr):
                break
            inputs = processor(chunk, sampling_rate=model_sr, return_tensors="pt")
            with torch.no_grad():
                out = model(**inputs, output_hidden_states=True)
            parts.append(out.last_hidden_state[0].numpy())
        hidden = np.concatenate(parts, axis=0)
        n_frames, dim = hidden.shape
        frame_times = np.arange(n_frames) / FRAME_RATE
        log.debug("MERT produced %d frames x %d dims", n_frames, dim)

        beats = ctx.get("beats") or []
        if len(beats) >= 2:
            edges = list(beats) + [ctx.get("duration_s", frame_times[-1])]
            rows = []
            for a, b in zip(edges[:-1], edges[1:]):
                seg = hidden[(frame_times >= a) & (frame_times < b)]
                rows.append(seg.mean(0) if len(seg) else np.zeros(dim, dtype="float32"))
            vecs = np.stack(rows).astype("float16")
            rate = "per_beat"
        else:
            vecs = hidden.astype("float16")
            rate = "per_frame_75hz"

        contract = {"status": "ok", "model": MERT_MODEL, "rate": rate,
                    "rows": int(vecs.shape[0]), "dim": int(dim), "dtype": "float16", "file": None}
        out_stem = ctx.get("out_stem")
        if out_stem:
            path = f"{out_stem}.vec.f16"
            vecs.tofile(path)
            contract["file"] = os.path.basename(path)

        return AnalyzerResult(
            status="ok",
            patch={"embedding": contract},
            confidence={"embedding": 0.9},
            notes=f"MERT beat-pooled, {vecs.shape[0]}x{dim} float16",
        )
