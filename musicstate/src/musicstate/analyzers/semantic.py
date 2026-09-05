"""L3 — semantic tags (mood, danceability, voice, genre) via Essentia, by subprocess.

Essentia's TensorFlow cannot share an interpreter with the torch family, so it runs
in `limelight-ess` and this analyzer shells out to its worker. Same Analyzer contract
as everything else — the process hop is invisible upstream.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess

from ..config import ESSENTIA_EMBEDDING, essentia_models_dir, essentia_python
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.semantic")

_WORKER = os.path.join(os.path.dirname(__file__), "workers", "essentia_worker.py")


class SemanticAnalyzer(Analyzer):
    name = "essentia-discogs-effnet"
    level = "L3"

    def __init__(self, models_dir: str | None = None):
        self.models_dir = models_dir or essentia_models_dir()

    def available(self) -> tuple[bool, str]:
        if not os.path.exists(essentia_python()):
            return False, "limelight-ess python not found"
        if not os.path.exists(os.path.join(self.models_dir, ESSENTIA_EMBEDDING)):
            return False, f"essentia models missing in {self.models_dir}"
        if not os.path.exists(_WORKER):
            return False, "worker script missing"
        return True, ""

    def analyze(self, audio, sample_rate, ctx):
        source = ctx.get("source_path")
        if not source:
            return AnalyzerResult(status="not_computed", notes="essentia needs source_path")

        log.debug("running essentia worker on %s", source)
        result = subprocess.run([essentia_python(), _WORKER, source, self.models_dir],
                                capture_output=True, text=True, timeout=900)
        if result.returncode != 0:
            return AnalyzerResult(status="failed", patch={"semantic": {"status": "failed"}},
                                  notes=f"essentia worker rc={result.returncode}: {result.stderr.strip()[-300:]}")
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            return AnalyzerResult(status="failed", patch={"semantic": {"status": "failed"}},
                                  notes=f"bad worker output: {exc}; {result.stdout[:200]}")
        return AnalyzerResult(
            status="ok",
            patch={"semantic": data},
            confidence={"semantic": 0.6},
            notes="essentia discogs-effnet heads via subprocess (separate env)",
        )
