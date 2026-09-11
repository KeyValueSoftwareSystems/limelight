"""L4 — dense per-beat embeddings via MuQ + frame-level novelty.

Replaces MERT with MuQ-large (OpenMuQ/MuQ-large-msd-iter), the audio encoder from
the MuQ family. Beat-pooled so the sequence is tempo-invariant nearly for free. The
float array never enters the JSON: it is written to `<stem>.vec.f16` and referenced
by name.

Also computes a novelty curve from the same frame features: cosine distance across
a bar-wide window. Novelty rises where the music CHANGES, not where it gets louder.

The embedding contract (model, rate, dim, dtype, file) is unchanged, so readers and
the vectors tier work without modification.
"""
from __future__ import annotations

import logging
import os

import numpy as np

from ..config import MUQ_MODEL, MUQ_SR
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.embedding")

WINDOW_S = 10.0  # chunk length to bound GPU memory on long tracks


class EmbeddingAnalyzer(Analyzer):
    name = "muq-large"
    level = "L4"

    def available(self) -> tuple[bool, str]:
        try:
            import torch  # noqa: F401
            from muq import MuQ  # noqa: F401
        except Exception as exc:  # noqa: BLE001
            return False, f"torch/muq missing ({exc.__class__.__name__})"
        return True, ""

    def analyze(self, audio, sample_rate, ctx):
        import librosa
        import torch
        from muq import MuQ

        dev = "cuda" if torch.cuda.is_available() else "cpu"
        model = MuQ.from_pretrained(MUQ_MODEL).to(dev).eval()
        resampled = librosa.resample(audio, orig_sr=sample_rate, target_sr=MUQ_SR)

        window = int(WINDOW_S * MUQ_SR)
        parts = []
        for start in range(0, len(resampled), window):
            chunk = resampled[start:start + window]
            if len(chunk) < int(0.5 * MUQ_SR):
                break
            with torch.no_grad():
                out = model(
                    torch.tensor(chunk).unsqueeze(0).to(dev),
                    output_hidden_states=False,
                )
            parts.append(out.last_hidden_state[0].float().cpu().numpy())

        del model
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        hidden = np.concatenate(parts, axis=0)
        n_frames, dim = hidden.shape
        duration = len(resampled) / MUQ_SR
        frame_rate = n_frames / duration
        frame_times = np.arange(n_frames) / frame_rate
        log.debug("MuQ produced %d frames x %d dims @ %.1f Hz", n_frames, dim, frame_rate)

        # beat-pooled embeddings: mean of frames between consecutive beats, L2-normalised
        beats = ctx.get("beats") or []
        if len(beats) >= 2:
            edges = list(beats) + [ctx.get("duration_s", frame_times[-1])]
            rows = []
            for a, b in zip(edges[:-1], edges[1:]):
                seg = hidden[(frame_times >= a) & (frame_times < b)]
                v = seg.mean(0) if len(seg) else np.zeros(dim, dtype="float32")
                n = np.linalg.norm(v)
                rows.append(v / n if n > 1e-9 else v)
            vecs = np.stack(rows).astype("float16")
            rate = "per_beat"
        else:
            vecs = hidden.astype("float16")
            rate = f"per_frame_{round(frame_rate)}hz"

        # novelty: cosine distance between bar-wide windows, sampled at beat times
        novelty_data = None
        if len(beats) >= 4:
            median_ibi = float(np.median(np.diff(beats)))
            bar_s = median_ibi * 4
            novelty_data = _novelty(hidden, frame_rate, bar_s, beats)

        contract = {
            "status": "ok", "model": MUQ_MODEL, "rate": rate,
            "rows": int(vecs.shape[0]), "dim": int(dim), "dtype": "float16", "file": None,
        }
        out_stem = ctx.get("out_stem")
        if out_stem:
            path = f"{out_stem}.vec.f16"
            vecs.tofile(path)
            contract["file"] = os.path.basename(path)

        patch: dict = {"embedding": contract}
        if novelty_data:
            patch["novelty"] = novelty_data

        notes = f"MuQ beat-pooled, {vecs.shape[0]}x{dim} float16"
        if novelty_data:
            notes += f", novelty at {len(novelty_data['at'])} beats"

        return AnalyzerResult(
            status="ok",
            patch=patch,
            confidence={"embedding": 0.9},
            ctx={"frame_rate": frame_rate},
            notes=notes,
        )


def _novelty(hidden, frame_rate, bar_s, times):
    """Cosine distance between bar-wide windows, sampled at the given times."""
    n = hidden.shape[0]
    w = max(1, int(bar_s * frame_rate))
    raw = np.zeros(n)
    for i in range(w, n - w):
        a = hidden[i - w:i].mean(axis=0)
        b = hidden[i:i + w].mean(axis=0)
        na, nb = np.linalg.norm(a), np.linalg.norm(b)
        raw[i] = 1.0 - float(a @ b / (na * nb)) if na > 1e-9 and nb > 1e-9 else 0.0
    peak = raw.max() or 1.0
    raw /= peak
    at, val = [], []
    for t in times:
        i = int(t * frame_rate)
        at.append(round(float(t), 3))
        val.append(round(float(raw[i]) if 0 <= i < n else 0.0, 4))
    return {
        "rate": "per_beat",
        "unit": "0-1, 1 = the biggest timbral change in this song",
        "how": (f"cosine distance between {MUQ_MODEL} frame embeddings averaged "
                f"over one bar ({bar_s:.2f}s) either side"),
        "not": ("not loudness. This rises where the music CHANGES, which is often "
                "where nothing gets louder"),
        "at": at,
        "value": val,
    }
