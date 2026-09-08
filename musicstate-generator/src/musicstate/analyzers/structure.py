"""L2 — musical structure via librosa: tempo, beats, downbeats, key, sections, events.

The always-available structure baseline. When allin1 is present it supersedes the
beats/downbeats/sections here; this still contributes the energy curve and the
derived drop/build events. Downbeats and drop/build are *derived* (no model emits
them) and reported with honest confidence.
"""
from __future__ import annotations

import logging

import librosa
import numpy as np

from ..config import HOP_LENGTH
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.structure")

# Krumhansl–Schmuckler key profiles
_KS_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_KS_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


class StructureAnalyzer(Analyzer):
    name = "librosa-structure"
    level = "L2"

    def __init__(self, hop_length: int = HOP_LENGTH):
        self.hop_length = hop_length

    def analyze(self, audio, sample_rate, ctx):
        hop = self.hop_length
        duration = float(ctx.get("duration_s", len(audio) / sample_rate))
        onset = ctx.get("onset")
        if onset is None:
            onset = librosa.onset.onset_strength(y=audio, sr=sample_rate, hop_length=hop)

        patch: dict = {}
        conf: dict = {}
        notes: list[str] = []

        tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=sample_rate, hop_length=hop)
        tempo = float(np.atleast_1d(tempo)[0])
        beats = librosa.frames_to_time(beat_frames, sr=sample_rate, hop_length=hop)
        patch["beats"] = [round(float(t), 4) for t in beats]
        conf["tempo"] = 0.75
        conf["beats"] = 0.7
        log.debug("tempo %.1f bpm, %d beats", tempo, len(beats))

        downbeats, downbeat_conf = self._downbeats(beats, beat_frames, onset)
        patch["downbeats"] = [round(float(t), 4) for t in downbeats]
        conf["downbeats"] = downbeat_conf
        notes.append("downbeats: 4/4 phase heuristic, not a model")

        try:
            key, mode, key_conf = self._key(audio, sample_rate, hop)
        except Exception as exc:  # noqa: BLE001
            key, mode, key_conf = None, None, 0.0
            notes.append(f"key failed: {exc!r}")
        patch["meta_partial"] = {"tempo_bpm": round(tempo, 2), "key": key, "mode": mode,
                                 "time_signature": "4/4"}
        conf["key"] = key_conf

        try:
            sections, energy, section_conf = self._sections(audio, sample_rate, hop, duration, downbeats)
        except Exception as exc:  # noqa: BLE001
            sections = [{"t0": 0.0, "t1": round(duration, 3), "label": "all", "energy": None, "conf": 0.0}]
            energy, section_conf = [], 0.0
            notes.append(f"sections failed: {exc!r}")
        patch["sections"] = sections
        patch["energy"] = energy
        conf["sections"] = section_conf

        patch["events"] = self._events(sections)

        return AnalyzerResult(
            status="ok",
            patch=patch,
            confidence=conf,
            ctx={"beats": patch["beats"], "downbeats": patch["downbeats"]},
            notes="; ".join(notes),
        )

    # ------------------------------------------------------------------ #

    def _downbeats(self, beats, beat_frames, onset):
        if len(beats) < 4:
            return beats[:1], 0.2
        strengths = onset[np.clip(beat_frames, 0, len(onset) - 1)]
        sums = [strengths[p::4].sum() for p in range(4)]
        phase = int(np.argmax(sums))
        total = sum(sums) or 1.0
        conf = max(0.0, min(1.0, float(sums[phase] / total * 4 - 1)))
        return beats[phase::4], round(conf, 3)

    def _key(self, audio, sample_rate, hop):
        chroma = librosa.feature.chroma_cqt(y=audio, sr=sample_rate, hop_length=hop).mean(axis=1)
        best = (-1.0, None, None)
        for shift in range(12):
            cmaj = float(np.corrcoef(chroma, np.roll(_KS_MAJOR, shift))[0, 1])
            cmin = float(np.corrcoef(chroma, np.roll(_KS_MINOR, shift))[0, 1])
            if cmaj > best[0]:
                best = (cmaj, _NOTES[shift], "major")
            if cmin > best[0]:
                best = (cmin, _NOTES[shift], "minor")
        corr, key, mode = best
        return key, mode, round(max(0.0, corr), 3)

    def _sections(self, audio, sample_rate, hop, duration, downbeats):
        chroma = librosa.feature.chroma_cqt(y=audio, sr=sample_rate, hop_length=hop)
        k = int(max(2, min(8, round(duration / 25))))
        bounds = librosa.segment.agglomerative(chroma, k)
        boundary_times = list(librosa.frames_to_time(bounds, sr=sample_rate, hop_length=hop))
        edges = sorted(set([0.0] + [float(t) for t in boundary_times] + [round(duration, 3)]))

        rms = librosa.feature.rms(y=audio, hop_length=hop)[0]
        t_rms = librosa.frames_to_time(np.arange(len(rms)), sr=sample_rate, hop_length=hop)
        gmax = float(rms.max()) or 1.0

        raw = []
        for a, b in zip(edges[:-1], edges[1:]):
            seg = rms[(t_rms >= a) & (t_rms < b)]
            raw.append((a, b, float(seg.mean() / gmax) if len(seg) else 0.0))

        energies = sorted(e for _, _, e in raw)
        lo = energies[len(energies) // 3] if energies else 0.0
        hi = energies[2 * len(energies) // 3] if energies else 1.0
        label = lambda e: "low" if e <= lo else ("high" if e >= hi else "mid")  # noqa: E731

        sections = [{"t0": round(a, 3), "t1": round(b, 3), "label": label(e),
                     "energy": round(e, 3), "conf": 0.5} for a, b, e in raw]

        curve = []
        for t in downbeats:
            idx = int(np.clip(np.searchsorted(t_rms, t), 0, len(rms) - 1))
            curve.append([round(float(t), 3), round(float(rms[idx] / gmax), 3)])
        return sections, curve, 0.5

    def _events(self, sections):
        events = []
        for prev, cur in zip(sections[:-1], sections[1:]):
            pe, ce = prev.get("energy"), cur.get("energy")
            if pe is None or ce is None:
                continue
            delta = ce - pe
            if delta >= 0.2:
                events.append({"t": cur["t0"], "type": "drop", "conf": round(min(1.0, delta * 2), 3)})
                events.append({"t": prev["t0"], "type": "build", "conf": 0.4})
            elif delta <= -0.2:
                events.append({"t": cur["t0"], "type": "quiet", "conf": round(min(1.0, -delta * 2), 3)})
        events.sort(key=lambda e: e["t"])
        return events
