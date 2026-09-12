import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

RATE = 100
CACHE = Path("work/heard")
LOW = 80.0
HIGH = 1200.0
HARMONICS = (1, 2, 3, 4)
REACH = 4600.0


def carve(path, into):
    done = subprocess.run(
        [
            sys.executable,
            "-m",
            "demucs",
            "-n",
            "htdemucs",
            "-o",
            str(into),
            "--filename",
            "{stem}.wav",
            "-j",
            "1",
            str(path),
        ],
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        return None
    got = list(Path(into).rglob("other.wav"))
    return got[0] if got else None


def salience(y, sr):
    import librosa

    step = sr // RATE
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=step))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    top = int(np.searchsorted(freqs, REACH)) + 1
    S, freqs = S[:top], freqs[:top]
    sal = librosa.salience(S, freqs=freqs, harmonics=list(HARMONICS), fill_value=0.0)
    lo = int(np.searchsorted(freqs, LOW))
    hi = int(np.searchsorted(freqs, HIGH))
    band = sal[lo:hi]
    pick = np.argmax(band, axis=0)
    return freqs[lo:hi][pick], band[pick, np.arange(band.shape[1])]


def hear(path, slug):
    tune = CACHE / f"{slug}.lead.npy"
    loud = CACHE / f"{slug}.leadenv.npy"
    if tune.exists() and loud.exists():
        return np.load(tune), np.load(loud)

    hold = tempfile.mkdtemp(prefix=f"lead-{slug}-")
    try:
        stem = carve(path, hold)
        if stem is None:
            return None, None
        import librosa
        import soundfile as sf

        x, sr = sf.read(str(stem))
        if x.ndim > 1:
            x = x.mean(axis=1)
        y = librosa.resample(x.astype(float), orig_sr=sr, target_sr=22050)
        f0, strength = salience(y, 22050)
    except Exception:
        return None, None
    finally:
        shutil.rmtree(hold, ignore_errors=True)

    CACHE.mkdir(parents=True, exist_ok=True)
    import json
    (CACHE / f"{slug}.lead.json").write_text(
        json.dumps({"separator": "htdemucs", "melody_from": "harmonic salience"}))
    np.save(tune, np.asarray(f0, dtype=np.float32))
    np.save(loud, np.asarray(strength, dtype=np.float32))
    return np.load(tune), np.load(loud)


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        src = Path(arg)
        f0, env = hear(str(src), src.stem)
        state = f"{len(f0)} frames" if f0 is not None else "FAILED"
        print(f"{src.stem}: {state}", flush=True)
