# GPU Extraction Pipeline

These scripts require a CUDA GPU (tested on NVIDIA L40S, 46GB VRAM).

## Pipeline Order

1. **`separate.py`** — MelBand-RoFormer vocal/instrumental separation
2. **`cascade.py`** — htdemucs_6s on instrumental → 6 stems total
3. **`deep_extract.py`** — per-stem feature extraction (librosa)
4. **`moss_extract.py`** — MOSS-Music-8B via SGLang server

## Environment Variables

| Variable     | Default                  | Description            |
| ------------ | ------------------------ | ---------------------- |
| `WAV_DIR`    | `work/wav`               | Input audio files      |
| `OUT_DIR`    | varies                   | Output directory       |
| `SGLANG_URL` | `http://localhost:30000` | SGLang server for MOSS |

## Dependencies

```
pip install mel-band-roformer demucs librosa requests torch
```

For MOSS, start SGLang server first:

```
python -m sglang.launch_server --model MOSS-Music-8B-Thinking --port 30000
```
