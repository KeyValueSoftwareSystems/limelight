"""L4 — combined MERT + CLAP embeddings.
"""
from __future__ import annotations

import logging
import os
import numpy as np

from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.combined")

class CombinedEmbeddingAnalyzer(Analyzer):
    name = "combined-embedding"
    level = "L4"

    def analyze(self, audio, sample_rate, ctx):
        mert_path = ctx.get("mert_embedding_path")
        clap_path = ctx.get("clap_embedding_path")
        n_beats = ctx.get("n_beats")
        mert_dim = ctx.get("mert_dim")
        clap_dim = ctx.get("clap_dim")
        
        if not mert_path or not clap_path or not n_beats or not mert_dim or not clap_dim:
            return AnalyzerResult(status="not_computed", notes="missing required inputs for combined embedding")

        mert_vecs = np.fromfile(mert_path, dtype="float16").reshape(n_beats, mert_dim)
        clap_vecs = np.fromfile(clap_path, dtype="float16").reshape(n_beats, clap_dim)
        
        # Concatenate
        combined_vecs = np.concatenate([mert_vecs, clap_vecs], axis=1).astype("float16")
        
        out_stem = ctx.get("out_stem")
        if out_stem:
            path = f"{out_stem}.combined.vec.f16"
            combined_vecs.tofile(path)
            contract_file = os.path.basename(path)
        else:
            contract_file = None

        contract = {"status": "ok", "model": "mert-clap-combined", "rate": "per_beat",
                    "rows": int(combined_vecs.shape[0]), "dim": int(combined_vecs.shape[1]), "dtype": "float16", "file": contract_file}
        
        return AnalyzerResult(
            status="ok",
            patch={"combined_embedding": contract},
            confidence={"combined_embedding": 0.9},
            notes=f"Combined MERT+CLAP, {combined_vecs.shape[0]}x{combined_vecs.shape[1]} float16",
        )
