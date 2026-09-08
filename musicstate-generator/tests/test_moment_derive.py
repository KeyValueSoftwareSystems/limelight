"""Unit tests for MomentDeriveAnalyzer + the section-merge helper (pure, no audio)."""
from __future__ import annotations

from musicstate.analyzers.moment_derive import MomentDeriveAnalyzer
from musicstate.segments import merge_sections


def test_merge_sections_collapses_runs():
    secs = [{"t0": 0, "t1": 5, "label": "intro"},
            {"t0": 5, "t1": 10, "label": "chorus"},
            {"t0": 10, "t1": 15, "label": "chorus"}]
    assert [m["name"] for m in merge_sections(secs)] == ["intro", "chorus"]


def test_derive_emits_unsnapped_drop_on_loud_chorus():
    ctx = {
        "sections": [{"t0": 0.0, "t1": 8.0, "label": "intro", "energy": 0.2, "conf": 0.5},
                     {"t0": 8.3, "t1": 16.0, "label": "chorus", "energy": 0.9, "conf": 0.5},
                     {"t0": 16.0, "t1": 24.0, "label": "break", "energy": 0.1, "conf": 0.5}],
        "energy": [[t, e] for t, e in [(0, .2), (2, .2), (4, .2), (6, .2),
                                       (8.3, .9), (12, .9), (16, .1), (20, .1)]],
        "tempo_bpm": 120.0,
    }
    res = MomentDeriveAnalyzer().analyze(None, 22050, ctx)
    drops = [e for e in res.patch["events"] if e["type"] == "drop"]
    assert len(drops) == 1
    assert drops[0]["t"] == 8.3            # unsnapped: the measured chapter start
    quiets = [e for e in res.patch["events"] if e["type"] == "quiet"]
    assert quiets and quiets[0]["t"] == 16.0


def test_derive_no_energy_is_not_computed():
    res = MomentDeriveAnalyzer().analyze(None, 22050, {"sections": [], "energy": [], "tempo_bpm": 120})
    assert res.status == "not_computed"
    assert res.patch.get("events", []) == []
