import numpy as np
import soundfile as sf

RATE = 100


def collapse(x, frames, how=np.mean):
    out = np.zeros(len(frames) - 1)
    for i in range(len(frames) - 1):
        a = int(frames[i])
        b = int(max(a + 1, frames[i + 1]))
        piece = x[a:b]
        out[i] = how(piece) if piece.size else 0.0
    return out


def sides(path, edges):
    x, sr = sf.read(path, always_2d=True)
    if x.shape[1] < 2:
        return np.zeros(len(edges) - 1)
    mid = (x[:, 0] + x[:, 1]) / 2.0
    side = (x[:, 0] - x[:, 1]) / 2.0
    hop = max(1, sr // RATE)
    n = len(mid) // hop
    m = np.sqrt((mid[: n * hop].reshape(n, hop) ** 2).mean(axis=1))
    s = np.sqrt((side[: n * hop].reshape(n, hop) ** 2).mean(axis=1))
    wide = s / np.maximum(m, 1e-9)
    frames = np.clip(np.asarray(edges, dtype=float) * RATE, 0, n)
    return np.clip(collapse(wide, frames), 0.0, 2.0)


def air(path, edges, cut=6000):
    import librosa
    y, sr = librosa.load(path, sr=22050, mono=True)
    hop = sr // RATE
    spec = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    high = spec[freqs >= cut].sum(axis=0)
    whole = spec.sum(axis=0)
    lift = high / np.maximum(whole, 1e-9)
    frames = np.clip(np.asarray(edges, dtype=float) * RATE, 0, len(lift))
    out = collapse(lift, frames)
    top = float(np.percentile(out, 98)) or 1.0
    return np.clip(out / top, 0.0, 1.5)


def duck(env, g, edges):
    whole = sum(np.asarray(v, dtype=float) for v in env.values())
    beat_s = 60.0 / g["bpm"]
    frames = int(round(beat_s * RATE))
    if frames < 4 or not len(whole):
        return np.zeros(len(edges) - 1)
    n = len(whole) // frames
    per = whole[: n * frames].reshape(n, frames)
    top = per.max(axis=1)
    low = per[:, : max(2, frames // 3)].min(axis=1)
    deep = 1.0 - low / np.maximum(top, 1e-9)
    wide = np.repeat(deep, frames)
    frames_at = np.clip(np.asarray(edges, dtype=float) * RATE, 0, len(wide))
    return np.clip(collapse(wide, frames_at), 0.0, 1.0)


def pace(onsets, g, edges):
    beat_s = 60.0 / g["bpm"]
    hits = np.asarray(onsets, dtype=float)
    out = np.zeros(len(edges) - 1)
    for i in range(len(edges) - 1):
        a, b = float(edges[i]), float(edges[i + 1])
        span = max(b - a, 1e-6)
        out[i] = ((hits >= a) & (hits < b)).sum() / (span / beat_s)
    mid = float(np.median(out[out > 0])) if (out > 0).any() else 1.0
    return np.clip(out / (mid or 1.0), 0.0, 4.0)


def bands(path, edges, low=120, sub=60):
    # Two measures of treble and none of weight. Most of what a drop feels like
    # happens under 120 Hz, and the score could not see any of it: air is
    # everything above 6 kHz and brightness is the high bins. weight is the
    # share of the sound below 120 Hz, floor is the share below 60 Hz -- the
    # part you feel in your chest rather than hear.
    import librosa
    y, sr = librosa.load(path, sr=22050, mono=True)
    hop = sr // RATE
    spec = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    whole = np.maximum(spec.sum(axis=0), 1e-9)
    out = {}
    for name, cut in (("weight", low), ("floor", sub)):
        part = spec[freqs <= cut].sum(axis=0) / whole
        frames = np.clip(np.asarray(edges, dtype=float) * RATE, 0, len(part))
        v = collapse(part, frames)
        top = float(np.percentile(v, 98)) or 1.0
        out[name] = np.clip(v / top, 0.0, 1.5)
    return out
