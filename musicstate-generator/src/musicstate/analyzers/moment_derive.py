"""L2 — candidate drop/build/quiet events from chapter labels + energy.

Relocated out of port._derive_moments (2026-09-08) so port measures nothing about
moments. Emits candidates at the *measured* chapter boundary — unsnapped — because
MomentTimingAnalyzer re-times drops/stops to the loudness step afterwards.
"""
from __future__ import annotations

from ..config import DROP_LABELS, QUIET_LABELS
from ..segments import merge_sections
from .base import Analyzer, AnalyzerResult


def _mean_energy(energy, t0, t1):
    vals = [v for (tt, v) in energy if t0 <= tt < t1]
    if vals:
        return sum(vals) / len(vals)
    mid, last = (t0 + t1) / 2.0, (energy[0][1] if energy else 0.5)
    for tt, vv in energy:
        if tt <= mid:
            last = vv
        else:
            break
    return last


class MomentDeriveAnalyzer(Analyzer):
    name = "moment-derive"
    level = "L2"

    def analyze(self, audio, sample_rate, ctx):
        sections = ctx.get("sections") or []
        energy = ctx.get("energy") or []
        merged = merge_sections(sections)
        # a handful of energy samples cannot say which section is loud (rule 2)
        if not merged or len(energy) < 8:
            return AnalyzerResult(status="not_computed", patch={"events": []},
                                  notes="no sections or too little energy")
        for m in merged:
            m["_e"] = _mean_energy(energy, m["at"], m["to"])
        es = sorted(m["_e"] for m in merged)
        lo, hi = es[len(es) // 4], es[max(0, 3 * len(es) // 4)]
        span = max(1e-3, hi - lo)
        out = []
        for i, m in enumerate(merged):
            name = (m["name"] or "").lower()
            e = m["_e"]
            rise = e - (merged[i - 1]["_e"] if i > 0 else e)
            is_drop = (name in DROP_LABELS and e >= lo + 0.35 * span) or e >= lo + 0.65 * span
            is_quiet = (name in QUIET_LABELS and e <= lo + 0.4 * span) or e <= lo + 0.15 * span
            if is_drop:
                out.append({"t": round(m["at"], 4), "type": "drop",
                            "conf": round(min(1.0, 0.5 + max(0.0, rise) * 2), 3),
                            "size": round(min(1.0, 0.6 + (e - lo) / span * 0.4), 3)})
            elif is_quiet and i > 0:
                out.append({"t": round(m["at"], 4), "type": "quiet",
                            "conf": round(min(1.0, 0.5 + (lo - e) + 0.2), 3)})
        cumulative = list(ctx.get("events") or []) + out
        return AnalyzerResult(status="ok", patch={"events": out},
                              ctx={"events": cumulative},
                              notes=f"{len(out)} candidate moments")
