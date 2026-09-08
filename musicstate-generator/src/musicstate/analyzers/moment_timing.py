"""L2 — re-time drop/stop to the measured loudness step (ports listen/moments.py).

A drop is a sustained step in loudness, not a bar line. Each drop/stop moves to the
beat carrying the biggest median step across 0.5/1.0/1.5/2.0 s shoulders within two
bars, constrained to half-bar positions unless an off-metre beat beats the best
on-metre step by >20%. build/quiet are ramps and are left where they are. Produces
an authoritative events_retimed list; port prefers it.
"""
from __future__ import annotations

import math

import numpy as np

from ..config import (MOMENT_HALF_BAR_OVERRIDE, MOMENT_SEARCH_BEATS,
                      MOMENT_SHOULDERS_S, MOMENT_STEP_HOP_S)
from .base import Analyzer, AnalyzerResult

_RISE, _FALL = {"drop"}, {"stop"}


def _envelope(audio, sr, hop_s=MOMENT_STEP_HOP_S):
    """RMS loudness envelope at hop_s resolution."""
    y = np.asarray(audio, dtype=np.float32)
    hop = max(1, int(sr * hop_s))
    out = []
    for i in range(0, len(y) - hop, hop):
        seg = y[i:i + hop]
        out.append(math.sqrt(float((seg * seg).mean())))
    return out


def _step(env, t, sh, hop_s):
    """Loudness after minus loudness before, over a shoulder of sh seconds."""
    w = max(1, int(sh / hop_s))
    i = int(t / hop_s)
    if i - w < 0 or i + w >= len(env):
        return None
    return sum(env[i:i + w]) / w - sum(env[i - w:i]) / w


def _sustained(env, t, hop_s, shoulders):
    """Median step across the shoulders — one window can be fooled by a silence gap."""
    v = [s for s in (_step(env, t, sh, hop_s) for sh in shoulders) if s is not None]
    if not v:
        return None
    v.sort()
    return v[len(v) // 2] if len(v) % 2 else (v[len(v) // 2 - 1] + v[len(v) // 2]) / 2


class MomentTimingAnalyzer(Analyzer):
    name = "moment-timing"
    level = "L2"

    def analyze(self, audio, sample_rate, ctx):
        beats = ctx.get("beats") or []
        downbeats = ctx.get("downbeats") or []
        events = list(ctx.get("events") or [])
        bpm = ctx.get("tempo_bpm")
        per = (60.0 / bpm) if bpm else None
        retime = [e for e in events if e.get("type") in _RISE | _FALL]
        if not retime or len(beats) < 8 or not per:
            return AnalyzerResult(status="not_computed",
                                  patch={"events_retimed": events}, notes="nothing to re-time")

        bp = beats.index(downbeats[0]) if (downbeats and downbeats[0] in beats) else 0
        ph = beats[0]
        env = _envelope(audio, sample_rate)
        hop_s = MOMENT_STEP_HOP_S
        moved = []
        for x in retime:
            t = x["t"]
            i0 = min(range(len(beats)), key=lambda i: abs(beats[i] - t))
            lo, hi = max(0, i0 - MOMENT_SEARCH_BEATS), min(len(beats), i0 + MOMENT_SEARCH_BEATS + 1)
            cands = [(_sustained(env, beats[i], hop_s, MOMENT_SHOULDERS_S), i) for i in range(lo, hi)]
            cands = [(s, i) for s, i in cands if s is not None]
            if not cands:
                continue
            on_half = [(s, i) for s, i in cands
                       if round((beats[i] - ph) / per - bp) % 2 == 0]
            pick = (lambda c: max(c)) if x["type"] in _RISE else (lambda c: min(c))
            if not on_half:
                j = pick(cands)[1]
            else:
                b_all, b_on = pick(cands), pick(on_half)
                j = b_all[1] if abs(b_all[0]) > abs(b_on[0]) * MOMENT_HALF_BAR_OVERRIDE else b_on[1]
            if abs(beats[j] - t) > 1e-6:
                moved.append({"kind": x["type"], "was": round(t, 6), "now": round(beats[j], 6),
                              "beats": round((beats[j] - t) / per, 2)})
                x["t"] = round(beats[j], 6)

        if not moved:
            return AnalyzerResult(status="not_computed",
                                  patch={"events_retimed": events}, notes="no moment moved")
        decision = {
            "how": "each drop and stop moved to the beat carrying the biggest sustained step in "
                   "loudness within two bars — the step is the median across 0.5/1.0/1.5/2.0 s "
                   "shoulders; half-bar positions are preferred unless an off-metre beat wins by 20%",
            "why": "drops land on bars or half bars; snapping to the nearest downbeat pushed them a "
                   "bar late",
            "moved": moved,
        }
        return AnalyzerResult(
            status="ok",
            patch={"events_retimed": events, "moment_timing": decision},
            notes=f"{len(moved)} moment(s) re-timed",
        )
