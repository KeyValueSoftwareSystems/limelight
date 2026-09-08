"""L2 — beat-synchronous chord recognition from chroma.

Per bar (between consecutive downbeats), the pooled chroma is matched against 36
triad templates — major, minor, dominant-7 — and the label sequence is median-
smoothed across three bars so a single noisy bar does not flip the chord. Template
matching, not a model: honest mid-range confidence, and it degrades to a fixed
window when no downbeats are available.

Writes ``state["chords"]``; ``port.to_map`` lifts it into ``observations.chords``.
"""
from __future__ import annotations

import logging

import librosa
import numpy as np

from ..config import HOP_LENGTH
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.chords")

_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def _templates() -> tuple[np.ndarray, list[str]]:
    """36 unit-norm templates: major 'C', minor 'Cm', dominant-7 'C7'."""
    maj = np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], dtype=float)   # root, +4, +7
    minr = np.array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0], dtype=float)  # root, +3, +7
    dom7 = np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], dtype=float)  # root, +4, +7, +10
    mats, labels = [], []
    for root in range(12):
        for base, suffix in ((maj, ""), (minr, "m"), (dom7, "7")):
            mats.append(np.roll(base, root))
            labels.append(_NOTES[root] + suffix)
    templates = np.array(mats)
    templates /= np.linalg.norm(templates, axis=1, keepdims=True)
    return templates, labels


_TEMPLATES, _LABELS = _templates()


class ChordsAnalyzer(Analyzer):
    name = "chroma-templates"
    level = "L2"

    def __init__(self, hop_length: int = HOP_LENGTH):
        self.hop_length = hop_length

    def analyze(self, audio, sample_rate, ctx):
        hop = self.hop_length
        hop_s = float(ctx.get("hop_s", hop / sample_rate))
        chroma = ctx.get("chroma")
        if chroma is None:
            chroma = librosa.feature.chroma_cqt(y=audio, sr=sample_rate, hop_length=hop)
        chroma = np.asarray(chroma, dtype=float)  # (12, n)
        n = chroma.shape[1]
        duration = float(ctx.get("duration_s", n * hop_s))

        # one span per bar (downbeats); fall back to a fixed 2 s window
        bounds = self._bar_bounds(ctx, n, hop_s)
        raw = []  # (at_seconds, label, score)
        for a, b in zip(bounds[:-1], bounds[1:]):
            if b <= a:
                continue
            vec = chroma[:, a:b].mean(axis=1)
            norm = float(np.linalg.norm(vec))
            if norm <= 1e-8:
                raw.append((round(a * hop_s, 3), "N", 0.0))  # no pitch content
                continue
            scores = _TEMPLATES @ (vec / norm)
            best = int(np.argmax(scores))
            raw.append((round(a * hop_s, 3), _LABELS[best], round(float(scores[best]), 3)))

        smoothed = self._median_smooth([lbl for _, lbl, _ in raw], window=3)
        events = [{"at": at, "chord": lbl, "confidence": conf}
                  for (at, _, conf), lbl in zip(raw, smoothed)]
        mean_conf = round(float(np.mean([e["confidence"] for e in events])), 3) if events else 0.0

        log.debug("labelled %d bars, mean confidence %.3f", len(events), mean_conf)
        return AnalyzerResult(
            status="ok",
            patch={"chords": {
                "rate": "per_bar",
                "how": "chroma template match over the mix, 36 templates "
                       "(maj, min, dom7), median-smoothed across 3 bars",
                "events": events,
            }},
            confidence={"chords": mean_conf},
            notes="per-bar chroma template match; whole mix (per-stem is the deep upgrade)",
        )

    def _bar_bounds(self, ctx, n: int, hop_s: float) -> list[int]:
        downbeats = ctx.get("downbeats") or []
        if len(downbeats) >= 2:
            frames = sorted({0} | {int(round(t / hop_s)) for t in downbeats} | {n})
        else:
            step = max(1, int(round(2.0 / hop_s)))
            frames = list(range(0, n, step)) + [n]
        return [f for f in frames if 0 <= f <= n]

    @staticmethod
    def _median_smooth(labels: list[str], window: int = 3) -> list[str]:
        if len(labels) < window:
            return labels
        half = window // 2
        out = []
        for i in range(len(labels)):
            lo, hi = max(0, i - half), min(len(labels), i + half + 1)
            neighborhood = labels[lo:hi]
            out.append(max(set(neighborhood), key=neighborhood.count))
        return out
