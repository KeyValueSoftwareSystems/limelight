import numpy as np

RATE = 8000
SPAN = 120.0
BANDS = 8
SLOTS = 32


def marks(path, sr=RATE, seconds=SPAN, bands=BANDS, slots=SLOTS):
    import librosa

    y, _ = librosa.load(path, sr=sr, mono=True, duration=seconds)
    if len(y) < sr:
        return None
    spec = np.abs(librosa.stft(y, n_fft=1024, hop_length=512))
    mel = librosa.feature.melspectrogram(S=spec**2, sr=sr, n_mels=bands)
    lit = np.log1p(mel)
    n = lit.shape[1]
    if n < slots:
        return None
    edge = np.linspace(0, n, slots + 1).astype(int)
    cells = np.array(
        [
            lit[:, edge[i] : max(edge[i] + 1, edge[i + 1])].mean(axis=1)
            for i in range(slots)
        ]
    )
    return (np.diff(cells, axis=0) > 0).astype(np.uint8).ravel()


def named(path):
    bits = marks(path)
    if bits is None:
        return None
    packed = np.packbits(bits)
    return {
        "fingerprint": packed.tobytes().hex(),
        "bits": int(len(bits)),
        "heard_seconds": SPAN,
    }


def apart(one, two):
    a = np.unpackbits(np.frombuffer(bytes.fromhex(one), dtype=np.uint8))
    b = np.unpackbits(np.frombuffer(bytes.fromhex(two), dtype=np.uint8))
    n = min(len(a), len(b))
    if not n:
        return None
    return int((a[:n] != b[:n]).sum())
