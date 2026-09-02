# The two L40S

48 GB each. Here is the honest accounting of what they are for.

## Week one does not need them

The whole first pipeline — stem separation, beat tracking, chroma, a self-similarity matrix,
writing a map — runs on a laptop CPU in minutes per song. If you find yourself blocked on GPU
access in the first four days, something has gone wrong with the plan, not with the hardware.

Start on the laptop. Move when a wait becomes annoying, not before.

## What the cards actually buy

1. **Speed on inference.** Demucs and a neural beat tracker are minutes on CPU and seconds on a
   card. This matters when you are iterating on twenty songs, not one.
2. **The vectors.** Running MERT over a catalogue to produce per-beat embeddings is an afternoon
   on one card and a week on a laptop. This is the clearest win.
3. **Batch analysis.** Forty songs overnight, so that the bench has a population to talk about
   instead of an anecdote.
4. **One honest training run**, scoped as below.

## The training run, scoped so it can finish

**Freeze the big model. Train a small head.**

Take a pretrained music encoder (MERT is the obvious starting point — a BERT for music, 95M and
330M variants), freeze it, and train a small head on top that predicts the fields we need:
boundary probability per beat, span onset and shape, energy. That is a few million parameters on
pooled features, not a foundation model, and it fits comfortably in an afternoon on one card
with room to try several variants.

Do **not** attempt to pretrain an audio encoder from scratch. It does not fit in sixteen days and
it is not where the value is; the value is in the head, the labels, and the corrections.

**Beat-aligned pooling** is the detail worth getting right: pool encoder features between
consecutive beats rather than on a fixed time grid. A model trained that way is tempo-invariant
almost for free, because 126 BPM and 84 BPM produce the same sequence length.

## Setting up, in order

1. Find the machine and confirm you can reach it. `nvidia-smi` — note driver and CUDA version.
2. **One pinned environment.** Install torch matching that CUDA version *first*, then everything
   else, then check `torch.cuda.is_available()` before installing another package.
3. `export HF_HOME=/some/big/disk/hf` and `TORCH_HOME` likewise, **outside the repo**. Check free
   space first; weights are tens of gigabytes and a full disk mid-download fails in confusing ways.
4. Smoke-test each model **alone** before chaining any of them. One line of audio in, tensor out.
5. Then chain them. Then write down exactly what you installed in `ENV.md`, because you will need
   to reproduce it on the second card and nobody remembers.

## Five traps

- **Driver, CUDA and torch mismatch.** The error message will not say this. Check all three first.
- **A package that pulls its own torch** and silently replaces the working one. Pin it, then
  re-check `torch.cuda.is_available()` after every install.
- **Old audio libraries** that cannot decode what you feed them, failing as a shape error three
  functions later rather than at the decode.
- **Weights cached in the wrong place** — inside the repo, or on a disk that fills.
- **More than one decode path.** If librosa and torchaudio load the same file at different sample
  rates or with different resampling, your timestamps disagree with themselves and you will spend
  a day on it. Pick one loader, one sample rate, and write it down.
