# GPUs — what they are for, and what they are not for

Two NVIDIA L40S, 48 GB each. **Owner: Amal. Reproducibility: Sebastian.**

## Week one needs no GPU at all

The whole pipeline runs on a laptop CPU. Beat tracking is a small network. Stem separation takes
a couple of minutes instead of twenty seconds. For six songs that is fine.

**Nothing this week is allowed to be blocked on GPU provisioning.** Set it up in the background,
between other things, and if it fights you, walk away and come back — the pipeline does not care.

## What the GPUs actually buy us in sixteen days

| | why it matters |
|---|---|
| **Speed** — 20 s a song instead of 3 min | matters the moment a stranger uploads a song to the 24-hour screen |
| **The vectors** — per-beat embeddings from an open music model | this is the AI-native claim. **Inference, not training.** An afternoon |
| **Batch analysis** — a 200-song fallback library | 20 minutes on GPU, 10 hours on CPU |
| **One honest training run** | so "we trained it on our own hardware" is literally true |

## The training run, scoped honestly

Do **not** attempt to fine-tune a large music model in sixteen days. The right shape:

> **Freeze the big model. Train a small head.**

Take the frozen embeddings as fixed input. Train a small moment-detector on the public annotated
sets plus our own truth files. Compare it against the rules baseline **on our own bench**.

A day's work on one card. Genuinely a trained model. Produces a number we can defend, and if
the number is worse than the rules, we say so and ship the rules — that is a result too.

## Setup, in order. Stop at any step that fights you and come back later.

1. **Find the machine.** Where are the two cards — a box in the office, a server, a cloud
   instance? How do we reach it? Who else uses it? Write the answer in `ENV.md`.
2. **`nvidia-smi` runs.** Note the driver version. Everything downstream keys off it.
3. **One environment, pinned.** Python 3.11 in a venv. Install the PyTorch build that matches
   the driver's CUDA — not the newest one, the matching one.
4. **Put the weights somewhere with space.** Set `HF_HOME` and `TORCH_HOME` to a disk with
   room, **outside this repo**. Model weights are gigabytes and the repo must never see them.
   *(Check free space first — the dev laptop is near full.)*
5. **Smoke-test each model alone before chaining any of them.** Stems on ten seconds of audio.
   Embeddings on ten seconds. Beat tracking on ten seconds. One at a time.
6. **Then chain them** into one command that writes a map.
7. **Write `ENV.md`** — exact versions of driver, CUDA, torch, and every model. Then hand it to
   Sebastian, who rebuilds the environment from that file on a different machine. If he cannot,
   the file is wrong, and we have one person's magic instead of an environment.

## Traps that have each cost somebody a day

| trap | what happens |
|---|---|
| driver / CUDA / torch mismatch | the classic. torch installs, sees no GPU, and says nothing useful |
| a model package pulls its own torch | your working install silently breaks. Install, then re-check `torch.cuda.is_available()` |
| old audio libraries vs modern Python | some beat-tracking packages fight current numpy. Isolate them in their own environment rather than bending the main one |
| weights cached into the repo or a full disk | gigabytes in the wrong place. Set the cache paths **first**, not after the first download |
| more than one decode path | two libraries opening audio differently gives timestamps that disagree by tens of milliseconds. **One tool, one sample rate, everywhere** |
