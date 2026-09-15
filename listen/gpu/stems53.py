import os, sys, json, time, glob, warnings
import numpy as np

warnings.filterwarnings("ignore")

MSST_DIR = os.environ.get("MSST_DIR", os.path.expanduser("~/proj/msst"))
sys.path.insert(0, MSST_DIR)

WAV_DIR = os.environ.get("WAV_DIR", "work/wav")
OUT_DIR = os.environ.get("OUT_DIR", "work/stems-53-summary")
MODEL_PATH = os.environ.get("MODEL_PATH", "work/mega53/model.ckpt")
CONFIG_PATH = os.environ.get("CONFIG_PATH", "work/mega53/config.yaml")

os.makedirs(OUT_DIR, exist_ok=True)

ALL_STEMS = [
    "accordion",
    "acoustic-guitar",
    "back-vocal",
    "banjo",
    "bass",
    "bassoon",
    "bells",
    "bowed_strings",
    "brass",
    "cello",
    "clarinet",
    "congas",
    "digital-piano",
    "dobro",
    "double-bass",
    "drums",
    "electric-guitar",
    "flute",
    "french-horn",
    "glockenspiel",
    "guitar",
    "harmonica",
    "harp",
    "harpsichord",
    "hh",
    "keys",
    "kick",
    "lead-vocal",
    "mandolin",
    "marimba",
    "oboe",
    "organ",
    "percussion",
    "piano",
    "saxophone",
    "sitar",
    "snare",
    "strings",
    "synth",
    "tambourine",
    "timpani",
    "toms",
    "triangle",
    "trombone",
    "trumpet",
    "tuba",
    "ukulele",
    "viola",
    "violin",
    "vocal",
    "wind",
    "wind-chimes",
    "woodwind",
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


def separate(model, config, audio_path):
    y, sr = librosa.load(audio_path, sr=44100, mono=False)
    if y.ndim == 1:
        y = np.stack([y, y])

    with torch.no_grad():
        mix = torch.tensor(y, dtype=torch.float32).unsqueeze(0).cuda()
        result = model(mix)

    stems = {}
    for i, name in enumerate(ALL_STEMS):
        if i >= result.shape[1]:
            break
        stem_audio = result[0, i].cpu().numpy()
        rms = float(np.sqrt(np.mean(stem_audio**2)))
        if rms > 0.001:
            stems[name] = {
                "rms": round(rms, 6),
                "peak": round(float(np.max(np.abs(stem_audio))), 4),
                "db": round(float(20 * np.log10(max(rms, 1e-10))), 1),
            }
    return stems


if __name__ == "__main__":
    print("Loading MVSep Mega 53-Stem model...", flush=True)
    model, config = load_model()
    print("Model loaded!", flush=True)

    wavs = sorted(glob.glob(os.path.join(WAV_DIR, "*.wav")))
    print(f"Processing {len(wavs)} songs", flush=True)

    for i, wav in enumerate(wavs):
        slug = os.path.splitext(os.path.basename(wav))[0]
        out_path = os.path.join(OUT_DIR, f"{slug}.json")
        if os.path.exists(out_path):
            print(f"[{i + 1}/{len(wavs)}] {slug} -- skip", flush=True)
            continue

        t0 = time.time()
        print(f"[{i + 1}/{len(wavs)}] {slug}...", flush=True)
        try:
            stems = separate(model, config, wav)
            stems_sorted = dict(sorted(stems.items(), key=lambda x: -x[1]["rms"]))
            result = {
                "slug": slug,
                "instruments_detected": len(stems_sorted),
                "instruments": stems_sorted,
                "time_s": round(time.time() - t0, 1),
            }
            with open(out_path, "w") as f:
                json.dump(result, f, indent=2)
            names = list(stems_sorted.keys())
            print(f"  {len(names)} instruments: {', '.join(names[:10])}", flush=True)
        except Exception as e:
            print(f"  FAIL: {e}", flush=True)
            import traceback

            traceback.print_exc()

        torch.cuda.empty_cache()

    print("MEGA53_DONE", flush=True)
