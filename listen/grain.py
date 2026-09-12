import numpy as np

from texture import RATE, collapse


def _whole(env):
    return sum(np.asarray(v, dtype=float) for v in env.values())


def noisy(path, edges):
    import librosa
    y, sr = librosa.load(path, sr=22050, mono=True)
    hop = max(1, sr // RATE)
    flat = librosa.feature.spectral_flatness(y=y, n_fft=2048, hop_length=hop)[0]
    frames = np.clip(np.asarray(edges, dtype=float) * RATE, 0, len(flat))
    v = collapse(flat, frames)
    top = float(np.percentile(v, 98)) or 1.0
    return np.clip(v / max(top, 1e-9), 0.0, 1.5)


def held(env, edges):
    whole = _whole(env)
    out = np.zeros(len(edges) - 1)
    for i in range(len(edges) - 1):
        a = int(float(edges[i]) * RATE)
        b = int(max(a + 1, float(edges[i + 1]) * RATE))
        piece = whole[a:b]
        if piece.size < 4:
            continue
        top = float(piece.max())
        out[i] = float((piece >= 0.5 * top).mean()) if top > 1e-9 else 0.0
    return np.clip(out, 0.0, 1.0)
