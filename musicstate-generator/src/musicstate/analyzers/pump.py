"""L2 — the sidechain pump: the duck-and-swell a kick-keyed compressor puts on a mix.

Ports listen/pump.py. The envelope is taken above 250 Hz so the kick body is
excluded, then the slope from 18% to 72% of each beat is measured: a sidechained
mix RISES between kicks (the compressor letting go), an un-sidechained one DECAYS.
The sign of that slope is the whole test, so it does not depend on how loud the
record is. Mix-only, needs only the beat grid.
"""
from __future__ import annotations

import numpy as np
from scipy.signal import lfilter

from ..config import PUMP_BINS, PUMP_HI, PUMP_HP_HZ, PUMP_LO, PUMP_PRESENT
from ..segments import merge_sections
from .base import Analyzer, AnalyzerResult


def _hp_envelope(audio, sr, hp_hz=PUMP_HP_HZ, hop_s=0.005):
    """RMS of the signal above hp_hz (signal minus a one-pole low-pass), per hop."""
    a = float(np.exp(-2 * np.pi * hp_hz / sr))
    low = lfilter([1 - a], [1.0, -a], np.asarray(audio, dtype=np.float64))
    hp = np.asarray(audio, dtype=np.float64) - low
    hop = max(1, int(sr * hop_s))
    n = (len(hp) // hop) * hop
    sq = (hp[:n] ** 2).reshape(-1, hop).mean(axis=1)
    return np.sqrt(sq), hop / sr


def _recovery(env, dt, beats, t0=None, t1=None):
    """Mean climb from just after one kick to just before the next (positive = pump)."""
    vals = []
    for i in range(len(beats) - 1):
        b, nb = beats[i], beats[i + 1]
        if (t0 is not None and b < t0) or (t1 is not None and b > t1):
            continue
        per = nb - b
        if per <= 0 or per > 2.0:
            continue
        ja, jb = int((b + per * PUMP_LO) / dt), int((b + per * PUMP_HI) / dt)
        if ja < 0 or jb >= len(env) or jb - ja < 3:
            continue
        seg = env[ja:jb]
        third = max(1, len(seg) // 3)
        first, last = float(seg[:third].mean()), float(seg[-third:].mean())
        if first + last > 0:
            vals.append((last - first) / (last + first))
    if not vals:
        return 0.0, 0
    return sum(vals) / len(vals), len(vals)


def _fold(env, dt, beats):
    acc, cnt = [0.0] * PUMP_BINS, [0] * PUMP_BINS
    for i in range(len(beats) - 1):
        b, nb = beats[i], beats[i + 1]
        per = nb - b
        if per <= 0 or per > 2.0:
            continue
        for k in range(PUMP_BINS):
            j = int((b + per * (k + 0.5) / PUMP_BINS) / dt)
            if 0 <= j < len(env):
                acc[k] += env[j]
                cnt[k] += 1
    if min(cnt) == 0:
        return None
    return [acc[k] / cnt[k] for k in range(PUMP_BINS)]


def _release(shape):
    seg = shape[int(PUMP_BINS * PUMP_LO):int(PUMP_BINS * PUMP_HI)]
    if len(seg) < 3:
        return None
    lo, hi = min(seg), max(seg)
    if hi <= lo:
        return None
    target = lo + 0.63 * (hi - lo)
    for k, v in enumerate(seg):
        if v >= target:
            return round(PUMP_LO + (k / len(seg)) * (PUMP_HI - PUMP_LO), 3)
    return None


class PumpAnalyzer(Analyzer):
    name = "pump"
    level = "L2"

    def analyze(self, audio, sample_rate, ctx):
        beats = ctx.get("beats") or []
        if len(beats) < 8:
            return AnalyzerResult(status="not_computed", patch={}, notes="no beats")
        env, dt = _hp_envelope(audio, sample_rate)
        shape = _fold(env, dt, beats)
        if shape is None:
            return AnalyzerResult(status="not_computed", patch={}, notes="not enough beats")
        depth, nbeats = _recovery(env, dt, beats)
        peak = max(shape) or 1.0

        per_section = []
        merged = merge_sections(ctx.get("sections") or [])
        for m in merged:
            d, n = _recovery(env, dt, beats, m["at"], m["to"])
            if n >= 8:
                per_section.append([round(m["at"], 3), round(d, 4), bool(d >= PUMP_PRESENT)])

        pump = {
            "how": "envelope above 250 Hz (kick body excluded), slope from 18% to 72% of each "
                   "beat; a sidechained mix rises between kicks, an un-sidechained one decays",
            "rate": "per_beat_phase", "bins": PUMP_BINS,
            "present": bool(depth >= PUMP_PRESENT),
            "depth": round(depth, 4), "beats_measured": nbeats,
            "release_at_beat_fraction": _release(shape),
            "shape": [round(v / peak, 4) for v in shape],
            "per_chapter": per_section,
        }
        return AnalyzerResult(status="ok", patch={"pump": pump},
                              confidence={"pump": 0.7}, notes=f"depth {depth:+.3f}")
