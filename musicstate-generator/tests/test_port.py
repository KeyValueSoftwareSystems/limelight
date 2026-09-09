"""Unit tests for the MusicState -> MAP v0.3 conversion (pure, no audio, no models)."""
from __future__ import annotations

from musicstate.port import to_map

STATE = {
    "musicstate_version": "0.1",
    "source": {"path": "/x/Song.mp3", "duration_s": 30.0},
    "meta": {"duration_s": 30.0, "tempo_bpm": 120.0, "key": "A", "mode": "minor",
             "time_signature": "4/4"},
    "frames": {"hop_s": 0.02322, "t0": 0.0, "n": 3,
               "rms": [0.00001, 0.5, 0.5], "onset": [0.0208, 0.1, 0.2],
               "bands": {"low": [0.00001, 0.2, 0.3], "mid": [0.0, 0.1, 0.2],
                         "high": [0.0, 0.05, 0.1]},
               "centroid_hz": [1, 2, 3]},
    "beats": [0.5, 1.0, 1.5, 2.0],
    "downbeats": [0.5, 2.0],
    "sections": [
        {"t0": 0.0, "t1": 5.0, "label": "intro", "conf": 0.7},
        {"t0": 5.0, "t1": 10.0, "label": "chorus", "conf": 0.7},
        {"t0": 10.0, "t1": 15.0, "label": "chorus", "conf": 0.7},  # consecutive -> merge
        {"t0": 15.0, "t1": 30.0, "label": "outro", "conf": 0.7},
    ],
    "energy": [[0.5, 0.3], [2.0, 0.8]],
    "events": [
        {"t": 0.0, "type": "build", "conf": 0.4},
        {"t": 10.0, "type": "drop", "conf": 0.7},
        {"t": 25.0, "type": "quiet", "conf": 0.6},
        {"t": 26.0, "type": "wobble", "conf": 0.9},  # not one of the six -> dropped
    ],
    "stems": {"model": "htdemucs", "names": ["drums", "vocals"], "rate": "per_downbeat",
              "per_downbeat": [{"t": 0.5, "drums": 0.2, "vocals": 0.1},
                               {"t": 2.0, "drums": 0.4, "vocals": 0.6}],
              "vocal_present_fraction": 0.5},
    "chords": {"rate": "per_bar", "how": "chroma templates",
               "events": [{"at": 0.5, "chord": "Am", "confidence": 0.8}]},
    "melody": {"rate": "per_sixteenth", "of": "mix", "how": "pyin",
               "notes": [{"at": 0.5, "hz": 440.0, "note": "A4"}]},
    "notes": {"how": "basic-pitch onnx", "format": "[onset_s, offset_s, midi, amplitude]",
              "sources": {"mix": [[0.5, 1.0, 69, 0.8]]}},
    "semantic": {"status": "ok", "backend": "essentia", "mood": {"party": 0.8},
                 "danceability": 0.9, "voice": 0.5, "genre_top": [["House", 0.4]]},
    "embedding": {"status": "not_computed"},
    "confidence_by_field": {"tempo": 0.8, "key": 0.6},
    "provenance": {"tool": "musicstate 0.1.0", "analyzers": [{"level": "L1", "name": "x"}]},
}


def _m():
    return to_map(STATE, vec_filename="song.vec.f16")


def test_version_and_song():
    m = _m()
    assert m["map"] == "0.3"
    assert m["song"] == {"title": "Song.mp3", "artist": "?", "length": 30.0}


def test_grid():
    g = _m()["grid"]
    assert g["period"] == 0.5 and g["phase"] == 0.5 and g["bpm"] == 120.0
    assert g["bar_phase"] == 0  # first beat is a downbeat


def test_chapters_merge_consecutive_labels():
    m = _m()
    assert [c["name"] for c in m["chapters"]] == ["intro", "chorus", "outro"]
    # section entries carry id / repeat / arc, last arc is 1.0
    entries = m["sections"]["entries"]
    assert [e["id"] for e in entries] == ["I", "C", "O"]
    assert entries[-1]["arc"] == 1.0


def test_moments_six_kinds_and_drop_size():
    m = _m()
    kinds = [x["kind"] for x in m["moments"]]
    assert kinds == ["build", "drop", "quiet"]  # 'wobble' dropped
    drop = next(x for x in m["moments"] if x["kind"] == "drop")
    assert drop["confidence"] == 0.7 and drop["size"] == 0.9  # size = conf + 0.2


def test_spans_pair_build_to_next_drop():
    spans = _m()["spans"]
    assert len(spans) == 1
    assert spans[0]["from"] == 0.0 and spans[0]["to"] == 10.0 and spans[0]["kind"] == "build"


def test_confidence_is_mean_of_fields():
    assert _m()["confidence"] == 0.7  # mean(0.8, 0.6)


def test_stems_reshape_with_guitar_piano_zeros():
    s = _m()["stems"]
    assert set(s["sources"]) == {"drums", "vocals", "guitar", "piano"}
    assert s["sources"]["guitar"] == [0.0, 0.0] and s["sources"]["piano"] == [0.0, 0.0]
    assert s["at"] == [0.5, 2.0]


def test_frames_flattened_and_rounded():
    f = _m()["observations"]["frames"]
    assert set(f) >= {"how", "hop_s", "n", "rms", "onset", "low", "mid", "high", "note"}
    assert "bands" not in f
    assert f["rms"][0] == 0.0  # 0.00001 rounded to 4 dp
    assert f["onset"][0] == 0.0208


def test_vectors_null_when_embedding_absent():
    assert _m()["vectors"] is None


def test_key_and_semantic_note():
    obs = _m()["observations"]
    assert obs["key"]["estimate"] == "A minor" and obs["key"]["confidence"] == 0.6
    assert "party and danceability" in obs["semantic"]["note"]


def test_harmony_layers_lifted_into_observations():
    obs = _m()["observations"]
    assert obs["chords"]["rate"] == "per_bar"
    assert obs["chords"]["events"][0]["chord"] == "Am"
    # melody is converted to list form [start_s, name, midi]; 440 Hz -> A4 / midi 69
    assert obs["melody"]["notes"][0] == [0.5, "A4", 69]
    assert obs["notes"]["sources"]["mix"][0][2] == 69  # midi A4


def test_harmony_layers_null_when_unmeasured():
    from musicstate.port import to_map
    bare = {k: v for k, v in STATE.items() if k not in ("chords", "melody", "notes")}
    obs = to_map(bare)["observations"]
    assert obs["chords"] is None and obs["melody"] is None and obs["notes"] is None


def test_pos_added_to_timed_entries():
    m = _m()
    # moments are grid-aligned but not bar-snapped; pos = (at - phase) / period
    drop = next(x for x in m["moments"] if x["kind"] == "drop")
    assert drop["pos"] == round((drop["at"] - 0.5) / 0.5, 4)
    # chapters are snapped to the bar grid; pos stays consistent with the snapped at
    ch = next(c for c in m["chapters"] if c["name"] == "chorus")
    assert ch["pos"] == round((ch["at"] - 0.5) / 0.5, 4)
    assert m["spans"][0]["pos_from"] == round((m["spans"][0]["from"] - 0.5) / 0.5, 4)


def test_chapters_snapped_to_bar_lines():
    m = _m()
    per, ph, bp = m["grid"]["period"], m["grid"]["phase"], m["grid"]["bar_phase"]
    bar, base = 4 * per, ph + bp * per
    for c in m["chapters"]:
        if c["at"] <= ph:
            continue                     # the 0.0 intro anchor is exempt
        off = abs((c["at"] - base) % bar)
        assert min(off, bar - off) < 1e-3, f"chapter {c['at']} not on a bar line"


def test_groove_from_accents():
    from musicstate.port import to_map
    # 24 accents: 12 exactly on beats (off16 ~ 0), 12 a hair after the off-sixteenth
    evs = []
    for i in range(12):
        evs.append({"at": 0.5 + i * 0.5, "strength": 0.6})            # on the beat
        evs.append({"at": 0.5 + i * 0.5 + 0.125 + 0.025, "strength": 0.4})  # a hair late
    state = {**STATE, "accents": {"rate": "onset", "events": evs}}
    obs = to_map(state)["observations"]
    assert obs["groove"] is not None
    assert obs["groove"]["hits"] == 24
    assert "by_sixteenth" in obs["groove"]


def test_bar_phase_decision_lifted_when_present():
    from musicstate.port import to_map
    obs = to_map({**STATE, "bar_phase_decision": {"to_phase": 2}})["observations"]
    assert obs["bar_phase_decision"]["to_phase"] == 2
    assert _m()["observations"]["bar_phase_decision"] is None   # null when unmeasured


def test_events_retimed_preferred_over_events():
    from musicstate.port import to_map
    st = {**STATE,
          "events": [{"t": 10.0, "type": "drop", "conf": 0.7}],
          "events_retimed": [{"t": 11.5, "type": "drop", "conf": 0.7}]}
    m = to_map(st)
    drop = next(x for x in m["moments"] if x["kind"] == "drop")
    assert drop["at"] == 11.5      # the re-timed position wins; no snap to a downbeat
    assert to_map(st)["observations"]["moment_timing"] is None  # null unless the analyzer wrote it
