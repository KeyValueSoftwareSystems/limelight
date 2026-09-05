"""Audio loading: any file ffmpeg/soundfile can read → mono float32 + sample rate."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

import librosa
import numpy as np

from .config import SAMPLE_RATE


@dataclass
class Audio:
    samples: np.ndarray  # mono, float32, [-1, 1]
    sample_rate: int
    path: str
    sha1: str
    duration_s: float


def _sha1(path: str, chunk: int = 1 << 20) -> str:
    digest = hashlib.sha1()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            digest.update(block)
    return digest.hexdigest()


def load_audio(path: str, sample_rate: int = SAMPLE_RATE) -> Audio:
    samples, sr = librosa.load(path, sr=sample_rate, mono=True)
    samples = np.asarray(samples, dtype="float32")
    return Audio(
        samples=samples,
        sample_rate=int(sr),
        path=path,
        sha1=_sha1(path),
        duration_s=float(len(samples) / sr),
    )
