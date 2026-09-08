# musicstate

An audio file goes in, a **MAP v0.3 file** comes out. Self-contained: this folder
holds the whole pipeline and the end conversion, and writes nothing outside itself.

```
audio ─▶ pipeline (per-level analyzers) ─▶ MusicState ─▶ port ─▶ song.map.json
                                                             └▶ song.vec.f16
```

## Install & run

```bash
conda activate limelight-ms
cd musicstate
pip install -e .                 # exposes the `musicstate` command
# ...or run without installing:  PYTHONPATH=src python -m musicstate ...

musicstate build song.mp3 -o song.map.json     # full stack
musicstate build song.mp3 --core               # librosa only, no heavy models (~15s)
musicstate build song.mp3 -v                    # verbose per-analyzer logs
```

The `notes` layer uses **basic-pitch** via its ONNX backend (`pip install
'basic-pitch[onnx]' onnxruntime`, in the `deep` extra). basic-pitch pulls in
`resampy`, which imports `pkg_resources`, so the env also needs `setuptools<81`
— the same gotcha the allin1 env documents.

Every build logs each stage and prints a **time-usage report**; the per-stage
timings are also kept in the MusicState's `provenance.timing`. `--core` fills the
interface tier from librosa and leaves `stems`/`vectors`/`observations.semantic`
as `null` (unmeasured, never guessed).

## Layout

```
src/musicstate/
  cli.py              the `build` / `click` commands, logging + timing report
  config.py           signal constants, model ids, sibling-env resolution
  audio.py            audio file -> mono float32
  pipeline.py         orchestration: run analyzers, time each, assemble MusicState
  port.py             MusicState dict -> MAP v0.3 dict (pure; measures nothing)
  analyzers/
    base.py           the Analyzer contract
    dsp.py            L1  dense DSP frames (librosa)
    structure.py      L2  tempo/beats/downbeats/key/sections/events (librosa)
    chords.py         L2  per-bar chords, maj/min/dom7 chroma templates (librosa)
    melody.py         L2  per-sixteenth pyin f0 contour (librosa)
    allin1.py         L2  labelled segments + downbeats (allin1, separate env)
    stems.py          L2  per-stem presence (Demucs)
    semantic.py       L3  mood/danceability/voice/genre (Essentia, separate env)
    embedding.py      L4  per-beat MERT embeddings
    notes.py          L4  polyphonic note events (basic-pitch, ONNX backend)
    workers/          the scripts run inside the sibling envs
  schema/             the MusicState JSON schema
  tools/              click-track + tone/chord generators (test ground truth)
tests/                port unit tests + pipeline verification
```

## Analyzer sets

| set | analyzers | needs |
|---|---|---|
| **core** (`--core`) | dsp, structure, chords | `limelight-ms` only |
| **deep** (default) | + allin1, melody, stems, semantic, embedding, notes | all three envs |

Each deep analyzer degrades gracefully: if its env/deps are missing it is recorded
`not_available` in `provenance.analyzers` and skipped — the rest still produce a
valid map.

## The conversion (MusicState → MAP v0.3)

| map field | source |
|---|---|
| `grid` | period = 60/bpm, phase = first beat, bar_phase from downbeats |
| `beats` `downbeats` | allin1 (deep) or librosa (`--core`) |
| `chapters` `sections` | allin1 labelled segments, consecutive same-label runs merged; +id/repeat/arc |
| `moments` | events → the six kinds; a drop carries `confidence` and `size = confidence + 0.2` |
| `spans` | each build event paired with the next drop |
| `energy` | librosa, per downbeat |
| `stems` | Demucs per-downbeat presence, per-stem arrays + explicit guitar/piano zeros |
| `observations.semantic` | Essentia discogs-effnet (mood/danceability/voice/genre) |
| `observations.frames` | librosa dense stream (~43 Hz): rms, onset, low/mid/high |
| `observations.key` | key estimate + confidence |
| `observations.chords` | per-bar chord (maj/min/dom7 templates on chroma, median-smoothed); core |
| `observations.melody` | per-sixteenth pyin f0 contour, unvoiced=null; deep |
| `observations.notes` | polyphonic note events via basic-pitch (ONNX backend); deep |
| `vectors` | MERT per-beat embeddings (out-of-line file) |
| `confidence` | mean of `confidence_by_field` |

Verified byte-for-byte against the reference `levels.dheeraj.map.json`
(`tests/test_port.py`).

## Environments (deep stack)

The heavy backends conflict, so each has its own conda env, reached by subprocess:

| env | holds |
|---|---|
| `limelight-ms` | librosa, torch, Demucs, MERT — runs the pipeline & CLI |
| `limelight-ess` | essentia-tensorflow (L3) |
| `limelight-allin1` | torch 2.6 + natten + allin1 + madmom (L2 labelled structure) |

Overridable via `LIMELIGHT_ESS_PY`, `LIMELIGHT_ALLIN1_PY`, `LIMELIGHT_ESS_MODELS`.

## Test

```bash
PYTHONPATH=src python -m pytest -q          # port unit tests + click-track pipeline check
```
