import os, sys, json, time, glob, warnings, gc
import numpy as np
warnings.filterwarnings("ignore")

MSST_DIR = os.environ.get("MSST_DIR", os.path.expanduser("~/proj/msst"))
sys.path.insert(0, MSST_DIR)

WAV_DIR = os.environ.get("WAV_DIR", "work/wav")
OUT_DIR = os.environ.get("OUT_DIR", "work/stems-53-temporal")
MODEL_PATH = os.environ.get("MODEL_PATH", "work/mega53/model.ckpt")
CONFIG_PATH = os.environ.get("CONFIG_PATH", "work/mega53/config.yaml")

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

def separate_temporal(model, audio_path, bar_duration_s=2.0):
    """Separate and compute per-bar RMS for each stem."""
    y, sr = librosa.load(audio_path, sr=44100, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])

    duration_s = y.shape[-1] / sr
    n_bars = max(1, int(duration_s / bar_duration_s))
    bar_samples = int(bar_duration_s * sr)
    n_stems = len(ALL_STEMS)
    n_samples = y.shape[-1]

    # Process in chunks, accumulate full stems
    chunk_size = 352800  # ~8s at 44100
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

    # Compute per-bar RMS for each stem
    result = {}
    for i, name in enumerate(ALL_STEMS):
        stem = accum[i] / weight
        # Overall RMS
        overall_rms = float(np.sqrt(np.mean(stem ** 2)))
        if overall_rms < 0.0005:
            continue  # Skip silent stems

        # Per-bar RMS
        per_bar = []
        for b in range(n_bars):
            s = b * bar_samples
            e = min(s + bar_samples, n_samples)
            seg = stem[s:e]
            rms = float(np.sqrt(np.mean(seg ** 2)))
            per_bar.append(round(rms, 5))

        result[name] = {
            "rms": round(overall_rms, 6),
            "peak": round(float(np.max(np.abs(stem))), 4),
            "db": round(float(20 * np.log10(max(overall_rms, 1e-10))), 1),
            "per_bar": per_bar
        }

    del accum, weight
    gc.collect()
    return result, n_bars, round(duration_s, 2), round(bar_duration_s, 3)

if __name__ == "__main__":
    print("Loading MVSep Mega 53-Stem model...", flush=True)
    model, config = load_model()
    print("Model loaded!", flush=True)

    wavs = sorted(glob.glob(os.path.join(WAV_DIR, "*.wav")))
    print(f"53-Stem Temporal: {len(wavs)} songs", flush=True)

    for i, wav in enumerate(wavs):
        slug = os.path.splitext(os.path.basename(wav))[0]
        out_path = os.path.join(OUT_DIR, f"{slug}.json")
        if os.path.exists(out_path):
            print(f"[{i+1}/{len(wavs)}] {slug} -- skip", flush=True)
            continue
        t0 = time.time()
        print(f"[{i+1}/{len(wavs)}] {slug}...", flush=True)
        try:
            stems, n_bars, dur, bar_dur = separate_temporal(model, wav)
            sorted_stems = dict(sorted(stems.items(), key=lambda x: -x[1]["rms"]))
            result = {
                "slug": slug,
                "instruments_detected": len(sorted_stems),
                "n_bars": n_bars,
                "duration_s": dur,
                "bar_duration_s": bar_dur,
                "instruments": sorted_stems,
                "time_s": round(time.time() - t0, 1)
            }
            with open(out_path, "w") as f:
                json.dump(result, f, indent=2)
            names = list(sorted_stems.keys())
            print(f"  {len(names)} instruments, {n_bars} bars: {', '.join(names[:8])}", flush=True)
        except Exception as e:
            print(f"  FAIL: {e}", flush=True)
            import traceback; traceback.print_exc()
        torch.cuda.empty_cache()
        gc.collect()

    print("STEMS_TEMPORAL_DONE", flush=True)
