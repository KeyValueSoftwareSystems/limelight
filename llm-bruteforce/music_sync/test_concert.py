import numpy as np
import pytest

import rig
from concert import Timeline, render, beat_grid, HeadState

FPS = 40
BPM = 90.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT


def tl(*phases):
    """phases: (start_s, end_s, name)"""
    return Timeline(bpm=BPM, phases=[{"start": a, "end": b, "phase": n} for a, b, n in phases])


def test_beat_grid_math():
    g = beat_grid(BPM)
    assert g.beat == pytest.approx(BEAT) and g.bar == pytest.approx(BAR)
    assert g.beat_index(BEAT * 5.5) == 5 and g.beat_phase(BEAT * 5.5) == pytest.approx(0.5)
    assert g.bar_index(BAR * 3 + 0.1) == 3 and g.bar_phase(BAR * 3 + BAR / 4) == pytest.approx(0.25)


def test_timeline_lookup_and_progress():
    t = tl((0, 10, "intro"), (10, 20, "build"), (20, 30, "drop"))
    assert t.phase_at(5.0).name == "intro"
    ph = t.phase_at(15.0)
    assert ph.name == "build" and ph.progress(15.0) == pytest.approx(0.5)
    assert t.phase_at(29.9).name == "drop" and t.phase_at(99.0) is None
    assert t.duration == 30


def test_render_shape_dtype_and_locked_channels():
    frames, meta = render(tl((0, 4, "intro"), (4, 8, "build"), (8, 12, "drop"), (12, 14, "gap")), fps=FPS)
    assert frames.shape == (14 * FPS, 41) and frames.dtype == np.uint8
    for ch in rig.HEAD_KEEP_ZERO:
        assert not frames[:, ch - 1].any(), f"head ch{ch} must stay 0"
    for a in rig.PAR_ADDRS:
        assert not frames[:, a - 1 + rig.PAR_PROG].any() and not frames[:, a - 1 + rig.PAR_SPEED].any()
    assert meta["phases"][0]["phase"] == "intro" and meta["bpm"] == BPM


def test_head_uses_the_whole_room_and_never_jumps():
    frames, _ = render(tl((0, 6, "intro"), (6, 12, "build"), (12, 20, "drop"), (20, 24, "anthem"), (24, 30, "verse")), fps=FPS)
    pan, tilt = frames[:, rig.H_PAN - 1].astype(int), frames[:, rig.H_TILT - 1].astype(int)
    assert pan.min() >= 0 and pan.max() <= 255 and tilt.min() >= 0 and tilt.max() <= 255
    assert pan.max() - pan.min() >= 200 and tilt.max() - tilt.min() >= 150      # full room, not the front wall
    from concert import PAN_MAX_STEP, TILT_MAX_STEP
    assert np.abs(np.diff(pan)).max() <= PAN_MAX_STEP + 1 and np.abs(np.diff(tilt)).max() <= TILT_MAX_STEP + 1


def test_drop_head_is_in_fast_motion_right_after_the_hit():
    frames, _ = render(tl((0, 4 * BAR, "build"), (4 * BAR, 12 * BAR, "drop")), fps=FPS)
    seg = frames[int(4 * BAR * FPS): int(6 * BAR * FPS)]                        # first two bars of the drop
    pan, tilt = seg[:, rig.H_PAN - 1].astype(int), seg[:, rig.H_TILT - 1].astype(int)
    speed = np.abs(np.diff(pan)) + np.abs(np.diff(tilt))                        # DMX per frame
    assert speed.mean() >= 4.0, f"head too slow after the hit: {speed.mean():.1f} DMX/frame"
    assert pan.max() - pan.min() >= 150 and tilt.max() - tilt.min() >= 100
    quiet = np.mean(speed < 1.0)
    assert quiet < 0.15                                                          # almost never standing still


def test_verse_head_roams_widely():
    frames, _ = render(tl((0, 8 * BAR, "verse")), fps=FPS)
    pan, tilt = frames[:, rig.H_PAN - 1].astype(int), frames[:, rig.H_TILT - 1].astype(int)
    assert pan.max() - pan.min() >= 150 and tilt.max() - tilt.min() >= 100


def test_gap_is_dark_and_drop_start_is_a_full_white_hit():
    frames, _ = render(tl((0, 4, "build"), (4, 12, "drop"), (12, 14, "gap")), fps=FPS)
    hit = frames[4 * FPS + 2]
    for a in rig.PAR_ADDRS:
        assert list(hit[a: a + 3]) == [255, 255, 255], "every PAR white at the drop"
    assert hit[rig.H_DIM - 1] == 255 and hit[rig.H_PRISM - 1] == rig.PRISM_6
    gap = frames[13 * FPS]
    assert gap[rig.H_DIM - 1] == 0
    assert max(int(gap[a + k]) for a in rig.PAR_ADDRS for k in range(3)) <= 12


def test_build_ramps_par_strobe_and_head_tilt_upward():
    frames, _ = render(tl((0, 16, "build"), (16, 20, "drop")), fps=FPS)
    strobe = frames[:16 * FPS, rig.PAR_ADDRS[0] - 1 + rig.PAR_STROBE].astype(int)
    assert strobe[: 8 * FPS].max() == 0                          # no strobe in the first half
    late = strobe[int(12.5 * FPS): int(15.2 * FPS)]        # before the pre-drop blackout
    assert late[-1] > late[0] > 0                                 # accelerating at the end
    tilt = frames[:16 * FPS, rig.H_TILT - 1].astype(int)
    assert tilt[FPS] < tilt[8 * FPS] < tilt[15 * FPS]             # rising toward the ceiling
    assert tilt[int((16 - 1.2 * BEAT) * FPS)] >= rig.TILT_UP - 8   # at the ceiling before the blackout re-aims it


def test_verse_pulse_travels_across_the_arc():
    frames, _ = render(tl((0, 8 * BAR, "verse")), fps=FPS)
    b0 = int(BAR * 2 / (1 / FPS))                                 # start of bar 2 (even bar: left -> right)
    win = frames[b0: b0 + int(BEAT * FPS)]
    def peak_time(addr):
        lvl = win[:, addr: addr + 3].astype(int).max(axis=1)
        return int(np.argmax(lvl))
    assert peak_time(1) < peak_time(8) < peak_time(15) < peak_time(22)


def test_head_colour_change_no_longer_blanks_the_dimmer():
    hs = HeadState(fps=FPS)
    f1 = hs.step(pan=169, tilt=60, dim=1.0, colour="blue", gobo=0, prism=0, strobe=0)
    f2 = hs.step(pan=169, tilt=60, dim=1.0, colour="light blue", gobo=0, prism=0, strobe=0)
    assert f1["dim"] == 1.0 and f2["dim"] == 1.0
    assert f2["colour_val"] == rig.COLOUR_BY_NAME["light blue"][0]


def test_second_drop_is_bigger_than_the_first():
    tlm = tl((0, 8 * BAR, "drop"), (8 * BAR, 16 * BAR, "verse"), (16 * BAR, 24 * BAR, "drop"))
    frames, meta = render(tlm, fps=FPS)
    d1 = frames[int(BAR * FPS): int(7 * BAR * FPS)]
    d2 = frames[int(17 * BAR * FPS): int(23 * BAR * FPS)]
    def par_mean(fr): return np.mean([fr[:, a: a + 3].astype(float).max(axis=1) for a in rig.PAR_ADDRS])
    def pan_travel(fr): return np.abs(np.diff(fr[:, rig.H_PAN - 1].astype(int))).sum()
    assert par_mean(d2) > par_mean(d1) * 1.15
    assert pan_travel(d2) >= pan_travel(d1) * 0.95                 # both at the slew cap: no less motion
    assert np.mean(d2[:, rig.PAR_ADDRS[0] - 1 + rig.PAR_STROBE] > 0) > np.mean(d1[:, rig.PAR_ADDRS[0] - 1 + rig.PAR_STROBE] > 0)
    finale = frames[int(23.2 * BAR * FPS): int(23.9 * BAR * FPS)]
    assert np.mean(finale[:, rig.PAR_ADDRS[0] - 1 + rig.PAR_STROBE] > 150) > 0.9   # last bar: strobe finale


def test_breakdown_and_build_hit_hard_on_every_beat():
    for name in ("breakdown", "build"):
        frames, _ = render(tl((0, 8 * BAR, name), (8 * BAR, 9 * BAR, "drop")), fps=FPS)
        lvl = frames[:, rig.PAR_ADDRS[1]: rig.PAR_ADDRS[1] + 3].astype(int).max(axis=1)
        for k in range(8, 24):                                     # beats 8..23 (bars 2-5)
            on = lvl[int(k * BEAT * FPS) + 1]
            mid = lvl[int((k + 0.5) * BEAT * FPS)]
            assert on >= 200 and on - mid >= 80, f"{name} beat {k}: on {on} mid {mid}"


def test_head_uses_several_gobos_and_colours_across_the_show():
    frames, _ = render(tl((0, 4 * BAR, "verse"), (4 * BAR, 8 * BAR, "build"), (8 * BAR, 16 * BAR, "drop"),
                          (16 * BAR, 20 * BAR, "anthem")), fps=FPS)
    assert len(set(frames[:, rig.H_GOBO - 1].tolist())) >= 3
    assert len(set(frames[:, rig.H_COLOUR - 1].tolist())) >= 5
    tilt = frames[int(8 * BAR * FPS):, rig.H_TILT - 1].astype(int)
    assert tilt.max() - tilt.min() >= 40                           # not just arcs on the wall


def test_last_beat_before_a_drop_is_a_full_blackout_with_head_pre_aimed():
    frames, _ = render(tl((0, 8, "build"), (8, 16, "drop")), fps=FPS)
    dark = frames[int((8 - 0.5 * BEAT) * FPS)]
    assert max(int(dark[a + k]) for a in rig.PAR_ADDRS for k in range(3)) == 0
    assert dark[rig.H_DIM - 1] == 0
    assert dark[rig.H_COLOUR - 1] == rig.COLOUR_BY_NAME["white"][0]       # wheel parked on white early
    lit = frames[int((8 - 2 * BEAT) * FPS) + 1]                                    # the beat before the blackout beat
    assert max(int(lit[a + k]) for a in rig.PAR_ADDRS for k in range(3)) > 200   # still hitting hard
    hit = frames[8 * FPS]
    assert all(list(hit[a: a + 3]) == [255, 255, 255] for a in rig.PAR_ADDRS) and hit[rig.H_DIM - 1] == 255


def test_anthem_is_more_energetic_than_verse_and_uses_the_prism():
    fv, _ = render(tl((0, 8 * BAR, "verse")), fps=FPS)
    fa, _ = render(tl((0, 8 * BAR, "anthem")), fps=FPS)
    def par_mean(fr): return np.mean([fr[:, a: a + 3].astype(float).max(axis=1) for a in rig.PAR_ADDRS])
    assert par_mean(fa) > par_mean(fv) * 1.4
    assert np.mean(fa[:, rig.H_PRISM - 1] > 0) > 0.9
    assert fa[:, rig.H_DIM - 1].astype(float).mean() > fv[:, rig.H_DIM - 1].astype(float).mean()


def test_drop_head_bounces_tilt_on_beats_and_sweeps_the_wall():
    frames, _ = render(tl((0, 8 * BAR, "drop")), fps=FPS)
    pan = frames[int(BAR * FPS):, rig.H_PAN - 1].astype(int)
    assert pan.max() - pan.min() >= 40                             # edge to edge
    tilt = frames[int(BAR * FPS): int(3 * BAR * FPS), rig.H_TILT - 1].astype(int)
    assert tilt.max() - tilt.min() >= 20                           # bouncing
    strobe = frames[:, rig.PAR_ADDRS[1] - 1 + rig.PAR_STROBE]
    assert strobe.max() > 150 and np.mean(strobe > 0) < 0.2        # short pops only


def test_beat_list_grid_follows_real_beats_and_downbeats():
    from concert import BeatList
    beats = [0.16 + 0.673 * i for i in range(16)]
    downbeats = beats[3::4]                                    # first downbeat at beat 3
    g = BeatList(beats, downbeats)
    assert g.beat == pytest.approx(0.673, abs=1e-3) and g.bar == pytest.approx(4 * 0.673, abs=1e-2)
    t = beats[5] + 0.25 * 0.673
    assert g.beat_index(t) == 5 and g.beat_phase(t) == pytest.approx(0.25, abs=1e-3)
    assert g.bar_index(downbeats[1] + 0.1) == 1 and g.bar_phase(downbeats[1] + 0.673) == pytest.approx(0.25, abs=0.01)
    assert g.beat_index(0.0) == -1 and 0 <= g.beat_phase(0.0) < 1     # before the first beat: extrapolated
    assert g.bar_index(0.5) == -1


def test_render_with_beat_list_grid_puts_the_drop_hit_on_the_real_downbeat():
    from concert import BeatList
    beats = [0.16 + 0.673 * i for i in range(48)]
    downbeats = beats[3::4]
    g = BeatList(beats, downbeats)
    drop_start = downbeats[4]
    tlm = Timeline(grid=g, phases=[{"start": 0, "end": drop_start, "phase": "build"},
                                   {"start": drop_start, "end": downbeats[8], "phase": "drop"}])
    frames, meta = render(tlm, fps=FPS)
    hit = frames[int(drop_start * FPS) + 1]
    assert all(list(hit[a: a + 3]) == [255, 255, 255] for a in rig.PAR_ADDRS)
    dark = frames[int((drop_start - 0.3) * FPS)]
    assert max(int(dark[a + k]) for a in rig.PAR_ADDRS for k in range(3)) == 0
    assert meta["bpm"] == pytest.approx(60 / 0.673, abs=0.5)


def test_park_frame_lives_in_rig_without_numpy_and_matches_concert():
    import subprocess, sys as _sys
    from concert import park_frame
    assert rig.park_frame() == park_frame()
    p = rig.park_frame()
    assert len(p) == 41 and p[rig.H_PAN - 1] == rig.PAN_WALL_CENTRE and p[rig.H_TILT - 1] == rig.TILT_UP
    assert p[rig.H_DIM - 1] == 0 and p[rig.H_SPEED - 1] == 200 and all(p[c - 1] == 0 for c in rig.HEAD_KEEP_ZERO)
    # importable by a plain interpreter with no third-party packages (a bridge in another venv)
    r = subprocess.run([_sys.executable, "-I", "-c", "import sys; sys.path.insert(0, '.'); import rig, artnet; print(len(rig.park_frame()))"],
                       capture_output=True, text=True, cwd=".")
    assert r.returncode == 0 and r.stdout.strip() == "41", r.stderr
