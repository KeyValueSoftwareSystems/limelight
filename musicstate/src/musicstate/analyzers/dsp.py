"""L1 — dense DSP/signal features, straight from the waveform.

Deterministic, cheap, real-time-grade: the always-available reactive foundation.
One STFT feeds every feature so all frame counts share one clock.
"""
from __future__ import annotations

import logging

import librosa
import numpy as np

from ..config import HOP_LENGTH, N_FFT
from .base import Analyzer, AnalyzerResult

log = logging.getLogger("musicstate.dsp")


def _round(values, ndigits: int = 5) -> list[float]:
    return [round(float(x), ndigits) for x in values]


def _norm01(values: np.ndarray) -> np.ndarray:
    peak = float(values.max())
    return values / peak if peak > 0 else values


class DspAnalyzer(Analyzer):
    name = "librosa-dsp"
    level = "L1"

    def __init__(self, hop_length: int = HOP_LENGTH, n_fft: int = N_FFT):
        self.hop_length = hop_length
        self.n_fft = n_fft

    def analyze(self, audio, sample_rate, ctx):
        hop, n_fft = self.hop_length, self.n_fft
        magnitude = np.abs(librosa.stft(audio, n_fft=n_fft, hop_length=hop))

        rms = librosa.feature.rms(S=magnitude, frame_length=n_fft, hop_length=hop)[0]
        centroid = librosa.feature.spectral_centroid(S=magnitude, sr=sample_rate)[0]
        rolloff = librosa.feature.spectral_rolloff(S=magnitude, sr=sample_rate)[0]
        flatness = librosa.feature.spectral_flatness(S=magnitude)[0]
        onset = librosa.onset.onset_strength(y=audio, sr=sample_rate, hop_length=hop)

        # per-band energy: bass < 250 Hz, mid 250–4k, treble >= 4k
        freqs = librosa.fft_frequencies(sr=sample_rate, n_fft=n_fft)
        power = magnitude ** 2
        low = power[freqs < 250].sum(0)
        mid = power[(freqs >= 250) & (freqs < 4000)].sum(0)
        high = power[freqs >= 4000].sum(0)

        n = min(len(rms), len(centroid), len(rolloff), len(flatness), len(onset),
                len(low), len(mid), len(high))
        hop_s = hop / sample_rate
        log.debug("computed %d frames at %.4fs hop", n, hop_s)

        frames = {
            "hop_s": round(hop_s, 6),
            "t0": 0.0,
            "n": int(n),
            "rms": _round(rms[:n]),
            "onset": _round(onset[:n]),
            "bands": {
                "low": _round(_norm01(low)[:n]),
                "mid": _round(_norm01(mid)[:n]),
                "high": _round(_norm01(high)[:n]),
            },
            "centroid_hz": _round(centroid[:n], 1),
            "rolloff_hz": _round(rolloff[:n], 1),
            "flatness": _round(flatness[:n]),
        }
        return AnalyzerResult(
            status="ok",
            patch={"frames": frames},
            ctx={"onset": onset, "rms": rms, "hop_s": hop_s},
            notes="bass<250Hz, mid 250-4k, treble>=4k; bands normalized to own max",
        )
