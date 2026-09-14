# GPU Extraction Pipeline

These scripts require a CUDA GPU (tested on NVIDIA L40S, 46GB VRAM).

## Pipeline Order

1. **`separate.py`** — MelBand-RoFormer vocal/instrumental separation
2. **`cascade.py`** — htdemucs_6s on instrumental → 6 stems total
3. **`deep_extract.py`** — per-stem feature extraction (librosa)
4. **`moss_extract.py`** — MOSS-Music-8B via SGLang server
5. **`stems53.py`** — MVSep Mega 53-Stem BS-RoFormer instrument detection
6. **`beat_extract.py`** — Multi-tracker beat consensus (BeatNet + madmom + Beat This!)

## Environment Variables

| Variable      | Default                   | Description              |
| ------------- | ------------------------- | ------------------------ |
| `WAV_DIR`     | `work/wav`                | Input audio files        |
| `OUT_DIR`     | varies                    | Output directory         |
| `SGLANG_URL`  | `http://localhost:30000`  | SGLang server for MOSS   |
| `MSST_DIR`    | `~/proj/msst`             | MSST repo for 53-stem    |
| `MODEL_PATH`  | `work/mega53/model.ckpt`  | 53-stem model checkpoint |
| `CONFIG_PATH` | `work/mega53/config.yaml` | 53-stem model config     |

## Dependencies

```
pip install mel-band-roformer demucs librosa requests torch
pip install BeatNet madmom beat_this ml-collections pyyaml soundfile
```

For MOSS, start SGLang server first:

```
python -m sglang.launch_server --model MOSS-Music-8B-Thinking --port 30000
```

For 53-stem, clone MSST repo:

```
git clone https://github.com/ZFTurbo/Music-Source-Separation-Training ~/proj/msst
```
