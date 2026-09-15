# GPU Score Pipeline

Unified pipeline that extracts everything from a WAV file into a `.score` file.
Tested on NVIDIA L40S (46GB VRAM), Python 3.12.

## What it extracts

| Phase            | Tool                | Data                                                       |
| ---------------- | ------------------- | ---------------------------------------------------------- |
| 1 (CPU parallel) | madmom              | beats, downbeats, BPM, grid                                |
| 1 (CPU parallel) | basic-pitch         | melody notes (pitch, velocity, timing)                     |
| 1 (CPU parallel) | librosa             | rhythm onsets + intensity                                  |
| 2 (GPU)          | BS-RoFormer 53-stem | instrument presence + temporal RMS heatmap                 |
| 2 (GPU)          | BTC Transformer     | chord progression with timestamps                          |
| 3 (GPU, SGLang)  | MOSS-Music-8B       | sections, moments, emotion arc, caption, lyrics, key/tempo |

GPU memory is managed automatically — SGLang is stopped before loading stem/chord models, then restarted for MOSS queries.

## Setup

```bash
python3 -m venv venv && source venv/bin/activate
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements-gpu.txt

git clone https://github.com/ZFTurbo/Music-Source-Separation-Training msst
git clone https://github.com/OpenMOSS/MOSS-Music moss-code
cd moss-code/sglang/python && pip install -e . && cd ../../..
```

Download models into the same dir as pipeline.py:

- `moss/` — MOSS-Music-8B-Instruct weights + chat_template.jinja
- `mega53/model.ckpt` — MVSep Mega 53-Stem BS-RoFormer checkpoint
- `mega53/config.yaml` — MVSep Mega 53-Stem config

Place WAV files in `wav/`.

## Run

```bash
export SGLANG_DISABLE_CUDNN_CHECK=1
python -m sglang.launch_server \
  --model-path moss \
  --host 0.0.0.0 --port 30000 --tp 1 \
  --chat-template moss/chat_template.jinja \
  --trust-remote-code &

python pipeline.py wav/afterglow.wav
python pipeline.py wav/
```

Output goes to `score-out/*.score`.

## Environment Variables

| Variable                     | Default                  | Description                      |
| ---------------------------- | ------------------------ | -------------------------------- |
| `SGLANG_URL`                 | `http://localhost:30000` | SGLang server URL                |
| `BASIC_PITCH_MODEL_TYPE`     | `onnx`                   | basic-pitch backend              |
| `SGLANG_DISABLE_CUDNN_CHECK` | —                        | Set to `1` to bypass CuDNN check |

## Legacy

The individual scripts (`separate.py`, `cascade.py`, `deep_extract.py`, etc.) are superseded by `pipeline.py`.
