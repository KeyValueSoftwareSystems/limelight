import json

import numpy as np
import pytest

from analyze import extract_features, write_lights_json, choose_palettes

SR = 22050
FPS = 40


def clicks(bpm=120.0, seconds=8.0, accent_every=4, sr=SR):
    """Short 1 kHz bursts on every beat, the first of every `accent_every` louder."""
    y = np.zeros(int(seconds * sr))
    period = 60.0 / bpm
    times = np.arange(0.25, seconds - 0.05, period)
    burst_n = int(0.03 * sr)
    burst = np.sin(2 * np.pi * 1000 * np.arange(burst_n) / sr) * np.exp(-np.arange(burst_n) / (0.005 * sr))
    for k, t in enumerate(times):
        i = int(t * sr)
        y[i:i + burst_n] += burst * (1.0 if k % accent_every == 0 else 0.4)
    return y, times


def tone(freq, seconds, sr=SR, amp=0.5):
    return amp * np.sin(2 * np.pi * freq * np.arange(int(seconds * sr)) / sr)


def _near(targets, candidates, tol):
    c = np.asarray(candidates)
    return np.array([np.min(np.abs(c - t)) <= tol if len(c) else False for t in targets])


def test_beats_land_on_clicks_and_tempo_is_120():
    y, true_beats = clicks()
    f = extract_features(y, SR, FPS)
    assert abs(f["tempo"] - 120) < 3
    hit = _near(true_beats[1:-1], f["beats"], tol=0.04)
    assert hit.mean() >= 0.8, f"only {hit.mean():.0%} of clicks matched a beat"


def test_downbeats_are_every_fourth_beat_on_the_accents():
    y, true_beats = clicks(accent_every=4)
    f = extract_features(y, SR, FPS)
    accents = true_beats[::4]
    db = np.asarray(f["downbeats"])
    assert len(db) >= 3
    assert _near(db, accents, tol=0.04).mean() >= 0.75
    idx = np.searchsorted(f["beats"], db)
    assert np.all(np.diff(idx) == 4)


def test_loudness_grid_is_normalised_and_tracks_level():
    quiet = tone(440, 4.0, amp=0.05)
    loud = tone(440, 4.0, amp=0.5)
    f = extract_features(np.concatenate([quiet, loud]), SR, FPS)
    n = len(f["loudness"])
    assert n == int(np.ceil(f["duration"] * FPS))
    assert f["loudness"].min() >= 0 and f["loudness"].max() <= 1
    assert f["loudness"][:n // 2].mean() < f["loudness"][n // 2:].mean() - 0.2


def test_bands_separate_bass_and_treble():
    f_low = extract_features(tone(60, 3.0), SR, FPS)
    f_high = extract_features(tone(5000, 3.0), SR, FPS)
    assert f_low["bands"].shape == (len(f_low["loudness"]), 3)
    mid = slice(20, -20)
    assert np.all(np.argmax(f_low["bands"][mid], axis=1) == 0)
    assert np.all(np.argmax(f_high["bands"][mid], axis=1) == 2)
    assert f_low["tilt"][mid].mean() < f_high["tilt"][mid].mean()


def test_sections_start_at_zero_and_split_on_timbre_change():
    y = np.concatenate([tone(110, 8.0) + tone(220, 8.0, amp=0.2), tone(3000, 8.0)])
    f = extract_features(y, SR, FPS)
    s = f["sections"]
    assert s[0] == 0.0
    assert s == sorted(s) and all(t < f["duration"] for t in s)
    assert any(abs(t - 8.0) < 2.0 for t in s[1:]), f"no boundary near 8 s in {s}"


def test_choose_palettes_sends_bassy_sections_warm_and_bright_sections_cool():
    idx = choose_palettes([-0.5, 0.5, -0.4, 0.6])
    assert len(idx) == 4
    assert idx[0] in (0, 3) and idx[2] in (0, 3)      # warm family
    assert idx[1] in (1, 2) and idx[3] in (1, 2)      # cool family
    assert idx[0] != idx[2] and idx[1] != idx[3]      # no immediate repeat within a family


def test_write_lights_json_roundtrip(tmp_path):
    frames = np.array([[255, 0, 0], [0, 128, 0]], dtype=np.uint8)
    feats = {"duration": 0.05, "tempo": 120.0, "beats": [0.0], "downbeats": [0.0],
             "sections": [0.0], "onsets": []}
    out = tmp_path / "x.lights.json"
    write_lights_json(out, feats, frames, fps=FPS, source="x.mp3", style="pulse", wav="x.wav")
    d = json.loads(out.read_text())
    assert d["fps"] == FPS and d["style"] == "pulse" and d["source"] == "x.mp3"
    assert d["frames"] == [[255, 0, 0], [0, 128, 0]]
    assert d["beats"] == [0.0] and d["wav"] == "x.wav"


def test_concert_style_renders_rig_frames_with_phases_from_real_beats():
    from analyze import render_concert
    y, true_beats = clicks(bpm=120.0, seconds=24.0)
    f = extract_features(y, SR, FPS)
    frames, phases = render_concert(f, FPS)
    assert frames.shape == (len(f["loudness"]), 41)
    assert phases[0]["start"] == 0.0 and phases[-1]["end"] == pytest.approx(f["duration"])
    assert all(p["phase"] in {"intro", "verse", "build", "drop", "anthem", "breakdown", "gap", "outro"} for p in phases)


def test_double_time_beats_are_halved():
    from analyze import halve_if_double_time
    beats = [0.5 * i for i in range(20)]
    env = np.zeros(2000); env[[int(b * SR / 512) for b in beats[1::2]]] = 1.0     # odd beats are the strong ones
    tempo, kept = halve_if_double_time(180.0, beats, env, SR)
    assert tempo == 90.0 and kept == beats[1::2]
    assert halve_if_double_time(90.0, beats, env, SR) == (90.0, beats)
