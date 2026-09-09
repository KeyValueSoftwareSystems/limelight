"""L2 — the dominant melodic line: a monophonic f0 contour.

pYIN (librosa, always available) tracks the single most-prominent pitch, sampled
onto a sixteenth-note grid derived from the beat clock and named to the nearest
note. Unvoiced frames are ``null`` — never a guessed pitch. On the whole mix this
follows the lead line loosely; the reference's per-vocals-stem version (Demucs) is
the deep upgrade and writes the same field.

Writes ``state["melody"]``; ``port.to_map`` lifts it into ``observations.melody``.
"""
from __future__ import annotations

import logging

import librosa
import numpy as np

from ..config import HOP_LENGTH
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.melody")

_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
_FMIN_NOTE = "C2"   # ~65 Hz
_FMAX_NOTE = "C7"   # ~2093 Hz


def hz_to_note(hz: float) -> str:
    midi = int(round(69 + 12 * np.log2(hz / 440.0)))
    return _NOTES[midi % 12] + str(midi // 12 - 1)


class MelodyAnalyzer(Analyzer):
    name = "pyin-melody"
    level = "L2"

    def __init__(self, hop_length: int = HOP_LENGTH):
        self.hop_length = hop_length

    def analyze(self, audio, sample_rate, ctx):
        vocals = (ctx.get("stems_audio") or {}).get("vocals")
        if vocals is not None:
            return self._from_vocals(vocals, sample_rate)
        return self._from_mix(audio, sample_rate, ctx)

    def _from_vocals(self, vocals, sample_rate):
        """Pitch-track the isolated vocals stem into discrete note events. On the mix
        the dominant pitch is rarely the vocal; on the stem it is."""
        hop = 256
        f0, voiced, _ = librosa.pyin(
            np.ascontiguousarray(vocals), sr=sample_rate, hop_length=hop,
            frame_length=2048, fmin=110.0, fmax=1000.0)
        times = librosa.times_like(f0, sr=sample_rate, hop_length=hop)

        def midi_of(hz):
            return int(round(69 + 12 * np.log2(hz / 440.0)))

        notes, i, n = [], 0, len(f0)
        while i < n:
            if not voiced[i] or not np.isfinite(f0[i]) or f0[i] <= 0:
                i += 1
                continue
            m = midi_of(f0[i])
            j = i
            while (j < n and voiced[j] and np.isfinite(f0[j]) and f0[j] > 0
                   and midi_of(f0[j]) == m):
                j += 1
            dur = float(times[min(j, n - 1)] - times[i])
            if dur >= 0.05:
                notes.append([round(float(times[i]), 3), round(dur, 3), m,
                              _NOTES[m % 12] + str(m // 12 - 1)])
            i = j

        return AnalyzerResult(
            status="ok" if len(notes) >= 20 else "not_computed",
            patch={"melody": {
                "rate": "per_note", "of": "vocals",
                "how": "pyin f0 on the isolated vocals stem, notes segmented by semitone",
                "unit": "[start_s, dur_s, midi, name]", "notes": notes,
            }},
            confidence={"melody": 0.75},
            notes=f"{len(notes)} vocal notes",
        )

    def _from_mix(self, audio, sample_rate, ctx):
        hop = self.hop_length
        hop_s = float(ctx.get("hop_s", hop / sample_rate))
        duration = float(ctx.get("duration_s", len(audio) / sample_rate))

        f0, voiced, vprob = librosa.pyin(
            audio, sr=sample_rate, hop_length=hop,
            fmin=librosa.note_to_hz(_FMIN_NOTE), fmax=librosa.note_to_hz(_FMAX_NOTE),
        )

        sixteenth = self._sixteenth_seconds(ctx)
        notes = []
        voiced_conf = []
        t = 0.0
        while t <= duration:
            i = int(round(t / hop_s))
            if 0 <= i < len(f0) and voiced[i] and np.isfinite(f0[i]) and f0[i] > 0:
                conf = round(float(vprob[i]), 3)
                notes.append({"at": round(t, 3), "hz": round(float(f0[i]), 2),
                              "note": hz_to_note(f0[i])})
                voiced_conf.append(conf)
            else:
                notes.append({"at": round(t, 3), "hz": None, "note": None})
            t += sixteenth

        frac = round(len(voiced_conf) / len(notes), 3) if notes else 0.0
        mean_conf = round(float(np.mean(voiced_conf)), 3) if voiced_conf else 0.0
        log.debug("%d sixteenths, %.0f%% voiced", len(notes), frac * 100)

        return AnalyzerResult(
            status="ok",
            patch={"melody": {
                "rate": "per_sixteenth",
                "of": "mix",
                "how": f"pyin f0, {_FMIN_NOTE}..{_FMAX_NOTE}, unvoiced=null",
                "voiced_fraction": frac,
                "notes": notes,
            }},
            confidence={"melody": mean_conf},
            notes="pyin on the whole mix; per-vocals-stem is the deep upgrade",
        )

    @staticmethod
    def _sixteenth_seconds(ctx) -> float:
        beats = ctx.get("beats") or []
        if len(beats) >= 2:
            gaps = np.diff(beats)
            beat = float(np.median(gaps))
        else:
            beat = 0.5  # 120 bpm fallback
        return max(beat / 4.0, 0.02)
