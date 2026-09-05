"""Harmony layers on synthesized pitch ground truth: chords, melody, notes.

Same idea as the click-track tempo check — synthesize audio whose pitch content we
set, then check the measured chords/melody/notes against that known answer.
"""
from __future__ import annotations

import numpy as np
import pytest

from musicstate.analyzers import ChordsAnalyzer, MelodyAnalyzer
from musicstate.pipeline import build, core_analyzers
from musicstate.tools.tone import note_to_hz, write_chord, write_tone

C_MAJOR = ["C4", "E4", "G4"]


@pytest.fixture(scope="module")
def cmaj_state(tmp_path_factory):
    wav = tmp_path_factory.mktemp("audio") / "cmaj.wav"
    write_chord(str(wav), C_MAJOR, seconds=6.0)
    return build(str(wav), analyzers=core_analyzers() + [ChordsAnalyzer()])


def test_chords_present_per_bar(cmaj_state):
    chords = cmaj_state["chords"]
    assert chords["rate"] == "per_bar"
    assert chords["events"], "at least one bar labelled"


def test_chords_label_the_played_triad(cmaj_state):
    labels = [e["chord"] for e in cmaj_state["chords"]["events"]]
    # a sustained C-major triad reads as C (major = bare root name)
    assert "C" in labels, f"got {labels}"


def test_chord_events_are_ordered_and_confident(cmaj_state):
    events = cmaj_state["chords"]["events"]
    dur = cmaj_state["meta"]["duration_s"]
    for e in events:
        assert 0.0 <= e["at"] <= dur + 0.05
        assert 0.0 <= e["confidence"] <= 1.0
    ats = [e["at"] for e in events]
    assert ats == sorted(ats), "events sorted by time"


@pytest.fixture(scope="module")
def a4_state(tmp_path_factory):
    wav = tmp_path_factory.mktemp("audio") / "a4.wav"
    write_tone(str(wav), "A4", seconds=5.0)
    return build(str(wav), analyzers=core_analyzers() + [MelodyAnalyzer()])


def test_melody_present(a4_state):
    melody = a4_state["melody"]
    assert melody["notes"], "melody samples produced"


def test_melody_tracks_the_played_pitch(a4_state):
    hz = np.array([m["hz"] for m in a4_state["melody"]["notes"] if m["hz"]])
    assert len(hz) > 0, "some voiced samples"
    assert np.median(hz) == pytest.approx(note_to_hz("A4"), rel=0.06)


def test_melody_names_the_note(a4_state):
    notes = [m["note"] for m in a4_state["melody"]["notes"] if m["hz"]]
    assert max(set(notes), key=notes.count) == "A4"


@pytest.fixture(scope="module")
def notes_state(tmp_path_factory):
    from musicstate.analyzers import NoteTranscriptionAnalyzer
    nt = NoteTranscriptionAnalyzer()
    ok, why = nt.available()
    if not ok:
        pytest.skip(f"basic-pitch not available: {why}")
    wav = tmp_path_factory.mktemp("audio") / "cmaj_notes.wav"
    write_chord(str(wav), C_MAJOR, seconds=4.0)
    return build(str(wav), analyzers=core_analyzers() + [nt])


def test_notes_transcribes_the_triad_pitches(notes_state):
    events = notes_state["notes"]["sources"]["mix"]
    assert events, "note events produced"
    pitch_classes = {int(ev[2]) % 12 for ev in events}
    # C-major triad: C(0), E(4), G(7) should all be transcribed
    assert {0, 4, 7} <= pitch_classes, f"got pitch classes {pitch_classes}"
