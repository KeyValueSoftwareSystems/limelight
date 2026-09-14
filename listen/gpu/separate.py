import os, sys, time, glob, warnings

warnings.filterwarnings("ignore")
os.environ.setdefault("HF_HOME", os.path.expanduser("~/proj/hf"))

import torch

print(
    f"GPU: {torch.cuda.get_device_name(0)}, VRAM: {torch.cuda.get_device_properties(0).total_mem / 1e9:.1f} GB",
    flush=True,
)

from mel_band_roformer import MelBandRoformer

WAV_DIR = os.environ.get("WAV_DIR", "work/wav")
OUT_DIR = os.environ.get("OUT_DIR", "work/stems-roformer")
os.makedirs(OUT_DIR, exist_ok=True)

print("Loading MelBand-RoFormer...", flush=True)
separator = MelBandRoformer(device="cuda")
print("Model loaded on GPU", flush=True)

wavs = sorted(glob.glob(os.path.join(WAV_DIR, "*.wav")))
print(f"Found {len(wavs)} songs", flush=True)

for i, wav in enumerate(wavs):
    slug = os.path.splitext(os.path.basename(wav))[0]
    slug_dir = os.path.join(OUT_DIR, slug)
    voc_path = os.path.join(slug_dir, "vocals.wav")
    inst_path = os.path.join(slug_dir, "instrumental.wav")
    if os.path.exists(voc_path) and os.path.exists(inst_path):
        print(f"[{i + 1}/{len(wavs)}] {slug} — skip", flush=True)
        continue
    t0 = time.time()
    print(f"[{i + 1}/{len(wavs)}] {slug} — separating...", flush=True)
    try:
        os.makedirs(slug_dir, exist_ok=True)
        separator.separate(input_path=wav, output_dir=slug_dir)
        produced = os.listdir(slug_dir)
        print(f"  done in {time.time() - t0:.0f}s -> {produced}", flush=True)
    except Exception as e:
        print(f"  FAILED: {e}", flush=True)
        import traceback

        traceback.print_exc()
    torch.cuda.empty_cache()

print("SEPARATION_DONE", flush=True)
