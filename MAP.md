# The map file — v0.3

What the music does. Never what a light should do: a drone show and a video editor read this same
file. The moment it says "strobe" it becomes a lighting file and the idea collapses.

One file per recording. `the-nights.map.json` is a real one, measured from a real mp3.

## Three tiers, and the difference between them is the whole design

| tier | what it holds | policy |
|---|---|---|
| **interface** | `grid` `beats` `downbeats` `chapters` `spans` `moments` `energy` `sections` | what readers compile against. Small, stable, human-correctable, **a one-way door.** Be miserly. |
| **observation** | `accents` `stems` `observations.*` | what was measured. Additive, append-only, nothing breaks by adding. **Be generous.** |
| **learned** | `vectors` | everything nobody has a word for |

The rule that governs the interface tier: **a field goes in when a reader breaks without it.** Not
when a fact is interesting. Twice now a field earned its place by that test — `accents`, because
71% of the drum hits in this song are off the beat grid and a reader asked to punctuate them
cannot get the times from `beats`; and `sections`, because two chapters both called `drop` were
indistinguishable, so no reader could make the second bigger than the first.

The rule that does **not** apply to the observation tier: completeness is the goal there, and the
minimalist rule was never about what to measure — it was about what to promise.

## Interface tier

| field | shape | notes |
|---|---|---|
| `grid` | `{period, phase, bpm, bar_phase, locked}` | 369 beats reproduce from `period` and `phase` alone. `bar_phase` says which beat is the "one" |
| `beats` `downbeats` | `[t, …]` seconds | downbeats are a subset of beats |
| `chapters` | `[{at, name}]` | plain names: intro, verse, break, build, drop, outro |
| `spans` | `[{kind, from, to, rise}]` | a stretch with a shape. `rise` is `steady` `late` `early` `stepped` |
| `moments` | `[{at, kind, …}]` | six kinds only: `build` `drop` `stop` `quiet` `spotlight` `return` |
| `energy` | `[[t, 0..1], …]` | one point per downbeat. **Readers interpolate between points** |
| `sections` | `[{at, id, repeat, arc, name}]` | which sections are the *same* section. `repeat` is what lets a reader escalate |
| `confidence_by_field` | per field | one global number could not say "9 ms sure of the period, a coin toss on the bar phase" |

## Observation tier

| field | rate | what |
|---|---|---|
| `accents` | events | every percussive hit: time, strength, which drum, and whether it is on the grid. **983 here, 71% off-grid** |
| `stems` | per downbeat | presence of vocals, drums, bass, other, guitar, piano |
| `observations.envelope` | per beat | per-stem level in dB below that stem's own 99th percentile |
| `observations.notes` | events | polyphonic transcription per stem. **3,863 here**, 98–99.9% diatonic to the detected key |
| `observations.melody` | per sixteenth | the vocal pitch contour |
| `observations.bass_notes` | per beat | monophonic root |
| `observations.chords` | per bar | with a confidence |
| `observations.key` | song | with the correlation that produced it |
| `observations.microtiming` | song | deviation from the grid the music is actually played on. This record is **1/16 quantised, 100% of hits inside 15 ms** |
| `observations.stereo` | per downbeat | width and pan, for the mix and every stem |
| `observations.brightness` | per downbeat | spectral centroid per stem. Texture, not level |
| `observations.lyrics` | word times | from the isolated vocal. **Times are good; words are not** — see the caveat in the file |
| `observations.vocal_silence` | spans | where the voice is absent. The cleanest structural signal in this song |

## Learned tier

```json
"vectors": { "model":"m-a-p/MERT-v1-95M", "rate":"per_beat", "rows":369, "dim":768,
             "dtype":"float16", "file":"the-nights.vec.f16" }
```

Out of line, because 369 × 768 float16 does not belong in JSON. Beat-aligned pooling makes it
tempo-invariant nearly for free: 126 bpm and 84 bpm give the same sequence length.

**It earned its place by correcting the named tier.** In the learned space the two sections I had
labelled as different drops score **0.951** — the same section. Re-clustering on the vectors
returns two identical passes of a six-part cycle with integer bar counts both times. That is
recorded as `segmentation_proposal`, not applied, because structure is a human's call.

## Provenance: the `how` field is the safety mechanism

`made_by.how` is the only thing standing between a measurement and a guess wearing its clothes,
so it is a closed set:

| `how` | what it means | may it be used as truth? |
|---|---|---|
| `truth` | a human, with the audio playing. See `truth/PROTOCOL.md` | yes, it is the authority |
| `synthetic` | **the times are causes, not observations** — audio was rendered from this map, so it is ground truth by construction | yes, within the limits below |
| `model` | a listener measured it from a recording | no, this is what gets graded |
| `hand-written` | a human typed times they believe | no |
| `sketch` | a guess, quarantined in `maps/sketch/`, confidence <= 0.5 | never |

`synthetic` is not a stronger `hand-written`, it is a different kind of claim. A hand-written map
asserts times a person believes; a synthetic map *defines* times that audio was then built to
match, and `synth/render.py` refuses to ship a render whose events sit more than 2 ms from what
the map declares. That is what makes it usable as ground truth, and it is also the limit: a
synthetic map can only test what we already know how to name, so it can never validate the
learned tier, and human ears stay the authority on everything else.

A map must not claim a fact its audio cannot support. `synth/cases/01-metronome.json` is
identical clicks with no accent, so the bar is unknowable from the signal and `downbeats` is
empty on purpose — a listener that reports downbeats there is inventing them, and the bench
counts it against them.

## Four rules

1. **Time is always seconds**, decimal, from the start. Never ms, bars, samples or frames.
2. **A reader ignores fields it does not recognise.** That is what lets the file grow.
3. **A field goes into the interface tier when a reader breaks without it.**
4. **One writer per fact.** Two lanes computing the same number will eventually disagree.

## What is deliberately absent

Lighting words. Hardware. Channels. Fixtures. Colours. Tempo, because it is in the beats. Those
live in `layouts/` and in the recipe, or nowhere.
