import json
import os

import pytest

from score import Score

HERE = os.path.dirname(os.path.abspath(__file__))
LEVELS = os.path.join(HERE, "..", "levels.score.json")


def mini(first_beat=2.0, bpm=120.0, shift_lanes_from=0):
    """A tiny score: 8 bars, drums enter at bar 4, energy lane per bar."""
    return {
        "score": "mini", "song": {"length_s": 2.0 + 8 * 2.0},
        "grid": {"bpm": bpm, "first_beat_s": first_beat, "beats_per_bar": 4, "bars": 8, "first_bar": 0,
                 "tempo": [{"from_beat": 0, "at_s": first_beat, "bpm": bpm}]},
        "sections": [
            {"from": {"bar": 0, "beat": 1}, "to": {"bar": 4, "beat": 1}, "name": "intro", "nth": 1, "like": "A",
             "stems": {"drums": {"is": "none"}, "bass": {"is": "none"}, "vocals": {"is": "none"}, "other": {"is": "full"}}},
            {"from": {"bar": 4, "beat": 1}, "to": {"bar": 8, "beat": 1}, "name": "drop", "nth": 1, "like": "B", "rise": 0.1,
             "stems": {"drums": {"is": "full"}, "bass": {"is": "full"}, "vocals": {"is": "none"}, "other": {"is": "some"}}},
        ],
        "energy": {"per": "bar", "from_bar": shift_lanes_from, "values": [0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.2, 0.9]},
        "pace": [0.0, 0.0, 0.0, 0.0, 1.5, 1.5, 1.5, 1.5],
        "curves": {"pace": {"per": "bar", "from_bar": shift_lanes_from}},
        "stems": {"from_bar": shift_lanes_from, "lanes": {"drums": [0, 0, 0, 0, 1, 1, 0.3, 1], "vocals": [0] * 8}},
        "harmony": {"from_bar": shift_lanes_from, "chords": ["C#m", "A", "C#m", "A", "C#m", "A", "E", "A"]},
        "phrases": [{"from_bar": 4, "to_bar": 7, "in": "drop", "in_nth": 1, "doing": "peaking", "also": [],
                     "says": "drums join", "energy": 0.9, "rise": 0.0, "playing": ["drums"], "has_break": True}],
        "moments": [{"at": {"bar": 4, "beat": 1}, "is": "entrance", "what": "drums", "sure": 1.0, "weight": 0.9},
                    {"at": {"bar": 2, "beat": 1}, "is": "pause", "what": "everything", "sure": 0.8, "weight": 0.5, "for_beats": 4}],
    }


def test_positions_to_seconds_and_back():
    sc = Score(mini())
    assert sc.beat_s == pytest.approx(0.5) and sc.bar_s == pytest.approx(2.0)
    assert sc.t(0, 1) == pytest.approx(2.0)
    assert sc.t(4, 1) == pytest.approx(10.0) and sc.t(4, 3) == pytest.approx(11.0)
    assert sc.bar_at(10.2) == 4 and sc.bar_at(9.9) == 3
    assert sc.beat_index(11.2) == 18 and sc.beat_phase(11.25) == pytest.approx(0.5)
    assert sc.bar_phase(10.5) == pytest.approx(0.25)
    assert sc.beat_in_bar(11.0) == 2


def test_bar_shift_moves_every_position_by_whole_bars():
    sc = Score(mini(), bar_shift=-1)
    assert sc.t(4, 1) == pytest.approx(8.0)                 # one bar earlier than unshifted
    assert sc.bar_at(8.5) == 4                              # ...and bar_at agrees, so lanes still index by score bar
    assert sc.lane("energy", 8.5) == pytest.approx(0.9)
    assert sc.sections[1].from_s == pytest.approx(8.0)


def test_lanes_respect_from_bar_and_clamp():
    sc = Score(mini(shift_lanes_from=1))                    # lane index 0 is bar 1 now
    assert sc.lane_bar("energy", 5) == pytest.approx(0.9)   # bar 5 -> values[4]
    assert sc.lane_bar("energy", 0) == pytest.approx(0.1)   # before the lane: clamped to the first value
    assert sc.lane_bar("energy", 99) == pytest.approx(0.9)  # after: last value
    assert sc.lane_bar("drums", 5) == pytest.approx(1.0)
    assert sc.lane_bar("pace", 5) == pytest.approx(1.5)
    assert sc.chord_bar(2) == "A"
    assert sc.lane_bar("nonexistent", 3, default=0.42) == pytest.approx(0.42)


def test_lane_smooth_interpolates_across_the_bar():
    sc = Score(mini())
    assert sc.lane_smooth("energy", sc.t(3, 1)) == pytest.approx(0.1)
    assert sc.lane_smooth("energy", sc.t(3, 3)) == pytest.approx(0.5)      # halfway from 0.1 to 0.9


def test_structure_in_seconds():
    sc = Score(mini())
    secs = sc.sections
    assert [s.name for s in secs] == ["intro", "drop"]
    assert secs[1].from_s == pytest.approx(10.0) and secs[1].to_s == pytest.approx(18.0)
    assert secs[1].stems["drums"] == "full" and secs[0].bars == 4
    ph = sc.phrases[0]
    assert ph.to_bar == 8 and ph.has_break and ph.to_s == pytest.approx(18.0)
    m = {x.is_: x for x in sc.moments}
    assert m["entrance"].t_s == pytest.approx(10.0)
    assert m["pause"].t_s == pytest.approx(6.0) and m["pause"].to_s == pytest.approx(8.0)
    beats, downs = sc.grid_beats()
    assert beats[0] == pytest.approx(0.0) and downs[0] == pytest.approx(0.0)    # extrapolated back to the start
    assert 2.0 in downs and 10.0 in downs and all(b < sc.duration for b in beats)


def test_tempo_map_with_two_segments():
    d = mini()
    d["grid"]["tempo"] = [{"from_beat": 0, "at_s": 2.0, "bpm": 120.0}, {"from_beat": 8, "at_s": 6.0, "bpm": 60.0}]
    sc = Score(d)
    assert sc.t(2, 1) == pytest.approx(6.0)                 # beat 8 exactly at the segment start
    assert sc.t(3, 1) == pytest.approx(10.0)                # 4 beats at 60 bpm
    assert sc.bar_at(9.9) == 2 and sc.beat_phase(6.5) == pytest.approx(0.5)


@pytest.mark.skipif(not os.path.isfile(LEVELS), reason="levels.score.json not present")
def test_levels_score_reads_and_the_first_drop_lands_where_the_drums_are():
    sc = Score(LEVELS, bar_shift=-1)
    assert sc.bpm == pytest.approx(128.01) and sc.duration == pytest.approx(237.145)
    drop = [s for s in sc.sections if s.name == "drop"][0]
    assert drop.from_s == pytest.approx(19.86, abs=0.02)   # measured bass entrance in levels.wav
    assert sc.chord(drop.from_s + 0.1) == "C#m" and sc.chord(drop.from_s + sc.bar_s + 0.1) == "A"
    assert sc.lane("energy", drop.from_s + 0.1) > 0.8


# --- new fields the dont-look-down brief leans on -------------------------------------
def mini_signals():
    d = mini()
    d["tension"] = {"per": "beat", "from_bar": 0, "from_beat": 1,
                    "values": [0.1, 0.1, 0.1, 0.1,  0.1, 0.1, 0.1, 0.1,  0.2, 0.3, 0.5, 0.7,
                               0.8, 0.9, 0.9, 0.9,  0.9, 0.8, 0.5, 0.4,  0.4, 0.4, 0.4, 0.4,
                               0.4, 0.4, 0.4, 0.4,  0.4, 0.4, 0.4, 0.4]}
    d["signals"] = [
        {"bar": 5, "beat": 1, "is": "rise", "what": "everything", "for_beats": 8, "sure": 0.8, "weight": 0.3},
        {"bar": 6, "beat": 1, "is": "change", "what": "double time", "sure": 0.9, "weight": 0.7},
    ]
    d["moments"] = d["moments"] + [
        {"at": {"bar": 6, "beat": 3}, "is": "release", "what": "tension", "after_beats": 5, "sure": 0.5, "weight": 0.8},
        {"at": {"bar": 2, "beat": 1}, "is": "pause", "what": "everything but voice", "for_beats": 4,
         "back_at": 3, "still": ["voice"], "sure": 0.86, "weight": 0.89},
    ]
    return d


def test_tension_is_read_per_beat():
    sc = Score(mini_signals())
    assert sc.tension(sc.t(0, 1)) == pytest.approx(0.1)
    assert sc.tension(sc.t(3, 1)) == pytest.approx(0.8)      # bar 3 beat 1 -> index 12
    assert sc.tension(sc.t(3, 2)) == pytest.approx(0.9)
    assert sc.tension_bar(3) == pytest.approx((0.8 + 0.9 + 0.9 + 0.9) / 4)
    assert sc.tension(sc.t(99, 1), default=-1.0) == pytest.approx(-1.0)   # past the values: the default, not a guess
    assert sc.beat_lane_at("tension", 3, 1) == pytest.approx(0.8)


def test_signals_and_richer_moments():
    sc = Score(mini_signals())
    sigs = {s.is_ for s in sc.signals}
    assert "rise" in sigs and "change" in sigs
    rise = [s for s in sc.signals if s.is_ == "rise"][0]
    assert rise.bar == 5 and rise.for_beats == 8 and rise.t_s == pytest.approx(sc.t(5, 1))
    pause = [m for m in sc.moments if m.is_ == "pause" and m.still][0]
    assert pause.still == ["voice"] and pause.back_at == 3 and pause.for_beats == 4
    assert pause.to_s == pytest.approx(pause.t_s + 4 * sc.beat_s)
    rel = [m for m in sc.moments if m.is_ == "release"][0]
    assert rel.after_beats == 5


def test_rise_ramp_covers_the_declared_span():
    sc = Score(mini_signals())
    a = sc.t(5, 1)
    assert sc.ramp(a - 0.01) is None                       # before the rise
    assert sc.ramp(a) == pytest.approx(0.0, abs=1e-6)
    assert sc.ramp(a + 4 * sc.beat_s) == pytest.approx(0.5, abs=0.02)   # halfway through 8 beats
    assert sc.ramp(a + 8 * sc.beat_s) is None              # after it ends


def test_bar_of_beat_matches_bar_at():
    sc = Score(mini_signals())
    for bar in range(0, 8):
        k = sc.beat_index(sc.t(bar, 1) + 1e-4)
        assert sc.bar_of_beat(k) == bar
