"""Swappable per-level analyzers. Each fills one level of the MusicState."""
from .allin1 import Allin1Analyzer
from .base import Analyzer, AnalyzerResult
from .dsp import DspAnalyzer
from .embedding import EmbeddingAnalyzer
from .semantic import SemanticAnalyzer
from .stems import StemsAnalyzer
from .structure import StructureAnalyzer

__all__ = [
    "Analyzer",
    "AnalyzerResult",
    "DspAnalyzer",
    "StructureAnalyzer",
    "Allin1Analyzer",
    "StemsAnalyzer",
    "SemanticAnalyzer",
    "EmbeddingAnalyzer",
]
