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
