"""L4 — polyphonic note transcription: discrete note events (pitch + onset/offset).

Spotify's basic-pitch (ICASSP 2022) via its ONNX backend — chosen over the
TensorFlow backend so it runs in-process in ``limelight-ms`` without a second env.
Degrades gracefully: if basic-pitch or its ONNX model is absent it is recorded
``not_available`` and the rest of the map is unaffected.

Writes ``state["notes"]``; ``port.to_map`` lifts it into ``observations.notes``.
On the whole mix here; the reference's per-stem transcription (Demucs) is the
richer upgrade and writes the same field, keyed per source.
"""
from __future__ import annotations

import logging
import os

from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.notes")

# quiet basic-pitch's TensorFlow import banner before it is imported
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")


def _onnx_model_path() -> str | None:
    """The ONNX ICASSP-2022 model file basic-pitch ships, if present."""
    try:
        from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
        path = build_icassp_2022_model_path(FilenameSuffix.onnx)
    except Exception:  # noqa: BLE001
        try:
            from basic_pitch import ICASSP_2022_MODEL_PATH
            path = str(ICASSP_2022_MODEL_PATH)
        except Exception:  # noqa: BLE001
            return None
    return path if path and os.path.exists(path) else None


class NoteTranscriptionAnalyzer(Analyzer):
    name = "basic-pitch"
    level = "L4"

    def available(self) -> tuple[bool, str]:
        import importlib.util
        if importlib.util.find_spec("basic_pitch") is None:
            return False, "basic-pitch not installed"
        if importlib.util.find_spec("onnxruntime") is None:
            return False, "onnxruntime not installed"
        if _onnx_model_path() is None:
            return False, "basic-pitch ONNX model not found"
        return True, ""

    def analyze(self, audio, sample_rate, ctx):
        source = ctx.get("source_path")
        if not source:
            return AnalyzerResult(status="not_computed", notes="basic-pitch needs source_path")

        from basic_pitch.inference import predict
        model = _onnx_model_path()
        log.debug("basic-pitch (onnx) on %s", source)
        _, _, note_events = predict(source, model)

        # note_events: (onset_s, offset_s, midi_pitch, amplitude, pitch_bends)
        events = [[round(float(on), 3), round(float(off), 3), int(pitch), round(float(amp), 3)]
                  for on, off, pitch, amp, *_ in note_events]
        events.sort(key=lambda e: (e[0], e[2]))

        return AnalyzerResult(
            status="ok",
            patch={"notes": {
                "how": "Spotify basic-pitch (ICASSP 2022) via the ONNX backend, "
                       "polyphonic, whole mix",
                "format": "[onset_s, offset_s, midi, amplitude]",
                "note": "Whole-mix transcription. Per-stem (Demucs) is the deep upgrade; "
                        "diatonic accuracy is not asserted here.",
                "sources": {"mix": events},
            }},
            confidence={"notes": 0.6},
            notes=f"basic-pitch onnx: {len(events)} note events (whole mix)",
        )
