"""The three curves the mix itself gives up, measured from the audio.

The stem lanes are each divided by that instrument's own envelope max, so
anything read off them is a statement about instruments rather than about
sound. energy, brightness and groove are claims about sound, and every one of
them was being approximated from lane membership instead.

Measured against these references over 29 songs, the lane versions scored:
energy 0.785 against loudness, which is a fair proxy; groove 0.345 against
percussive share; and brightness -0.083 against spectral centroid, positive on
only 12 of 29 songs. Brightness did not merely fail, its sign flipped between
songs - afterglow -0.74, mizhiyoram +0.70 - so two songs compared on that
number meant opposite things.

Centroid correlates 0.53 with loudness, so it is a second dimension and not
another spelling of the first.
"""
import numpy as np

FFT = 2048


def series(path, window_s):
    """Per-window loudness, spectral centroid and percussive share."""
    import soundfile as sf
    import librosa

    x, sr = sf.read(path, dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    hop = max(1, int(round(window_s * sr)))
    n = len(x) // hop
    if n < 4:
        return None
    body = x[: n * hop]
    seg = body.reshape(n, hop).astype(np.float64)
    loud = np.sqrt((seg * seg).mean(axis=1))
    spec = np.abs(librosa.stft(body, n_fft=FFT, hop_length=hop, center=False))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=FFT)
    total = spec.sum(axis=0) + 1e-12
    centroid = (freqs[:, None] * spec).sum(axis=0) / total
    harm, perc = librosa.decompose.hpss(spec)
    share = perc.sum(axis=0) / (harm.sum(axis=0) + perc.sum(axis=0) + 1e-12)
    m = min(n, len(centroid), len(share))
    return {
        "window_s": window_s,
        "loudness": [round(float(v), 6) for v in loud[:m]],
        "centroid_hz": [round(float(v), 2) for v in centroid[:m]],
        "percussive": [round(float(v), 5) for v in share[:m]],
    }


def span(block, name, a, b):
    """The mean of one curve over a stretch of seconds, or None."""
    if not isinstance(block, dict):
        return None
    v = block.get(name)
    w = block.get("window_s")
    if not isinstance(v, list) or not v or not w:
        return None
    i, j = int(a / w), max(int(a / w) + 1, int(b / w))
    i, j = max(0, i), min(len(v), j)
    if j <= i:
        return None
    return sum(v[i:j]) / (j - i)
