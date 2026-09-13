import numpy as np
import pytest

from mapping import (flash_envelope, gamma_encode, hsv_to_rgb, hue_track,
                     render_pulse, render_bands, PALETTES)


def test_gamma_encode_endpoints_and_midpoint():
    out = gamma_encode(np.array([0.0, 0.5, 1.0]))
    assert out.dtype == np.uint8
    assert list(out) == [0, 55, 255]           # 0.5 ** 2.2 * 255 = 55.5 -> 55


def test_flash_envelope_jumps_at_event_and_decays_to_5pct_after_decay_time():
    fps = 40
    env = flash_envelope(n_frames=120, fps=fps, event_times=[1.0], strengths=[1.0], decay_s=0.5)
    assert env.shape == (120,)
    assert env[39] == 0.0
    assert env[40] == pytest.approx(1.0)
    assert env[60] == pytest.approx(0.05, abs=0.01)   # 0.5 s later
    assert np.all(np.diff(env[40:]) <= 0)


def test_flash_envelope_weaker_event_never_lowers_a_louder_tail():
    single = flash_envelope(n_frames=80, fps=40, event_times=[1.0], strengths=[1.0], decay_s=0.5)
    env = flash_envelope(n_frames=80, fps=40, event_times=[1.0, 1.025],
                         strengths=[1.0, 0.3], decay_s=0.5)
    assert env[41] == pytest.approx(single[41])       # not clobbered by the 0.3 event
    assert env[41] > 0.8


def test_hue_track_steps_per_downbeat_and_switches_palette_per_section():
    fps = 10
    hues = hue_track(n_frames=40, fps=fps, downbeat_times=[0.0, 1.0, 2.0, 3.0],
                     section_times=[0.0, 2.0])
    p0, p1 = PALETTES[0], PALETTES[1]
    assert np.all(hues[0:10] == p0[0])
    assert np.all(hues[10:20] == p0[1])
    assert np.all(hues[20:30] == p1[0])
    assert np.all(hues[30:40] == p1[1])


def test_hsv_to_rgb_primary_hues():
    rgb = hsv_to_rgb(np.array([0.0, 1 / 3, 2 / 3]), np.ones(3), np.ones(3))
    assert np.allclose(rgb, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], atol=1e-6)


def _features(n, fps, beats=(), loud=0.0):
    return {
        "duration": n / fps,
        "beats": list(beats),
        "downbeats": list(beats)[::4],
        "onsets": [],
        "sections": [0.0],
        "loudness": np.full(n, loud),
        "bands": np.zeros((n, 3)),
        "tilt": np.zeros(n),
    }


def test_render_pulse_is_dark_in_silence_and_full_on_the_beat():
    fps = 40
    f = _features(80, fps, beats=[1.0], loud=0.0)
    frames = render_pulse(f, fps)
    assert frames.shape == (80, 3) and frames.dtype == np.uint8
    assert frames[10].max() == 0                       # silence, no beat yet -> dark
    assert frames[40].max() == 255                     # on the beat -> full
    assert frames[79].max() < frames[40].max()         # decayed by the end


def test_render_pulse_floor_follows_loudness():
    fps = 40
    dim = render_pulse(_features(40, fps, loud=0.2), fps)
    loud = render_pulse(_features(40, fps, loud=1.0), fps)
    assert 0 < dim[20].max() < loud[20].max() < 255


def test_render_bands_maps_low_mid_high_to_r_g_b():
    fps = 40
    f = _features(3, fps)
    f["bands"] = np.array([[1.0, 0, 0], [0, 1.0, 0], [0, 0, 1.0]])
    frames = render_bands(f, fps)
    assert np.argmax(frames[0]) == 0 and frames[0][0] == 255
    assert np.argmax(frames[1]) == 1
    assert np.argmax(frames[2]) == 2
