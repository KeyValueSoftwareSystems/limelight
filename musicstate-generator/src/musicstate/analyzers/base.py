"""The contract every analyzer obeys.

One level of the pipeline, one method. Swap what fills a level (librosa → allin1,
in-process → subprocess) and nothing downstream changes: the pipeline assembles the
MusicState from whatever patches the analyzers return.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AnalyzerResult:
    """What one analyzer contributes to the shared state."""

    status: str  # "ok" | "not_computed" | "failed"
    patch: dict[str, Any] = field(default_factory=dict)  # merged into the MusicState
    confidence: dict[str, float] = field(default_factory=dict)  # per-field, 0..1
    ctx: dict[str, Any] = field(default_factory=dict)  # passed to later analyzers
    notes: str = ""


class Analyzer:
    """Base class. `name` and `level` identify the analyzer in the provenance log."""

    name: str = "base"
    level: str = ""  # "L1" | "L2" | "L3" | "L4"

    def available(self) -> tuple[bool, str]:
        """Whether this analyzer can run here. Returning False degrades gracefully."""
        return True, ""

    def analyze(self, audio, sample_rate: int, ctx: dict[str, Any]) -> AnalyzerResult:  # noqa: ANN001
        raise NotImplementedError
