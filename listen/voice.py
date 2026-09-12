import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

RATE = 100
CACHE = Path("work/heard")
SEP = Path("work/sep/bin/audio-separator")
MODEL = "vocals_mel_band_roformer.ckpt"


def clean(path, slug):
    at = CACHE / f"{slug}.voice.npy"
    if at.exists():
        return np.load(at)
    if not SEP.exists():
        return None

    out = CACHE / f"{slug}.voice"
    out.mkdir(parents=True, exist_ok=True)
    done = subprocess.run(
        [str(SEP), str(path), "--model_filename", MODEL,
         "--output_dir", str(out), "--output_format", "WAV"],
        capture_output=True, text=True)
    if done.returncode != 0:
        shutil.rmtree(out, ignore_errors=True)
        return None

    got = [f for f in out.glob("*.wav") if "(vocals)" in f.name.lower()]
    if not got:
        shutil.rmtree(out, ignore_errors=True)
        return None

    import soundfile as sf
    x, sr = sf.read(str(got[0]))
    if x.ndim > 1:
        x = x.mean(axis=1)
    hop = sr // RATE
    n = len(x) // hop
    env = np.sqrt((x[: n * hop].reshape(n, hop) ** 2).mean(axis=1))
    shutil.rmtree(out, ignore_errors=True)
    at.parent.mkdir(parents=True, exist_ok=True)
    np.save(at, env.astype(np.float32))
    return env.astype(np.float32)
