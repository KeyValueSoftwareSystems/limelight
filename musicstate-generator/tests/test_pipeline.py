"""Pipeline verification on synthesized ground truth (core analyzers, no models)."""
from __future__ import annotations

import json
import pathlib

import jsonschema
import pytest

import musicstate
from musicstate.pipeline import build, core_analyzers
from musicstate.tools.click_track import write_click

SCHEMA = json.loads(
    (pathlib.Path(musicstate.__file__).parent / "schema" / "musicstate.schema.json").read_text()
)


@pytest.fixture(scope="module")
def click_state(tmp_path_factory):
    wav = tmp_path_factory.mktemp("audio") / "click120.wav"
    write_click(str(wav), bpm=120.0, seconds=16.0)
    return build(str(wav), analyzers=core_analyzers())


def test_schema_valid(click_state):
    jsonschema.validate(click_state, SCHEMA)


@pytest.mark.parametrize("bpm", [90.0, 120.0, 128.0])
def test_tempo_recovered(tmp_path, bpm):
    wav = tmp_path / f"click{int(bpm)}.wav"
    write_click(str(wav), bpm=bpm, seconds=16.0)
    got = build(str(wav), analyzers=core_analyzers())["meta"]["tempo_bpm"]
    assert (got == pytest.approx(bpm, abs=3) or got == pytest.approx(bpm * 2, abs=3)
            or got == pytest.approx(bpm / 2, abs=3)), f"got {got} for {bpm}"


def test_frames_aligned(click_state):
    f = click_state["frames"]
    n = f["n"]
    assert len(f["rms"]) == n == len(f["onset"])
    assert len(f["bands"]["low"]) == n == len(f["bands"]["mid"]) == len(f["bands"]["high"])


def test_downbeats_subset(click_state):
    beats = {round(b, 3) for b in click_state["beats"]}
    assert all(round(d, 3) in beats for d in click_state["downbeats"])


def test_timing_recorded(click_state):
    timing = click_state["provenance"]["timing"]
    assert "total" in timing and "load" in timing
    assert any(k.startswith("L1:") for k in timing)


def test_provenance_levels(click_state):
    levels = {a["level"] for a in click_state["provenance"]["analyzers"]}
    assert {"L1", "L2"} <= levels


def test_placement_analyzers_present_and_degrade(click_state):
    names = {a["name"]: a for a in click_state["provenance"]["analyzers"]}
    for n in ("bar-phase", "moment-derive", "moment-timing"):
        assert n in names, f"{n} not registered in core"
    # a steady click has no drops: derive/timing must no-op cleanly, not fail
    assert names["moment-derive"]["status"] in ("ok", "not_computed")
    assert names["moment-timing"]["status"] == "not_computed"


def test_schema_valid_with_new_keys(click_state):
    jsonschema.validate(click_state, SCHEMA)          # bar-phase writes bar_phase_decision
    assert "bar_phase_decision" in click_state


def test_deep_order_respects_dependencies():
    from musicstate.pipeline import deep_analyzers
    names = [a.name for a in deep_analyzers()]
    # allin1 -> bar-phase -> moment-derive; moment-timing after the accents it may witness
    assert names.index("allin1") < names.index("bar-phase") < names.index("moment-derive")
    assert names.index("librosa-accents") < names.index("moment-timing")
