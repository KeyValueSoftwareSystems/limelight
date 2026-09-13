import numpy as np
import pytest

from phases import label_bars, phases_from_labels


def faded_like():
    """Bar-level (bass_rel dB, loud_rel dB) mimicking faded.mp3's profile (70 bars)."""
    bass = ([-17, -26, -20] + [-15] * 8 + [-10, -6, -9, -8, -7, -8, -8, -11, -17]
            + [-1] * 8 + [-1] * 8 + [-12, -15, -19, -16, -17, -15, -17, -12]
            + [-6] * 12 + [-1] * 13)
    loud = ([-12, -12.6, -12] + [-7] * 8 + [-4.4, -5.5, -5, -6.4, -4, -4, -4, -6, -7]
            + [-0.5] * 8 + [-0.5] * 8 + [-3.8, -4.4, -6.9, -6.9, -4.3, -6, -5.7, -4.6]
            + [-3.5] * 12 + [-0.7] * 13)
    return np.array(bass, float), np.array(loud, float)


def test_labels_reproduce_faded_structure():
    bass, loud = faded_like()
    lab = label_bars(bass, loud)
    assert len(lab) == 69
    assert lab[:3] == ["intro"] * 3
    assert set(lab[3:12]) == {"verse"}
    assert lab[12:20] == ["build"] * 8                     # 8 bars before drop 1, incl. the riser bar
    assert lab[20:28] == ["drop"] * 8                      # first 8 bars of the long loud block
    assert lab[28:36] == ["anthem"] * 8                    # verse 2 riding the beat
    assert set(lab[36:44]) == {"breakdown"}                # quiet pre-chorus
    assert set(lab[44:48]) == {"anthem"}                   # medium-energy vocal chorus
    assert lab[48:56] == ["build"] * 8                     # "where are you now" rise into the final drop
    assert lab[56:] == ["drop"] * 13                       # final block: all drop, no anthem split


def test_short_loud_block_is_all_drop_and_single_quiet_bar_is_a_gap():
    bass = np.array([-15] * 8 + [-1] * 6 + [-20] + [-1] * 6, float)
    loud = np.array([-6] * 8 + [-0.5] * 6 + [-9] + [-0.5] * 6, float)
    lab = label_bars(bass, loud)
    assert lab[8:14] == ["drop"] * 6
    assert lab[14] == "gap"
    assert lab[15:] == ["drop"] * 6


def test_phases_from_labels_merges_runs_and_adds_intro_and_outro():
    downbeats = [2.0, 4.0, 6.0, 8.0, 10.0, 12.0]
    labels = ["intro", "verse", "verse", "build", "drop", "drop"]
    ph = phases_from_labels(downbeats, labels, duration=20.0)
    assert ph[0] == {"start": 0.0, "end": 4.0, "phase": "intro"}        # intro absorbs the lead-in before bar 0
    assert ph[1] == {"start": 4.0, "end": 8.0, "phase": "verse"}
    assert ph[2] == {"start": 8.0, "end": 10.0, "phase": "build"}
    assert ph[3] == {"start": 10.0, "end": 14.0, "phase": "drop"}       # last bar extends one bar length
    assert ph[4] == {"start": 14.0, "end": 20.0, "phase": "outro"}      # after the last beat until the end


def raga_like():
    """62 bars mimicking raga.mp3: beatless intro, beat entry, dropout bars before each block, fade-out."""
    bass = ([-8, -14, -17, -19, -7, -13, -14, -9, -6, -11, -12, -10, -6, -12, -10, -18]      # 0-15 intro (sparse)
            + [-5, -8, -7, -6, -3, -4, -3]            # 16-22 beat enters, rising
            + [-29]                                   # 23 dropout
            + [-2, -3, -5, -3, -2, -3, -5]            # 24-30 drop
            + [-10]                                   # 31 fill
            + [-1, -1, -2, -1, -1, -1, -2]            # 32-38 drop
            + [-14]                                   # 39 dropout
            + [-1] * 14                               # 40-53 biggest block
            + [-12, -31, -8, -10, -5, -9, -9, -11])   # 54-61 fade-out
    loud = ([-7, -8, -8, -13, -7, -7, -8, -7, -5, -9, -7, -7, -5, -7, -4, -13]
            + [-5, -7, -6, -6, -4, -4, -3] + [-10] + [-2, -2, -3, -3, -2, -2, -2] + [-6]
            + [-1] * 7 + [-6] + [-1] * 14 + [-13, -21, -7, -10, -5, -7, -7, -5])
    onsets = ([3, 5, 7, 0, 6, 5, 2, 2, 0, 1, 1, 4, 4, 0, 0, 1] + [12, 14, 13, 12, 10, 12, 12] + [9]
              + [11, 12, 12, 11, 11, 11, 11] + [9] + [12] * 7 + [11] + [11] * 14 + [1, 7, 6, 8, 7, 10, 12, 7])
    return np.array(bass, float), np.array(loud, float), np.array(onsets, float)


def test_labels_are_robust_on_a_sparse_intro_short_blocks_and_fade_out():
    bass, loud, onsets = raga_like()
    lab = label_bars(bass, loud, onsets)
    assert len(lab) == 62
    assert set(lab[:16]) == {"intro"}, lab[:16]                 # beatless: no verse islands
    assert lab[16] in ("intro", "verse", "build")               # single high bar is never a 1-bar drop
    assert lab[17:20] == ["build"] * 3
    assert lab[20:23] == ["drop"] * 3 and lab[23] == "gap" and lab[24:31] == ["drop"] * 7
    assert lab[31] in ("build", "gap")                        # a real 1-bar dropout between blocks may be a gap
    assert lab[32:39] == ["drop"] * 7 and lab[39] == "gap"
    assert lab[40:54] == ["drop"] * 14                          # final block stays one drop
    assert set(lab[54:]) == {"outro"}                           # after the last drop: fade-out


def test_faded_labels_unchanged_with_onsets_available():
    bass, loud = faded_like()
    onsets = np.full(len(bass), 9.0); onsets[:3] = 8            # Faded's intro has piano onsets but is quiet
    assert label_bars(bass, loud, onsets) == label_bars(bass, loud)
