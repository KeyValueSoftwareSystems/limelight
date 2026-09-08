# listen → musicstate pipeline: full-parity port

**Status:** design, 2026-09-08. Branch `listen-pipeline-parity` off `main`.
**Owner of record:** the `audio → map` lane (Amal); this design is driven by Dheeraj.

## Why

`listen/` and `musicstate-generator/` do the same job — a real song in, a MAP v0.3
file out — but they diverged. `musicstate-generator` (the "dedicated clearer
pipeline") was verified byte-for-byte against `levels.dheeraj.map.json` at its fork
point and has barely changed since; `listen/` has since grown a burst of newer,
better analysis (drop placement, bar-line phase, accent correction, sidechain,
stereo, a trained chord model, per-stem pitch). This design brings `listen/`'s
newer behaviour into the pipeline **while keeping the pipeline's conventions** — so
the result is one clean codebase, not two that disagree.

## The governing difference (why no port is a copy-paste)

`listen/`'s tools are **post-hoc map editors**: each loads an already-written
`*.map.json` (plus the wav, or stems pre-separated on disk), mutates the map in
place, and appends a `corrections`/provenance block. The pipeline is a **forward
single pass**: analyzers see `audio + ctx` and return *patches*; `port.to_map`
reshapes the folded state **purely** (it measures nothing). So every ported feature
re-homes into exactly one of:

- **(A) a new `Analyzer`** — when it *measures the audio* (has `audio + ctx`, runs
  before `port`), or
- **(B) a new pure step in `port.py`** — when it is only arithmetic on already-measured
  state (e.g. musical position from the grid).

A feature is **never** ported as a map rewrite. This is the approved "Approach A".

## Conventions every slice obeys (non-negotiable)

Read from the current pipeline and treated as the contract:

1. **The `Analyzer` base** (`analyzers/base.py`): declare `name` + `level`
   (`"L1".."L4"`); override `available() -> (bool, why)` to degrade gracefully;
   return an `AnalyzerResult(status, patch, confidence, ctx, notes)` from
   `analyze(audio, sample_rate, ctx)`. `patch` is merged into the MusicState;
   `confidence` is per-field 0..1; `ctx` is handed to later analyzers.
2. **Registration** (`pipeline.py`): add the class to `analyzers/__init__.py`
   `__all__`, import it in `pipeline.py`, and place it in `core_analyzers()` and/or
   `deep_analyzers()` in dependency order. `_merge` **replaces** every key except
   `events` (extended, then sorted) and `meta_partial` (non-null update) — so an
   analyzer that refines `beats`/`downbeats`/`events` must be the last writer of
   that key, or write a fresh key.
3. **`port.py` stays pure** — dict in, dict out, measures nothing. Enrichment lands
   as **append-only `observations.*`**. The six-kind `moments` door
   (`build/drop/stop/quiet/spotlight/return`) is sacred — nothing new goes through it.
4. **`config.py` holds constants** — signal constants, model ids, thresholds, and
   sibling-env resolution. No tuning number inline in an analyzer.
5. **One writer per fact** (repo rule #8). If a new analyzer supersedes an old
   estimate of the same field, it records that it superseded, and only one of them
   writes the field.
6. **Never fill a field you did not measure** (repo rule #2). Unvoiced/absent stays
   `null`, not a guess.
7. **Tests** (`tests/`): `test_port.py` is pure (hand-built `STATE` → `to_map` →
   shape assertions); `test_pipeline.py` runs `build()` on a synthesized click track
   through `core_analyzers()` and validates against `schema/musicstate.schema.json`.
   Every new interface field gets a schema entry and a port assertion; every new
   analyzer gets a click-track-level check and, where it has real logic, a unit test
   on a synthetic signal with a known answer.

## Decomposition — the whole thing, in dependency order

Two tracks. **Track A is mix-only and fully verifiable with the `limelight-ms`
core env.** Track B depends on separated stem *waveforms* and, for slice 6, an
external GPU model — implemented to convention here, but end-to-end runs may need
the heavy envs/GPU that this workstation may not have (flagged per slice).

Each slice is its own implementation unit: this spec covers the roadmap for all six
and **Slice 1 in full**; slices 2–6 get a short design addendum to this file when we
reach them, then their own plan.

### Track A — mix-only (build first)

| # | Slice | listen source | Pipeline home | Effort |
|---|---|---|---|---|
| 1 | **Placement** — moment derivation → bar-line phase → drop/stop re-timing → `pos`/groove | `barphase.py`, `moments.py`, `beatpos.py` | 3 new L2 analyzers + pure `pos` step in `port.py` | M |
| 2 | **Pump / sidechain** | `pump.py` | 1 new analyzer → `observations.pump` | M |
| 3 | **Stereo** width/pan | `stereo.py` | 1 new analyzer (decodes the stereo source) → `observations.stereo` | M |

### Track B — stem-dependent (after the stems enabler)

| # | Slice | listen source | Pipeline home | Effort |
|---|---|---|---|---|
| 4 | **Stems enabler** + grid-refine + accent-attack | `regrid.py`, `attack.py` | expose Demucs waveforms to downstream; 1 refine analyzer + attack step in `accents` | M–L |
| 5 | **Per-stem pitch & shape** — `bass_notes`, brightness, envelope, per-stem notes | `stempitch.py`, `stemshape.py`, `notes.py` | extend `notes.py`; new `observations.*` | M–L |
| 6 | **Chords upgrade** — stem-chords (uses `bass_notes`), then trained ChordMini | `stemchords.py`, `chordmini.py` | stem-chroma into `chords`; ChordMini as a sibling-env worker | M / L |

**Explicitly out of scope** (not parity — the *inputs* don't exist in either repo):
`derive.py` phrase derivation needs Whisper lyrics and a novelty curve that neither
codebase produces. Parked as future analysis, not part of this port.

**Dependency edges that set the order:**
- Slice 1: bar-phase (1b) must run before moment re-timing (1a) — the half-bar prior
  reads a trustworthy `grid.bar_phase`. Both are mix-only.
- Slice 4 (stems enabler) unblocks the stem parts of grid-refine, attack, per-stem
  pitch (5), and stem-chords (6). It comes first in Track B.
- Slice 5 produces `bass_notes`, the root prior slice 6's stem-chords needs.

## Slice 1 — Placement (full design)

**Goal:** the pipeline should place drops/stops where the *record* puts them (on the
bar or the half-bar, at the measured loudness step) rather than snapping them to the
nearest downbeat, on a bar-line phase measured from the kick rather than assumed.

### New components

**`analyzers/bar_phase.py :: BarPhaseAnalyzer` (L2, runs after `StructureAnalyzer`
/ `Allin1Analyzer`).**
- *Input (from `ctx`/state):* `beats`, `downbeats`, per-beat/dense energy, and the
  audio (for a low-band energy read).
- *Algorithm (from `barphase.py`):* try whole-grid downbeat shifts `k ∈ [-3..3]`; for
  each, score **low-band energy on the claimed bar-lines vs. the other beats** (a
  small kick-band-on-downbeats metric — the pipeline has no `mapeval`, so port a
  self-contained scorer). Pick the shift that maximises bar-line energy while not
  degrading section/label agreement. It explicitly does **not** trust the circular
  "chapters agree with the bar line" check, because chapters were *built* at the
  current phase.
- *Output:* adjusted `downbeats` (and the `bar_phase`/phase the grid derives), plus
  `observations.bar_phase_decision` — the chosen shift, the score, and a `dissent`
  note where kick evidence and chord-change evidence disagree by a half bar.
- *Moments are left untouched here* — they are re-timed independently in the next
  analyzer, so a phase shift never drags a measured drop off its step.
- *Degrade:* no usable low-band evidence → keep the incoming phase, low confidence,
  `status="not_computed"`. **When allin1 supplied downbeats, they are a strong prior:**
  BarPhase overrides the phase only if the low-band evidence beats allin1's phase by a
  configured margin, and always records the decision. *(Decided 2026-09-08.)*

**`analyzers/moment_derive.py :: MomentDeriveAnalyzer` (L2, runs after
`BarPhaseAnalyzer`).** *(Relocated out of `port._derive_moments` — decided 2026-09-08.)*
- *Input:* the merged `sections`/labels and per-section `energy` from structure/allin1.
- *Algorithm:* the label/energy heuristics `port._derive_moments` used to run — a
  chapter that names a drop, and an energy jump past a threshold, become candidate
  `drop`/`quiet` events. Pure derivation on the section/beat grid; it invents no times
  of its own.
- *Output:* candidate `drop`/`stop`/`quiet` events, handed on for re-timing.
- *Degrade:* no sections/energy → no candidates, `status="not_computed"`.

**`analyzers/moment_timing.py :: MomentTimingAnalyzer` (L2, runs after
`MomentDeriveAnalyzer`).**
- *Input:* the candidate `drop`/`stop` events (from `MomentDeriveAnalyzer`), `beats`,
  `downbeats`/`bar_phase`, energy, audio; optionally the accents (for the witness).
- *Algorithm (from `moments.py`):* for each drop/stop, search ±8 beats around the
  candidate time and pick the beat carrying the biggest **sustained loudness step** —
  the *median* step across four shoulders (0.5/1.0/1.5/2.0 s) so a post-drop silence
  can't fool one window. A **half-bar prior** constrains the pick to even-beat
  (half-bar) positions, but an off-metre beat may win if its step beats the best
  on-metre step by more than 20% (`config` constant). The naming chapter **moves with
  the moment** (within `period*0.75`); duplicates re-timed onto one beat are merged.
  A drum-density "witness" is computed and recorded but gets **no vote** (listen
  measured that letting it vote makes results worse).
- *Output:* the re-timed `events`, plus `observations.moment_timing` (per moment: the
  original time, the chosen time, the winning step, the witness, whether the half-bar
  prior was overridden).
- *Degrade:* no drops/stops → clean no-op, `status="not_computed"`.

### `port.py` changes

- **Moment derivation and snapping both leave `port`.** `_derive_moments` and
  `_snap_down` are removed: `MomentDeriveAnalyzer` produces the candidates and
  `MomentTimingAnalyzer` re-times them, so `port` only *reshapes* the finished `events`
  into the six-kind `moments` door. `port` now measures nothing about moments — the
  purity stretch the old `_derive_moments` represented is gone.
- **Add the pure `pos` field (Approach B):** every timed map entry gains
  `pos = (t - phase) / period` (beats from grid origin), and bar/beat derive from
  `pos` + `bar_phase`. This is arithmetic on the finished grid — it stays in `port`.
- **Add `observations.groove`:** per-hit `off16` (sixteenth-swing bias), lifted from
  the same grid math (append-only observation).

### Schema & config

- `schema/musicstate.schema.json`: add `pos` (number, on timed entries) and the three
  append-only observation blocks (`bar_phase_decision`, `moment_timing`, `groove`).
- `config.py`: `MOMENT_SEARCH_BEATS = 8`, `HALF_BAR_OVERRIDE = 1.20`,
  `STEP_SHOULDERS_S = (0.5, 1.0, 1.5, 2.0)`, `CHAPTER_FOLLOW = 0.75` (× period),
  `BAR_PHASE_SHIFTS = range(-3, 4)`, an allin1-prior margin — names final at
  implementation, but the values live here, not inline.

### Data flow

```
audio ─▶ dsp ─▶ structure ─▶ [allin1] ─▶ BarPhase ─▶ MomentDerive ─▶ MomentTiming ─▶ … ─▶ port
                                            │              │               │          (pos, groove;
                                     downbeats/phase   candidate drops   re-timed      no derive,
                                     + decision        (label/energy)    drop/stop      no snap)
                                                                             │
                                                                             ▼
                                                                  observations.moment_timing
```

### Testing

- **Unit (new):** the sustained-step detector on a synthetic RMS envelope with a
  known step (asserts it finds the step beat and rejects a silence-gap decoy); the
  bar-phase scorer on a synthetic low-band signal with a known kick phase.
- **`test_port.py`:** feed a hand-built state whose `events` are already the final
  drop/stop times; assert `port` reshapes them into `moments` **without** deriving or
  snapping (times preserved); assert `pos` and `observations.groove` are present and
  correct; six-kind filtering unchanged. Add a unit test that `MomentDeriveAnalyzer`
  turns a labelled-drop chapter and an energy jump into the expected candidates.
- **`test_pipeline.py`:** the click-track build stays green; both new analyzers
  degrade cleanly on the click track (which has no drops), recorded as
  `not_computed`, schema still valid.
- **Integration (env-permitting):** run on `levels` and compare the re-timed drops to
  `listen/`'s own `observations.moment_timing` as an oracle — they should agree.

### Consequence to call out

Re-timing **changes map output**: drop/stop times move off the downbeat grid. The
"verified byte-for-byte against `levels.dheeraj.map.json`" guarantee therefore no
longer holds *for moment times* — the reference expectation must be **updated to the
corrected placement** (and the diff reviewed as evidence the change is right), not
treated as a regression. This is expected and is the point of the slice.

### Decisions (resolved 2026-09-08)

1. **allin1 downbeats vs. BarPhase precedence — allin1 is a strong prior.** When
   allin1 supplied downbeats, BarPhase overrides the phase only if the low-band kick
   evidence beats allin1's phase by a configured margin, and always records the
   decision in `observations.bar_phase_decision`.
2. **Moment derivation — relocated out of `port`.** A new `MomentDeriveAnalyzer`
   produces the candidate drops/quiets from labels + energy; `port` no longer derives
   or snaps moments and reshapes only. This widens Slice 1 by one analyzer and makes
   `port` fully pure for moments.

## Slices 2–6 — roadmap (each gets its own design addendum + plan)

- **2 Pump:** new `PumpAnalyzer` (mix-only, stdlib). Fold the >250 Hz envelope over
  the beat grid; the sign of the slope from 18%→72% of the beat separates a
  sidechained mix (rises) from an un-sidechained one (decays). Write
  `observations.pump` (depth, per-chapter presence, folded shape, release point);
  `port` lifts it. Calibrated to read negative on additive-synthesis songs.
- **3 Stereo:** new `StereoAnalyzer` that decodes the **original stereo source**
  (the pipeline loads mono), computes per-downbeat mid/side width and L/R pan, flags
  an effectively-mono source rather than inventing width. Write `observations.stereo`.
- **4 Stems enabler + regrid + attack:** expose the Demucs separated waveforms from
  `stems.py` to downstream analyzers (today it keeps only per-downbeat presence);
  then grid-refine on the drums stem (`regrid.py`) and move each accent to its own
  measured attack (`attack.py`, zero-phase filter, ≤30 ms correction).
- **5 Per-stem pitch & shape:** feed per-stem audio into `notes.py`; add `bass_notes`
  and vocal note events (`stempitch.py`, autocorrelation f0 + octave correction) and
  per-stem brightness/envelope (`stemshape.py`).
- **6 Chords upgrade:** stem-chroma quality on separated harmonic stems with the
  `bass_notes` root prior (`stemchords.py`), then the trained **ChordMini** model as
  a sibling-env subprocess worker (external repo + checkpoint + GPU) following the
  `allin1`/`stems` worker pattern.

## Risks

- **Track B verifiability:** slices 4–6 need the deep conda envs and (slice 6) a GPU
  and an external model repo; those may not run on this workstation. They will be
  built to convention and unit-tested, but end-to-end validation may fall to the
  owner's environment.
- **Stems-waveform exposure (slice 4)** is a small pipeline refactor (in-memory vs.
  on-disk hand-off) that several later slices depend on — get its interface right once.
- **Schema discipline:** each new field must land in the schema and honour
  one-writer-per-fact and the six-kind moments door.

## Verification (overall)

Per slice, before it is called done:
`conda activate limelight-ms && cd musicstate-generator && PYTHONPATH=src python -m pytest -q`
green, plus the slice's own unit tests, plus (env-permitting) a real-song run diffed
against `listen/`'s output as the oracle.
