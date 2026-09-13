import numpy as np
import pytest

import rig
import effects
import arrange
from effects import LIBRARY, Look, ROLES, EVENT_ORDER
from score import Score
from test_score import mini


def demo_score():
    """intro(0-4) drop(4-8, break at bar 6) breakdown(8-12, rising) drop(12-20) verse(20-24 vocals) outro(24-28)"""
    d = mini()
    d["song"]["length_s"] = 2.0 + 28 * 2.0
    d["grid"]["bars"] = 28
    st = lambda dr, ba, vo, ot: {"drums": {"is": dr}, "bass": {"is": ba}, "vocals": {"is": vo}, "other": {"is": ot}}
    d["sections"] = [
        {"from": {"bar": 0, "beat": 1}, "to": {"bar": 4, "beat": 1}, "name": "intro", "nth": 1, "like": "A", "rise": 0.0, "stems": st("none", "none", "none", "full")},
        {"from": {"bar": 4, "beat": 1}, "to": {"bar": 8, "beat": 1}, "name": "drop", "nth": 1, "like": "B", "rise": 0.1, "stems": st("full", "full", "none", "some")},
        {"from": {"bar": 8, "beat": 1}, "to": {"bar": 12, "beat": 1}, "name": "breakdown", "nth": 1, "like": "C", "rise": 0.4, "stems": st("none", "none", "none", "full")},
        {"from": {"bar": 12, "beat": 1}, "to": {"bar": 20, "beat": 1}, "name": "drop", "nth": 2, "like": "B", "rise": 0.0, "stems": st("full", "full", "none", "full")},
        {"from": {"bar": 20, "beat": 1}, "to": {"bar": 24, "beat": 1}, "name": "verse", "nth": 1, "like": "D", "rise": 0.0, "stems": st("none", "some", "full", "none")},
        {"from": {"bar": 24, "beat": 1}, "to": {"bar": 28, "beat": 1}, "name": "outro", "nth": 1, "like": "A", "rise": -0.5, "stems": st("none", "some", "none", "some")},
    ]
    E = [0.1] * 4 + [0.9, 0.9, 0.2, 0.9] + [0.1, 0.12, 0.15, 0.2] + [0.9] * 8 + [0.2] * 4 + [0.1, 0.08, 0.04, 0.01]
    d["energy"] = {"per": "bar", "from_bar": 0, "values": E}
    d["pace"] = [0.0] * 8 + [0.5] * 4 + [1.5] * 8 + [0.0] * 8
    d["width"] = [0.5] * 28
    d["pump"] = [0.4] * 28
    d["brightness"] = [1.0] * 8 + [0.2, 0.4, 0.8, 1.0] + [1.0] * 16
    d["curves"] = {k: {"per": "bar", "from_bar": 0} for k in ("pace", "width", "pump", "brightness")}
    d["stems"] = {"from_bar": 0, "lanes": {"drums": [0] * 4 + [1, 1, 0.3, 1] + [0] * 4 + [1] * 8 + [0] * 8,
                                            "bass": [0] * 4 + [1] * 4 + [0] * 4 + [1] * 8 + [0.4] * 4 + [0.6] * 4,
                                            "vocals": [0] * 20 + [1.0, 0.6, 0.3, 0.1] + [0] * 4,
                                            "other": [0.7] * 28}}
    d["harmony"] = {"from_bar": 0, "chords": ["C#m", "A"] * 14}
    d["phrases"] = [{"from_bar": 8, "to_bar": 11, "in": "breakdown", "in_nth": 1, "doing": "intensifying", "also": [], "says": "", "energy": 0.1, "rise": 0.4, "playing": [], "has_break": False}]
    d["moments"] = [{"at": {"bar": 20, "beat": 1}, "is": "pause", "what": "everything but bass", "sure": 0.8, "weight": 0.6, "for_beats": 4}]
    return d


FPS = 40


def render_demo(seed=1):
    sc = Score(demo_score())
    cues = arrange.plan(sc, seed=seed)
    from score_show import render
    return sc, cues, render(sc, cues, fps=FPS)


def par_level(frame, addr):
    return int(max(frame[addr: addr + 3]))


# ------------------------------------------------------------------ the library itself
def test_every_effect_is_tagged_and_documented():
    assert len(LIBRARY) >= 25
    for e in LIBRARY.values():
        assert e.layer in effects.LAYERS
        assert e.suits and all(r in ROLES and 0 < w <= 1 for r, w in e.suits.items()), e.name
        assert e.doc, f"{e.name} has no doc"
    assert set(EVENT_ORDER) == {e.name for e in effects.by_layer("event")}
    for role in ROLES:
        assert any(e.suits.get(role) for e in effects.by_layer("par")), f"no PAR look suits {role}"
        assert any(e.suits.get(role) for e in effects.by_layer("head")), f"no head look suits {role}"


def test_every_look_renders_in_range_for_every_role():
    sc = Score(demo_score())
    cues = arrange.build_cues(sc)
    for c in cues:
        c.params = {"palette": "chord"}
        for e in LIBRARY.values():
            for k in range(6):
                t = c.from_s + (c.to_s - c.from_s) * (k + 0.37) / 6
                look = Look()
                e.render(c, sc, t, look, c.params)
                for a, (col, lvl, strobe) in look.par.items():
                    assert 0.0 <= lvl <= 1.0 and 0 <= strobe <= 255 and all(0.0 <= x <= 1.0001 for x in col), (e.name, c.role, lvl, col)
                assert 0.0 <= look.head["dim"] <= 1.0 and 0 <= look.head["pan"] <= 255 and 0 <= look.head["tilt"] <= 255, (e.name, look.head)


def test_comet_levels_hand_off_continuously():
    lv_end = effects.comet_levels(0.999, effects.PINGPONG, 0.5)
    lv_next = effects.comet_levels(1.0, effects.PINGPONG, 0.5)
    assert lv_end[0] == pytest.approx(lv_next[0], abs=0.01)          # lamp 0 does not jump at the hand-off
    assert lv_next[1] == pytest.approx(1.0) and lv_next[0] == pytest.approx(0.5)
    assert lv_end[3] < 0.1                                           # the far lamp only carries a faint residual from the previous cycle


def test_chord_colours_follow_the_harmony_lane():
    sc = Score(demo_score())
    cues = arrange.build_cues(sc)
    drop = [c for c in cues if c.role == "drop"][0]
    P = {"palette": "chord"}
    assert effects.colour_name(drop, sc, drop.from_s + 0.1, P) == "blue"           # C#m
    assert effects.colour_name(drop, sc, drop.from_s + sc.bar_s + 0.1, P) == "pink"  # A
    assert effects.colour_name(drop, sc, drop.from_s + 0.1, {"palette": "gold"}) == "yellow"


# ------------------------------------------------------------------ arranging
def test_cues_roles_escalation_breaks_and_moments():
    sc = Score(demo_score())
    cues = arrange.build_cues(sc)
    roles = [c.role_key for c in cues]
    assert roles == ["intro", "drop", "build", "final_drop", "verse", "outro"]     # the rising breakdown became a build
    d1, d2 = [c for c in cues if c.role == "drop"]
    assert d1.drop_no == 1 and d2.drop_no == 2 and d2.final and not d1.final
    assert d1.intensity < d2.intensity == pytest.approx(1.0)
    assert len(d1.breaks) == 1 and d1.breaks[0][0] == pytest.approx(sc.t(6)) and d1.breaks[0][2] is True
    assert d2.breaks == []
    assert cues[0].from_s == 0.0 and cues[-1].to_s == pytest.approx(sc.duration)
    assert cues[2].next_role == "final_drop" and cues[3].prev_role == "build"
    verse = cues[4]
    assert [m.is_ for m in verse.moments] == ["pause"] and verse.stems["vocals"] == "full"
    assert cues[2].brightness_min == pytest.approx(0.2)


def test_long_rising_section_only_gives_up_its_last_eight_bars():
    d = demo_score()
    d["sections"][2]["to"] = {"bar": 20, "beat": 1}          # breakdown 8-20 (12 bars)
    d["sections"][3]["from"] = {"bar": 20, "beat": 1}; d["sections"][3]["to"] = {"bar": 24, "beat": 1}
    d["sections"][4]["from"] = {"bar": 24, "beat": 1}; d["sections"][4]["to"] = {"bar": 26, "beat": 1}
    d["sections"][5]["from"] = {"bar": 26, "beat": 1}
    cues = arrange.build_cues(Score(d))
    kinds = [(c.role, c.from_bar, c.to_bar) for c in cues]
    assert ("breakdown", 8, 12) in kinds and ("build", 12, 20) in kinds


def test_plan_is_deterministic_per_seed_and_varies_across_seeds():
    sc = Score(demo_score())
    a = [(c.par, c.head) for c in arrange.plan(sc, seed=3)]
    b = [(c.par, c.head) for c in arrange.plan(sc, seed=3)]
    assert a == b
    seen = {tuple((c.par, c.head) for c in arrange.plan(sc, seed=s)) for s in range(12)}
    assert len(seen) >= 3


def test_plan_only_picks_effects_that_fit_and_reuses_looks_for_the_same_material():
    sc = Score(demo_score())
    for seed in range(8):
        cues = arrange.plan(sc, seed=seed)
        for c in cues:
            assert LIBRARY[c.par].layer == "par" and LIBRARY[c.par].fits(c), (seed, c.role_key, c.par)
            assert LIBRARY[c.head].layer == "head" and LIBRARY[c.head].fits(c), (seed, c.role_key, c.head)
            assert all(LIBRARY[e].fits(c) for e in c.events)
        d1 = [c for c in cues if c.role_key == "drop"][0]
        assert "drop_hit" in d1.events and "strobe_pops" in d1.events and "break_blackout" in d1.events
        assert "pre_drop_blackout" in cues[0].events and "pre_drop_blackout" in cues[2].events
        assert "white_finale" in cues[3].events and "pause_hold" in cues[4].events
        assert "strobe_accelerate" in cues[2].events
    # same material (role_key + like) -> same looks
    d = demo_score()
    d["sections"][3]["nth"] = 2
    d["sections"].insert(4, {"from": {"bar": 20, "beat": 1}, "to": {"bar": 22, "beat": 1}, "name": "drop", "nth": 3, "like": "B", "rise": 0.0,
                             "stems": d["sections"][3]["stems"]})
    d["sections"][5]["from"] = {"bar": 22, "beat": 1}
    cues = arrange.plan(Score(d), seed=2)
    drops = [c for c in cues if c.role == "drop"]
    assert (drops[0].par, drops[0].head) == (drops[1].par, drops[1].head)      # drop#1 and drop#2 share 'B' and are not final


def test_overrides_and_saved_plan_round_trip():
    sc = Score(demo_score())
    cues = arrange.plan(sc, seed=1, overrides={"drop#1": {"par": "pair_alternate", "head": "figure8", "params": {"palette": "ice"}, "intensity": 0.8}})
    d1 = [c for c in cues if c.role == "drop"][0]
    assert d1.par == "pair_alternate" and d1.head == "figure8" and d1.params["palette"] == "ice" and d1.intensity == 0.8
    doc = arrange.plan_doc(sc, cues, seed=1)
    fresh = arrange.choose(arrange.build_cues(sc), seed=99)
    arrange.apply_plan(fresh, doc)
    assert [(c.par, c.head, c.params) for c in fresh] == [(c.par, c.head, c.params) for c in cues]


# ------------------------------------------------------------------ rendering
def test_render_shape_locked_channels_and_no_head_jumps():
    sc, cues, frames = render_demo()
    assert frames.shape == (int(np.ceil(sc.duration * FPS)), 41) and frames.dtype == np.uint8
    for ch in rig.HEAD_KEEP_ZERO:
        assert not frames[:, ch - 1].any()
    for a in rig.PAR_ADDRS:
        assert not frames[:, a - 1 + rig.PAR_PROG].any() and not frames[:, a - 1 + rig.PAR_SPEED].any()
        assert (frames[:, a - 1 + rig.PAR_DIM] == 255).all()
    pan, tilt = frames[:, rig.H_PAN - 1].astype(int), frames[:, rig.H_TILT - 1].astype(int)
    assert np.abs(np.diff(pan)).max() <= concert.PAN_MAX_STEP + 1 and np.abs(np.diff(tilt)).max() <= concert.TILT_MAX_STEP + 1


import concert  # noqa: E402  (used above)


def test_drop_hit_lands_on_the_beat_after_a_blackout():
    sc, cues, frames = render_demo()
    d1 = [c for c in cues if c.role == "drop"][0]
    dark = frames[int((d1.from_s - 0.5 * sc.beat_s) * FPS)]
    assert all(par_level(dark, a) == 0 for a in rig.PAR_ADDRS) and dark[rig.H_DIM - 1] == 0
    assert dark[rig.H_COLOUR - 1] == rig.COLOUR_BY_NAME["white"][0]
    hit = frames[int(d1.from_s * FPS) + 1]
    assert all(list(hit[a: a + 3]) == [255, 255, 255] for a in rig.PAR_ADDRS) and hit[rig.H_DIM - 1] == 255


def test_break_bar_goes_dark_then_bursts_back():
    sc, cues, frames = render_demo()
    d1 = [c for c in cues if c.role == "drop"][0]
    b0, b1, _ = d1.breaks[0]
    early = frames[int((b0 + 0.3 * sc.bar_s) * FPS)]
    assert all(par_level(early, a) == 0 for a in rig.PAR_ADDRS) and early[rig.H_DIM - 1] == 0
    late = frames[int((b0 + 0.95 * sc.bar_s) * FPS)]
    assert sum(par_level(late, a) > 0 for a in rig.PAR_ADDRS) >= 3          # creeping back in
    back = frames[int(b1 * FPS) + 1]
    assert all(list(back[a: a + 3]) == [255, 255, 255] for a in rig.PAR_ADDRS)
    # the head kept its pose through the dark bar instead of re-aiming
    before, during = frames[int(b0 * FPS) - 1], frames[int((b0 + 0.4 * sc.bar_s) * FPS)]
    assert abs(int(before[rig.H_PAN - 1]) - int(during[rig.H_PAN - 1])) <= 2


def test_pause_moment_is_dark_but_for_one_lamp():
    sc, cues, frames = render_demo()
    verse = [c for c in cues if c.role == "verse"][0]
    m = verse.moments[0]
    f = frames[int((m.t_s + 0.5) * FPS)]
    lit = [a for a in rig.PAR_ADDRS if par_level(f, a) > 0]
    assert len(lit) == 1 and lit[0] in concert.INNER and f[rig.H_DIM - 1] == 0
    after = frames[int((m.to_s + 1.0) * FPS)]
    assert sum(par_level(after, a) > 0 for a in rig.PAR_ADDRS) >= 2


def test_final_drop_is_bigger_than_the_first_and_ends_in_a_white_strobe():
    sc, cues, frames = render_demo()
    d1, d2 = [c for c in cues if c.role == "drop"]
    seg = lambda c: frames[int((c.from_s + sc.bar_s) * FPS): int((c.to_s - sc.bar_s) * FPS)]
    s1, s2 = seg(d1), seg(d2)
    def par_mean(fr): return np.mean([fr[:, a: a + 3].astype(float).max(axis=1) for a in rig.PAR_ADDRS])
    assert par_mean(s2) > par_mean(s1)
    assert np.mean(s2[:, rig.PAR_ADDRS[0] - 1 + rig.PAR_STROBE] > 0) >= np.mean(s1[:, rig.PAR_ADDRS[0] - 1 + rig.PAR_STROBE] > 0)
    finale = frames[int((d2.to_s - 0.8 * sc.bar_s) * FPS): int((d2.to_s - 0.1 * sc.bar_s) * FPS)]
    assert np.mean(finale[:, rig.PAR_ADDRS[0] - 1 + rig.PAR_STROBE] > 150) > 0.9
    assert (finale[:, rig.H_COLOUR - 1] >= rig.COLOUR_SPIN_MIN).all()


def test_build_gets_busier_not_brighter_and_strobes_at_the_end():
    sc, cues, frames = render_demo()
    b = [c for c in cues if c.role == "build"][0]
    def activity(t0, t1):
        seg = frames[int(t0 * FPS): int(t1 * FPS)]
        lv = np.stack([seg[:, a: a + 3].astype(int).max(axis=1) for a in rig.PAR_ADDRS], axis=1)
        return np.abs(np.diff(lv, axis=0)).sum(), lv.mean()
    act_early, mean_early = activity(b.from_s, b.from_s + sc.bar_s)
    act_late, mean_late = activity(b.to_s - 2 * sc.bar_s, b.to_s - 1.2 * sc.bar_s)
    assert act_late > act_early * 1.5
    assert mean_late < mean_early * 1.3                     # busier, not brighter
    strobe = frames[int((b.to_s - 0.6 * sc.bar_s) * FPS), rig.PAR_ADDRS[0] - 1 + rig.PAR_STROBE]
    assert strobe > 100


def test_verse_inner_pair_follows_the_vocal_lane():
    d = demo_score()
    d["moments"] = []
    sc = Score(d)
    cues = arrange.plan(sc, seed=1, overrides={"verse#1": {"par": "vocal_swell", "head": "spotlight"}})
    from score_show import render
    frames = render(sc, cues, fps=FPS)
    v = [c for c in cues if c.role == "verse"][0]
    loud = frames[int((v.from_s + 0.6 * sc.bar_s) * FPS)]           # vocals lane ~0.8, head has arrived on the wall
    quiet = frames[int((v.from_s + 3.1 * sc.bar_s) * FPS)]          # vocals lane 0.1
    assert par_level(loud, 8) > par_level(quiet, 8) + 80
    assert loud[rig.H_TILT - 1] in range(30, 50) and loud[rig.H_GOBO - 1] == rig.GOBO_OPEN


def test_lights_doc_has_what_the_panel_needs():
    from score_show import lights_doc
    sc, cues, frames = render_demo()
    doc = lights_doc(sc, cues, frames, FPS, "demo.cache.wav", "demo", arrange.plan_doc(sc, cues, 1))
    assert doc["rig"] and doc["fps"] == FPS and len(doc["frames"]) == len(frames) and len(doc["frames"][0]) == 41
    assert doc["phases"][0]["phase"] == "intro" and doc["phases"][3]["phase"] == "final_drop"
    assert doc["downbeats"][0] == 0.0 and doc["tempo"] == pytest.approx(120.0) and doc["plan"]["cues"][1]["par"]


def test_render_records_when_each_event_actually_fires():
    from score_show import render
    sc = Score(demo_score())
    cues = arrange.plan(sc, seed=1)
    activity = {}
    render(sc, cues, fps=FPS, activity=activity)
    d1, d2 = [c for c in cues if c.role == "drop"]
    hits = activity["drop_hit"]
    assert len(hits) == 2
    assert hits[0][0] == pytest.approx(d1.from_s, abs=1 / FPS) and hits[0][1] == pytest.approx(d1.from_s + sc.beat_s, abs=2 / FPS)
    assert hits[1][0] == pytest.approx(d2.from_s, abs=1 / FPS)
    dark = activity["pre_drop_blackout"]
    assert len(dark) == 2 and dark[0][1] == pytest.approx(d1.from_s, abs=1 / FPS) and dark[0][1] - dark[0][0] == pytest.approx(sc.beat_s, abs=2 / FPS)
    pops = activity["strobe_pops"]
    assert len(pops) >= 8 and all(b - a < 0.3 for a, b in pops)                 # short pops, many of them
    assert all(d1.from_s <= a < d1.to_s or d2.from_s <= a < d2.to_s for a, _ in pops)
    fin = activity["white_finale"]
    assert len(fin) == 1 and fin[0][1] == pytest.approx(d2.to_s, abs=1 / FPS) and fin[0][1] - fin[0][0] == pytest.approx(sc.bar_s, abs=2 / FPS)
    pause = activity["pause_hold"]
    verse = [c for c in cues if c.role == "verse"][0]
    assert len(pause) == 1 and pause[0][0] == pytest.approx(verse.moments[0].t_s, abs=1 / FPS)
    assert "break_blackout" in activity and activity["break_blackout"][0][0] == pytest.approx(d1.breaks[0][0], abs=1 / FPS)
    # a plan doc carries it for the panel
    doc = arrange.plan_doc(sc, cues, 1); doc["activity"] = activity
    assert doc["cues"][3]["role_key"] == "final_drop" and json.dumps(doc)


import json  # noqa: E402


# --- the dont-look-down brief: pace/tension build, voice hole, matched drops -----------
def brief_score():
    """A verse whose energy is FLAT but whose pace climbs into a final drop, with a
    'rise' signal, a 4-beat 'everything but voice' hole, a release, and two drops that
    share material C -- the shape the dont-look-down brief describes."""
    d = mini()
    d["song"]["length_s"] = 2.0 + 24 * 2.0
    d["grid"]["bars"] = 24
    st = lambda dr, ba, vo, ot: {"drums": {"is": dr}, "bass": {"is": ba}, "vocals": {"is": vo}, "other": {"is": ot}}
    d["sections"] = [
        {"from": {"bar": 0, "beat": 1}, "to": {"bar": 4, "beat": 1}, "name": "intro", "nth": 1, "like": "A", "rise": 0.0, "stems": st("none", "none", "none", "full")},
        {"from": {"bar": 4, "beat": 1}, "to": {"bar": 8, "beat": 1}, "name": "drop", "nth": 1, "like": "C", "rise": 0.0, "stems": st("full", "full", "vocals", "full")},
        {"from": {"bar": 8, "beat": 1}, "to": {"bar": 16, "beat": 1}, "name": "verse", "nth": 1, "like": "B", "rise": -0.14, "stems": st("some", "full", "full", "some")},
        {"from": {"bar": 16, "beat": 1}, "to": {"bar": 20, "beat": 1}, "name": "drop", "nth": 2, "like": "C", "rise": 0.14, "stems": st("full", "full", "full", "full")},
        {"from": {"bar": 20, "beat": 1}, "to": {"bar": 24, "beat": 1}, "name": "post-chorus", "nth": 1, "like": "B", "rise": -0.3, "stems": st("full", "full", "full", "full")},
    ]
    # energy nearly flat across the verse+run; pace does the work (halves, then climbs into 16)
    d["energy"] = {"per": "bar", "from_bar": 0, "values": [0.1, 0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 0.9,
                                                            0.22, 0.20, 0.21, 0.18, 0.12, 0.28, 0.30, 0.34,
                                                            0.9, 0.9, 0.9, 0.9, 0.8, 0.8, 0.2, 0.9]}
    d["pace"] = [0]*8 + [0.75, 0.5, 0.5, 0.5, 1.0, 1.25, 1.5, 1.75] + [1.0]*8
    d["brightness"] = [1.0]*24
    d["curves"] = {k: {"per": "bar", "from_bar": 0} for k in ("pace", "brightness")}
    d["tension"] = {"per": "beat", "from_bar": 0, "from_beat": 1,
                    "values": [0.3]*48 + [0.2, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9,  0.9, 0.9, 0.9, 0.5]  # bars 12-15 climb
                              + [0.4]*(24*4 - 60)}
    d["stems"] = {"from_bar": 0, "lanes": {"drums": [0]*8 + [0.3]*8 + [1]*8,
                                            "bass": [0]*8 + [1]*16, "vocals": [0]*8 + [0.8]*16, "other": [0.7]*24}}
    d["harmony"] = {"from_bar": 0, "chords": ["C#m", "A"] * 12}
    d["phrases"] = []
    d["signals"] = [{"bar": 13, "beat": 1, "is": "rise", "what": "everything", "for_beats": 16, "sure": 0.86, "weight": 0.26}]
    d["moments"] = [
        {"at": {"bar": 14, "beat": 1}, "is": "pause", "what": "everything but voice", "for_beats": 4,
         "back_at": 15, "still": ["voice"], "sure": 0.86, "weight": 0.89},
        {"at": {"bar": 15, "beat": 3}, "is": "release", "what": "tension", "after_beats": 5, "sure": 0.5, "weight": 0.8},
        {"at": {"bar": 19, "beat": 4}, "is": "highlight", "what": "voice at full reach", "for_beats": 1.6, "sure": 1.0, "weight": 0.72},
    ]
    return d


def test_build_is_detected_from_pace_when_energy_and_rise_are_flat():
    sc = Score(brief_score())
    cues = arrange.build_cues(sc)
    roles = [(c.role_key, c.from_bar, c.to_bar) for c in cues]
    # the verse (8-16, negative rise, flat energy) gives up its tail to a build ending at the drop
    assert any(r == "build" for r, a, b in roles), roles
    build = [c for c in cues if c.role_key == "build"][0]
    assert build.to_bar == 16 and build.from_bar >= 8         # the run into the second drop
    assert build.from_bar <= 13                               # starts at/around the declared rise (bar 13)


def test_both_drops_share_the_look_across_drop_and_final_drop():
    sc = Score(brief_score())
    for seed in range(10):
        cues = arrange.plan(sc, seed=seed)
        drops = [c for c in cues if c.role in ("drop", "chorus")]
        assert len(drops) == 2 and drops[1].final and not drops[0].final
        assert (drops[0].par, drops[0].head) == (drops[1].par, drops[1].head), (seed, drops[0].par, drops[1].par)
        assert drops[1].intensity > drops[0].intensity        # same look, bigger
        # and the shared look renders for BOTH roles
        assert LIBRARY[drops[0].par].fits(drops[0]) and LIBRARY[drops[0].par].fits(drops[1])


def test_pace_build_rate_follows_the_pace_lane():
    sc = Score(brief_score())
    cues = arrange.plan(sc, seed=1, overrides={"build#1": {"par": "pace_build", "head": "spiral_rise"},
                                               "verse#1": {"par": "pace_build"}})
    build = [c for c in cues if c.role_key == "build"][0]
    # steps advanced across a low-pace bar (0.5) vs a high-pace bar (1.5) -- the chase moves faster
    lo0 = effects.pace_steps(sc, build, sc.t(10, 1)); lo1 = effects.pace_steps(sc, build, sc.t(11, 1))
    hi0 = effects.pace_steps(sc, build, sc.t(15, 1)); hi1 = effects.pace_steps(sc, build, sc.t(16, 1) - 1e-3)
    assert (hi1 - hi0) > (lo1 - lo0) * 2.5                    # bar 15 (pace 1.75) advances far more than bar 10 (pace 0.5)


def test_build_gets_busier_into_the_drop_though_energy_is_flat():
    sc = Score(brief_score())
    cues = arrange.plan(sc, seed=1, overrides={"build#1": {"par": "pace_build", "head": "spiral_rise"}})
    from score_show import render
    frames = render(sc, cues, fps=FPS)
    build = [c for c in cues if c.role_key == "build"][0]
    def activity(bar):
        s, e = int(sc.t(bar) * FPS), int(sc.t(bar + 1) * FPS)
        lv = np.stack([frames[s:e, a: a + 3].astype(int).max(axis=1) for a in rig.PAR_ADDRS], axis=1)
        return np.abs(np.diff(lv, axis=0)).sum()
    # bar 15 (pace 1.75) is busier than bar 10 (pace 0.5), while the energy lane barely moves
    assert activity(15) > activity(10)
    assert abs(sc.lane_bar("energy", 15) - sc.lane_bar("energy", 10)) < 0.2


def test_voice_pause_holds_the_voice_colour_not_deep_blue():
    sc = Score(brief_score())
    cues = arrange.plan(sc, seed=1, overrides={"build#1": {"par": "pace_build", "head": "spiral_rise", "params": {"palette": "cool", "still_palette": "warm"}}})
    from score_show import render
    frames = render(sc, cues, fps=FPS)
    # bar 14 beats 2-4 are the hole: the inner pair carries a warm (voice) colour, outer dark
    f = frames[int(sc.t(14, 3) * FPS)]
    inner = [rig.PAR_ADDRS[1], rig.PAR_ADDRS[2]]
    outer = [rig.PAR_ADDRS[0], rig.PAR_ADDRS[3]]
    assert all(int(f[a: a + 3].max()) > 0 for a in inner) and all(int(f[a: a + 3].max()) == 0 for a in outer)
    assert int(f[inner[0]]) >= int(f[inner[0] + 2])          # warm: red >= blue
    assert f[rig.H_DIM - 1] == 0                             # head dark through the hole


def test_release_accent_lands_on_the_release_beat():
    sc = Score(brief_score())
    cues = arrange.plan(sc, seed=1, overrides={"build#1": {"par": "pace_build", "head": "spiral_rise"}})
    from score_show import render
    activity = {}
    frames = render(sc, cues, fps=FPS, activity=activity)
    assert "release_accent" in activity
    on = frames[int(sc.t(15, 3) * FPS) + 1]
    off = frames[int(sc.t(15, 2) * FPS) + 1]
    assert np.mean([on[a: a + 3].max() for a in rig.PAR_ADDRS]) > np.mean([off[a: a + 3].max() for a in rig.PAR_ADDRS])


def test_highlight_flare_blooms_on_a_highlight_moment():
    sc = Score(brief_score())
    cues = arrange.plan(sc, seed=1)
    from score_show import render
    activity = {}
    render(sc, cues, fps=FPS, activity=activity)
    assert "highlight_flare" in activity and activity["highlight_flare"]


def test_post_chorus_role_is_aliased_to_a_lit_role():
    sc = Score(brief_score())
    cues = arrange.plan(sc, seed=1)
    pc = [c for c in cues if c.role == "post-chorus"][0]
    assert pc.role_key == "bridge"                            # aliased so effects suit it
    assert LIBRARY[pc.par].fits(pc) and LIBRARY[pc.head].fits(pc)
