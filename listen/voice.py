import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

RATE = 100
CACHE = Path("work/heard")
SEP = Path("work/sep/bin/audio-separator")
MODEL = "vocals_mel_band_roformer.ckpt"


def made_by(slug):
    mark = CACHE / f"{slug}.voice.json"
    if mark.exists():
        import json
        return json.loads(mark.read_text()).get("separator")
    return None


def clean(path, slug):
    at = CACHE / f"{slug}.voice.npy"
    tune = CACHE / f"{slug}.pitch.npy"
    if at.exists() and tune.exists():
        return np.load(at), np.load(tune)
    if at.exists() and not SEP.exists():
        return np.load(at), None
    if not SEP.exists():
        return None, None

    out = CACHE / f"{slug}.voice"
    out.mkdir(parents=True, exist_ok=True)
    done = subprocess.run(
        [str(SEP), str(path), "--model_filename", MODEL,
         "--output_dir", str(out), "--output_format", "WAV"],
        capture_output=True, text=True)
    if done.returncode != 0:
        shutil.rmtree(out, ignore_errors=True)
        return None, None

    got = [f for f in out.glob("*.wav") if "(vocals)" in f.name.lower()]
    if not got:
        shutil.rmtree(out, ignore_errors=True)
        return None, None

    import soundfile as sf
    x, sr = sf.read(str(got[0]))
    if x.ndim > 1:
        x = x.mean(axis=1)
    hop = sr // RATE
    n = len(x) // hop
    env = np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(axis=1))

    f0 = None
    try:
        import librosa
        y = librosa.resample(x.astype(float), orig_sr=sr, target_sr=22050)
        step = 22050 // RATE
        f0 = librosa.yin(y, fmin=65, fmax=1200, sr=22050,
                         frame_length=2048, hop_length=step)
        f0 = np.asarray(f0, dtype=np.float32)
    except Exception:
        f0 = None

    shutil.rmtree(out, ignore_errors=True)
    at.parent.mkdir(parents=True, exist_ok=True)
    import json
    (CACHE / f"{slug}.voice.json").write_text(
        json.dumps({"separator": MODEL.replace(".ckpt", "")}))
    np.save(at, env.astype(np.float32))
    if f0 is not None:
        np.save(tune, f0)
    return env.astype(np.float32), f0
