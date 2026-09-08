"""L2 override — All-In-One music structure, run in a separate env by subprocess.

One pass → tempo, beats, downbeats, and *labelled* segments (intro/verse/chorus/
drop/…). allin1's natten kernel only has CPU wheels for torch 2.5/2.6, which clash
with the main env's torch, so allin1 lives in `limelight-allin1` and this analyzer
shells out to it. When it succeeds it supersedes the librosa L2 fields.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile

from ..config import allin1_python
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.allin1")

_WORKER = os.path.join(os.path.dirname(__file__), "workers", "allin1_worker.py")


class Allin1Analyzer(Analyzer):
    name = "allin1"
    level = "L2"

    def available(self) -> tuple[bool, str]:
        if not os.path.exists(allin1_python()):
            return False, "limelight-allin1 python not found"
        if not os.path.exists(_WORKER):
            return False, "worker script missing"
        return True, ""

    def analyze(self, audio, sample_rate, ctx):
        source = ctx.get("source_path")
        if not source:
            return AnalyzerResult(status="not_computed", notes="allin1 needs source_path")

        fd, out_path = tempfile.mkstemp(suffix=".allin1.json")
        os.close(fd)
        try:
            log.debug("running allin1 worker on %s", source)
            result = subprocess.run([allin1_python(), _WORKER, source, out_path],
                                    capture_output=True, text=True, timeout=3600)
            if result.returncode != 0:
                return AnalyzerResult(status="failed",
                                      notes=f"allin1 worker rc={result.returncode}: {result.stderr.strip()[-300:]}")
            with open(out_path) as fh:
                data = json.load(fh)
        except (json.JSONDecodeError, OSError) as exc:
            return AnalyzerResult(status="failed", notes=f"bad worker output: {exc}")
        finally:
            if os.path.exists(out_path):
                os.remove(out_path)

        beats = data.get("beats", [])
        downbeats = data.get("downbeats", [])
        sections = [{"t0": s["start"], "t1": s["end"], "label": s.get("label"), "conf": 0.75}
                    for s in data.get("segments", [])]
        patch = {
            "meta_partial": {"tempo_bpm": data.get("bpm")},
            "beats": beats,
            "downbeats": downbeats,
            "sections": sections,
        }
        log.debug("allin1: %d beats, %d downbeats, %d segments", len(beats), len(downbeats), len(sections))
        return AnalyzerResult(
            status="ok",
            patch=patch,
            confidence={"tempo": 0.85, "beats": 0.85, "downbeats": 0.8, "sections": 0.75},
            ctx={"beats": beats, "downbeats": downbeats},
            notes="allin1 (separate env) supersedes librosa L2 — labelled segments, real downbeats",
        )
