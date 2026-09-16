import os, sys, json, time, glob, warnings, gc
import numpy as np
warnings.filterwarnings("ignore")

MSST_DIR = os.environ.get("MSST_DIR", os.path.expanduser("~/proj/msst"))
sys.path.insert(0, MSST_DIR)

WAV_DIR = os.environ.get("WAV_DIR", os.path.expanduser("~/proj/wav"))
OUT_DIR = os.environ.get("OUT_DIR", os.path.expanduser("~/proj/stems-fine"))
MODEL_PATH = os.environ.get("MODEL_PATH", os.path.expanduser("~/proj/mega53/model.ckpt"))
CONFIG_PATH = os.environ.get("CONFIG_PATH", os.path.expanduser("~/proj/mega53/config.yaml"))
WINDOW_S = float(os.environ.get("WINDOW_S", "0.05"))
ONLY = os.environ.get("ONLY", "")

os.makedirs(OUT_DIR, exist_ok=True)

ALL_STEMS = [
    'accordion', 'acoustic-guitar', 'back-vocal', 'banjo', 'bass', 'bassoon',
    'bells', 'bowed_strings', 'brass', 'cello', 'clarinet', 'congas',
    'digital-piano', 'dobro', 'double-bass', 'drums', 'electric-guitar',
    'flute', 'french-horn', 'glockenspiel', 'guitar', 'harmonica', 'harp',
    'harpsichord', 'hh', 'keys', 'kick', 'lead-vocal', 'mandolin', 'marimba',
    'oboe', 'organ', 'percussion', 'piano', 'saxophone', 'sitar', 'snare',
    'strings', 'synth', 'tambourine', 'timpani', 'toms', 'triangle',
    'trombone', 'trumpet', 'tuba', 'ukulele', 'viola', 'violin', 'vocal',
    'wind', 'wind-chimes', 'woodwind'
]

import yaml
from ml_collections import ConfigDict
import torch
from models.bs_roformer import BSRoformer
import librosa

def load_model():
    with open(CONFIG_PATH) as f:
        config = ConfigDict(yaml.full_load(f))
    model = BSRoformer(**dict(config.model))
    state = torch.load(MODEL_PATH, map_location="cpu")
    model.load_state_dict(state)
    model.eval()
    model.cuda()
    return model, config

def separate_fine(model, audio_path, window_s):
    y, sr = librosa.load(audio_path, sr=44100, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])
    n_samples = y.shape[-1]
    duration_s = n_samples / sr
    n_stems = len(ALL_STEMS)

    chunk_size = 352800
    overlap = int(chunk_size * 0.15)
    step = chunk_size - overlap
    accum = np.zeros((n_stems, n_samples), dtype=np.float64)
    weight = np.zeros(n_samples, dtype=np.float32)

    for start in range(0, n_samples, step):
        end = min(start + chunk_size, n_samples)
        chunk = y[:, start:end]
        if chunk.shape[-1] < 4096:
            break
        with torch.no_grad():
            mix = torch.tensor(chunk, dtype=torch.float32).unsqueeze(0).cuda()
            out = model(mix)
            out_np = out[0].cpu().numpy()
            ns = min(out_np.shape[0], n_stems)
            for i in range(ns):
                mono = out_np[i].mean(axis=0) if out_np[i].ndim > 1 else out_np[i]
                accum[i, start:start+len(mono)] += mono[:end-start]
            weight[start:end] += 1.0
            del mix, out, out_np
        torch.cuda.empty_cache()

    weight = np.maximum(weight, 1.0)
    hop = max(1, int(round(window_s * sr)))
    n_bins = max(1, n_samples // hop)

    summary, temporal = {}, {}
    for i, name in enumerate(ALL_STEMS):
        stem = accum[i] / weight
        rms = float(np.sqrt(np.mean(stem ** 2)))
        if rms < 0.001:
            continue
        summary[name] = {
            "rms": round(rms, 6),
            "peak": round(float(np.max(np.abs(stem))), 4),
            "db": round(float(20 * np.log10(max(rms, 1e-10))), 1),
        }
        usable = stem[: n_bins * hop].reshape(n_bins, hop)
        vals = np.sqrt((usable ** 2).mean(axis=1))
        pk = float(vals.max()) if vals.size else 0.0
        if pk > 0:
            vals = vals / pk
        temporal[name] = [round(float(v), 3) for v in vals]

    del accum, weight
    gc.collect()
    torch.cuda.empty_cache()
    return summary, temporal, round(duration_s, 2)

if __name__ == "__main__":
    print(f"window_s={WINDOW_S}", flush=True)
    model, config = load_model()
    print("model loaded", flush=True)
    wavs = sorted(glob.glob(os.path.join(WAV_DIR, "*.wav")))
    if ONLY:
        wanted = set(ONLY.split(","))
        wavs = [w for w in wavs if os.path.splitext(os.path.basename(w))[0] in wanted]
    print(f"{len(wavs)} songs", flush=True)
    for i, wav in enumerate(wavs):
        slug = os.path.splitext(os.path.basename(wav))[0]
        out_path = os.path.join(OUT_DIR, f"{slug}.json")
        if os.path.exists(out_path):
            print(f"[{i+1}/{len(wavs)}] {slug} -- skip", flush=True)
            continue
        t0 = time.time()
        print(f"[{i+1}/{len(wavs)}] {slug}...", flush=True)
        try:
            summary, temporal, dur = separate_fine(model, wav, WINDOW_S)
            with open(out_path, "w") as f:
                json.dump({"slug": slug, "window_s": WINDOW_S,
                           "duration_s": dur, "stems_summary": summary,
                           "stems": temporal}, f)
            n = len(temporal)
            ln = len(next(iter(temporal.values()))) if temporal else 0
            print(f"  {n} stems, {ln} windows, {round(time.time()-t0,1)}s", flush=True)
        except Exception as e:
            print(f"  FAIL: {e}", flush=True)
            import traceback; traceback.print_exc()
