# Music intelligence → creative media

**Supersedes `Music_Intelligence_Creative_Media_Spec.md`.** That document was
written before anyone read the repository, and about a fifth of it describes
architecture that already existed. This one is written after building the thing,
so where the two disagree, this one has the measurements.

Date: 2026-09-10. KeyCode is 2026-09-18.

---

## 1. What this project actually is

**A file that says what a song does, and readers that turn it into time-based
art.** That is not a new claim made by this document; it is what
`readers/lights/FRAME.md` line 3 has said all along:

> This format belongs to the lighting reader only. It is not universal. A
> video-edit reader outputs cut points, a rhythm game outputs a note chart. The
> universal artifact is the *map*, which knows nothing about output devices.

So the pivot to video was much smaller than the original spec assumed. There
was no representation to invent. There was a third reader to write, and writing
it was the first genuine test of whether the map is universal or is a lighting
format wearing a neutral name.

```
                 recording
                     |
              listen/  (audio -> map)
                     |
              the map  ---------- the product
                     |
     +---------------+---------------+
     |               |               |
  lights          drones           video
  FRAME.md                        IR.md
     |               |               |
   DMX            positions        an mp4
```

## 2. What the original spec got right

Most of it, and the important parts:

- Never manufacture a measured number with an LLM.
- Never evaluate a field against a dependent output.
- HOLD — deliberate inactivity — is a real creative decision, not missing data.
- Events, spans and intervals, not one fixed grid.
- Provenance must reach the creative output.
- Uncertainty must survive into creative reasoning.
- Run independent models blind.

None of that is revised. It is the standard the work below is held to.

## 3. What it got wrong, and what replaced it

### 3.1 The "Universal Creative IR" — refused

The spec proposed map → creative intent → *universal* creative IR → video IR +
lighting IR. That middle layer is not built and should not be.

An `IMPACT` that means "cut" for video and "cue" for lights is a shared
**vocabulary**, not a shared artifact. A third file both readers translate
through costs a layer, costs a synchronisation, and carries no information the
map does not already have. The spec's own §30 concedes that lighting
independently owns its spans, events, holds and zones. Rule 8 settles it: one
writer per fact.

What exists instead: two reader-specific contracts, `FRAME.md` and `IR.md`, both
descending from the map directly.

### 3.2 The evaluation plan was circular — replaced

§36 proposed scoring "cuts near salient events" and "major visual changes near
major musical events". The policy *placed* those cuts by reading those events.
Both sides share not merely a feature family but the actual numbers. It would
score near 1.00 on any edit the repo can produce, including a bad one — the same
shape as the 9 ms beat-grid agreement that opens `AGENTS.md`.

What exists instead: `bench/cutscore.py` reads **only the rendered mp4**. It
detects cuts by frame differencing the output and onsets by spectral flux on
that same file's audio. It never opens the map, the IR, the index or a policy.

### 3.3 Taste as twenty knobs — replaced by data

§11 says "do NOT reduce taste to four scalar knobs" and then lists about twenty.
Higher-dimensional guessing is still guessing.

What exists instead: `briefs/*.json`. Taste is a file, the way a layout is a
file for lighting. Three briefs that contradict each other on purpose, so that a
policy silently ignoring the brief is visible. The test is that the same song
and the same footage must produce materially different edits.

### 3.4 The order of work — inverted

§42 puts a written audit and a blind MOSS experiment before the vertical slice.
Most of that audit already exists as running code (`bench/map-audit.py`,
`listen/unmeasured.py`, the corrections log), and the MOSS identity experiment
chases a number that changed on 8 September. The wire came first, and it is what
found the real problems.

### 3.5 Stale numbers

The spec cites a 0.807 mean over 16 checks and identity at 0.02. The mean was
0.818 at last run and identity has had a cannot-answer state since 8 September.

---

## 4. What was built

```
assets/fetch.py        90 CC clips, each with source, licence, sha256
assets/make-clips.py   clips rendered FROM an answer sheet
assets/index.py        shots, cuts, camera vs subject motion, light, faces
briefs/*.json          taste as data
readers/video/IR.md    the contract
readers/video/policy_naive.js    beat -> cut. The thing to beat
readers/video/policy_random.js   the null: same pacing, no music
readers/video/policy_rules.js    a budget spent over ranked musical events
readers/video/policy_llm.js      executes a committed intent.json
readers/video/intent.py          asks a model for intent; refuses most replies
readers/video/compile.py         IR -> mp4. Frame-exact. No creative choices
bench/cutscore.py      grades the rendered file, nothing else
bench/verdict.py       blind A/B/C; a person is the authority
bench/salience-check.py  the check that failed, kept because it failed
tools/mkheldout.py     12 full-length CC tracks nobody here has tuned on
```

### 4.1 The four policies, and why the boring ones matter

`random` is the one that would be deleted first and must not be. `rules`
beating `naive` proves very little — `naive` is bad in an obvious way. `rules`
beating a null edit with the *same shot-length distribution* is the claim worth
making.

### 4.2 Where the LLM sits

At interpretation, and nowhere else. It receives measurements it did not make
and replies with **indices into a candidate list**, never timestamps. A model
that can type `cut at 93.6` can type `cut at 94.1`, and nothing in the file
would show which was measured.

Its output is committed as `intent.json` and the compiler is deterministic from
there. The LLM is a build-time author, not a runtime component — otherwise
`frame = f(map, layout, recipe, t)` stops holding for this lane.

Nothing it returns is trusted: indices must exist, budgets must hold, holds must
not overlap. A failing reply is **refused, not repaired** — repairing it would
make the failure invisible next time.

---

## 5. What the checks found

### 5.1 Four bugs in my own test harness

`assets/index.py --check` grades shot detection and motion against clips
rendered from their own answer sheet. It found four bugs, and **every one was in
the test rather than the detector**:

1. a flat background — the only structure in frame was the subject
2. vertical stripes — no corners, so `goodFeaturesToTrack` selected none
3. a flat-coloured subject — no interior corners, only an untrackable rim
4. a sign error that made a "stationary" subject cross at twice the pan speed

Each time the detector reported the subject's speed as the camera's, and each
time the honest reading was that the question was unanswerable as posed. Phase
correlation was replaced with the median of many tracked points plus a
forward-backward check.

**If a measurement disagrees with `TRUTH.json`, suspect `TRUTH.json` first.**

### 5.2 Salience is derivable, and uncorroborated

The intended headline map addition was `observations.salience`. It is not in the
map, and that is the correct outcome: per-bar energy, per-bar novelty and
per-bar stem levels are all already in the file, so a reader computes it with
arithmetic. Rule 3. It lives in `derive.js`.

It also has **no discriminating check**. The obvious one — do `moments` score
higher than ordinary bars — is worthless, because moments are placed by a
loudness step and drum hits from stems, which is what salience is made of. The
independent witness available is ChordMini's harmony, and it fails to
discriminate: 0 of 4 songs clear the 95th percentile, and Levels is strongly
negative. That is the genre, not the field — EDM sustains one chord under the
drop, so the bars where harmony does *not* move are the loudest bars.

Ships at zero weight under rule 5 as amended, with every cut recording
`salience_is` so the dependency stays visible.

### 5.3 The compiler was sliding the edit off the music

Segments were cut with `-t <seconds>`, which rounds up to a whole frame. Rounding
the same direction 38 times put the last cut of a 237-second edit **717 ms
late**; the naive edit, with more shots, ended up seconds out. A second copy of
the bug sat at the mux, where `-t <song length>` re-truncated a frame-exact
video.

Boundaries are now quantised to the output frame grid once, each segment is
rendered with an exact frame **count**, and the compiler **refuses its own
output** if the total drifts by more than one frame. It caught itself twice
while this was being fixed.

### 5.4 The ruler was bent twice, and both bends flattered nobody

**A 92 ms lag in the onset detector.** `flux[i]` is the change between two
overlapping 80 ms windows, and a click first disturbs a window that *starts*
before the click. Labelling the peak `i/RATE` reported every onset about 90 ms
early. With no correction, cuts placed exactly on beats scored a hit rate of
**0.000**, and every policy — including the beat-cut baseline — came out below
its own null. I first guessed the sign from the window arithmetic and got it
backwards; the value is now measured by `--selftest`, which renders clicks at
times the file chose. 48 of 48 matched, median error −2 ms.

**The full spectrum is the wrong band for dance music.** On Levels, flux at the
exact instant of a beat sits at the 7th percentile of the song, while 40 ms
either side sits near the 50th — the flux is at a local *minimum* on the beat.
That is sidechain compression: the mix ducks on the kick and swells after it, so
positive flux peaks land *between* beats.

The map already knew. `observations.pump`, written by `listen/pump.py` from the
envelope above 250 Hz and sharing no code with the scorer, measures the release
at 0.39 of a beat — **182 ms** after the kick at 128 bpm. Measuring beats
against flux peaks put the best offset at **+100 to +140 ms**. Two unrelated
methods, the same displacement.

So the gate reads the **low band**, where the kick lives and the pump does not
reach. Not a tuned choice: the pump is applied to everything above the kick by
construction.

### 5.5 Two dead metrics, kept as warnings

- Correlating the whole visual-change curve against onset strength: motion
  *inside* shots swamps the cuts, every edit scored |r| < 0.04, the ranking was
  noise.
- Distance from a cut to the nearest onset peak: with peaks every 0.24 s every
  instant is a near miss, and a musical edit, a random edit and a beat-cut edit
  all read exactly 80 ms — the frame resolution.

Replaced by a hit rate at a fixed tolerance, with a refractory period on peak
picking so peaks can be no denser than one beat at 200 bpm.

### 5.6 Roughly half the "intelligent" cuts have no musical reason

Because the IR records *why* each cut exists, this is visible rather than
flattering. For `premium-restraint` on Levels, 17 of 37 cuts came from
`max_shot_s` hitting a timer. The brief asks for more cuts than the music offers
reasons for. The labels distinguish a cut forced by the brief from one forced by
the footage, because those are different claims.

---

## 6. Held-out music

The five recordings in `synth/maps/amal` had the scorer, the weights and half
the fields designed while somebody was looking at them. Every number reported on
those five is a number reported on its own training set.

`tools/mkheldout.py` fetches 12 full-length CC-licensed recordings from
archive.org netlabels. **Held out means enforceable**: no threshold, weight,
tolerance or feature may be changed after seeing how they score. Bugs may be
fixed; constants may not be tuned.

Licences are restricted to those permitting derivative works. That is not
paperwork — a video cut to a track is a synchronised audiovisual derivative, so
a NoDerivatives track cannot lawfully be used for the one thing we want it for.
ND is excluded by construction.

---

## 7. Status, honestly

| claim | status |
|---|---|
| the map drives a second art form | **shown** — video renders from the same file, unmodified |
| a brief changes the edit | **shown** — three briefs, materially different edits |
| the system can deliberately do nothing | **shown** — holds are emitted, and honoured |
| every creative action is traceable | **shown** — `because` on every entry |
| the compiler is deterministic and exact | **shown** — 0 ms drift, refuses otherwise |
| the edits are synchronised to the music | **shown** — see the table below |
| the intelligent edit is *better* | **unsupported** — no human verdict recorded yet |

### Measured, Levels / premium-restraint, low band

All four edits use the same song, the same 90 clips, the same brief and the same
chooser. `hit` is the share of cuts landing within 80 ms of a kick onset; the
null rotates each edit's own cut times, preserving count and spacing.

| policy | hit | null | z | energy@cut | null | z |
|---|---|---|---|---|---|---|
| naive  | 0.585 | 0.267 | 1.71 | 35.8% | 51.1% | −1.19 |
| rules  | 0.568 | 0.263 | 1.51 | **56.9%** | 51.0% | **+0.42** |
| llm    | 0.524 | 0.268 | 1.19 | 41.4% | 51.4% | −0.64 |
| random | 0.277 | 0.261 | 0.22 | 42.7% | 50.0% | −0.95 |

Read it in this order:

1. **The null validates the apparatus.** `random` scores 54th percentile against
   its own null — indistinguishable, which is exactly what a null must do. If it
   had scored well, nothing else in the table would mean anything.
2. **All three music-aware policies hit the kick about twice as often as
   random** (0.52–0.59 against 0.28). That is a real synchronisation result and
   it is measured on the finished mp4.
3. **`naive` hits most often and cuts worst.** It lands on the kick 58.5% of the
   time and at the 35.8th percentile of kick energy — below its own null. It
   cuts on beats whether or not anything is happening on them, which is the
   entire argument of this lane, now with a number.
4. **`rules` is the only policy whose cuts land at above-null energy** (+0.42).
   Synchronised *and* selective.

None of that says the edit is good. `bench/verdict.py` exists and nobody has run
it. Until somebody does, the correct sentence is "no verdict has been recorded".

---

## 8. Second round: from a shot sequencer to a compositor

Everything above was true and was not enough. Three edits built from §4 were
shown to a person who rejected all three: *"random clips pieced together without
any emotion"*, and later *"all you did was put a few clips together and nothing
else. Not an ad, not content, nothing."* Both were correct. What follows is what
changed, and it is mostly a list of things that were wrong.

### 8.1 The IR could not express content

`start`, `end`, `clip_id`, `in_s`, `because`. No text, no grade, no transform,
no effect — so `compile.py` could only put clips in an order, and between one
cut and the next nothing happened. The briefs were worse: every field named how
it should LOOK (`brightness`, `saturation`, `min_shot_s`) and not one said what
it should MEAN. An ad brief with no message is not an ad brief.

`readers/video/render.py` composes instead of concatenating, and
`readers/video/motion.py` is the rule this repo already lived by, applied to
picture:

```
zoom = 1 + breath·pump(t)·energy(t) + punch·accent(t) + drop_punch·drop(t)
```

The lighting reader has always said *brightness = f(position in the beat)*. This
is *scale = f(position in the beat)*, and it is driven by measurements: the
record's own 24-bin sidechain envelope, and a 90 ms impulse on each of the 472
accents that clear a threshold, thinned from 3,520. At a drop the frame goes
0.92 → 1.16 and brightness 1.00 → 1.33 within two frames.

**The bet, so it can be judged:** this will not out-taste an editor. It can work
at a density and precision nobody would pay a person for.

### 8.2 Coherence is semantic, and three fixes were needed

1. **Category labels do not describe appearance.** "street" held a neon alley
   and a desert highway at sunset; "city" held green hills.
2. **A 36-number look vector does not describe meaning.** Clustering on it
   picked "dark things": a tape deck, three star fields and a train.
3. **So a person curated three sets by eye**, and every catalogue says
   `how: curated` because that is not a result.

`assets/semantic.py` ends it. CLIP embeds one frame per shot and scores it
against two vocabularies: the map's own mood terms, and a content list. A brief
now carries `subject`, in words. From the same uncurated 90-clip pool, three
contradictory briefs select three worlds — water 115 shots, club 68, forest 93.

**The bridge, precisely** (the loose version was written twice before being
checked): `observations.mood` is MuQ-MuLan, a joint music/text model; CLIP is a
joint image/text model. They do **not** share an embedding space and their
vectors are not comparable. They share the ten **words**. The path is
music → mood word → image, joined in English. Weaker claim, true one.

Continuity and variety turned out to be different axes: continuity is about the
**world** (water, night, city), variety about what is **in** it. One term was
doing both, and matching section mood then put nine sandy beaches in thirteen
shots — coherent and monotonous.

### 8.3 Four measurement errors, all mine, all found by measuring

| what | the error | how it was caught |
|---|---|---|
| onset time | flux labelled with the earlier window's start — every onset ~90 ms early | clicks rendered at authored times; 48/48 matched after correction |
| onset band | full-spectrum flux is displaced by sidechain; peaks land *between* beats | the map's own `pump` says the release is at 0.39 of a beat = 182 ms |
| onset statistic | **flux** said downbeats sat at the 26.6th percentile of kick energy — reads as a broken grid | measured as **level**, downbeats in the drop sit at the **97.6th** |
| the pool | fixtures in the production index; CLIP calls a disc on noise "an ocean wave" | the control edit was drawn from `assets/generated` |

The third is the one to remember. Three hypotheses died before it: that the
metric punished cuts inside a quiet build (refuted by splitting by section),
that the lag was miscalibrated for a band-passed signal (refuted by a synthetic
kick), and that the map's downbeats were wrong (refuted above). **Flux finds an
onset; level says whether the kick is there.**

### 8.4 What the gate can and cannot say

It cannot rank the A/B. On the corrected statistic the two edits are identical
after the drop (91.8 vs 91.9) and differ only inside the build, where the
bar-aligned edit cuts at 16.1% against a 36.2% baseline — because a riser
**resets on the bar**, so a bar-aligned cut lands at its quietest instant by
construction. That is correct editing being marked down.

Two of this gate's measures turned out to be asking a different question than
the one intended. Treat it as a detector of gross error, not as a judge.

## 9. Open problems

1. **A witness for salience** independent of loudness and meaningful across
   genres. Untried: vocal phrase entries from Whisper; a human marking where
   they would cut.
2. **The brief/music tension.** When a brief wants more cuts than the music
   justifies, the system fills with timer cuts. It should probably refuse, or
   report the shortfall as a first-class result.
3. **Footage that suits the briefs.** Only 3 of 114 shots contain a face, so the
   `observational` brief cannot be satisfied by the current clip set. That is a
   footage gap, not a policy result, and it must not be read as one.
4. **`accents`** still loses the most weight of any map field, and still wants a
   purpose-built drum transcription model (ADTOF, or the Jan 2026 arXiv result).
5. **Whether the LLM policy helps at all.** It produces visibly different and
   more interesting intent — long holds through both drops — and that is an
   observation about the text it wrote, not evidence about the edit.
6. **There is still no message.** Every output so far is a montage: it now picks
   its own footage, follows the song's shape, and moves every frame — and it is
   *about* nothing. `briefs/*.json` describe texture and pacing; none of them
   carry a subject, a claim, or a call to action, and the IR cannot render text,
   a grade or an end card. This is the largest remaining gap between "a
   well-cut montage" and "an ad", and it is the one input the map cannot supply.
7. **A human verdict on the current work.** `truth/video-verdicts.json` holds
   one entry: all three of the first generation rejected. Nothing since has been
   formally judged, so no claim in §8 is backed by a recorded verdict.

---

## Addendum, 2026-09-11: the recipe becomes an interface

The spec above describes the brief as taste-as-data and stops there. Two things
were learned by using it, and they change the shape of the product rather than
its internals.

### The recipe is shared, not the video reader's

The map is one file three readers turn into three art forms; the recipe had not
followed. Video had grown `pace / look / motion / effects`, lighting had grown
`ENERGY: low | medium | high`, drones a third thing. `readers/recipe.js` now
holds the vocabulary once — each axis places its words on 0..1, and each reader
turns that position into its own units. The same sentence is a cut rate, a chase
rate and a formation rate.

Four words beat one knob: *"fast and restrained"* — a room that changes often
without being hit — could not be asked for at all through `low/medium/high`, and
it is an ordinary thing to want. `ENERGY` survives as a shorthand that fills the
axes nobody named, because an operator at 2am wants one knob.

Drift between the two word lists is a load-time error.

### Silence is a question, not a default

This is the part worth carrying forward. A brief may be one line:

```json
{ "name": "A phone ad" }
```

Everything unsaid is **decided from the material and recorded with its reason**:
pace from the bar rate the grid hands over for free, effects from how many
moments the song actually has, look and motion and format from what the footage
can supply, and the footage pool itself from the brief's own words matched
against `SEMANTIC.json`.

`PACE.measured` when nobody wrote a pace was a default, and a default is the
system declining to think. The rule that makes this safe rather than magic:
**an explicit word always wins, and every inference says what it was measured
from** — an inferred pace that cannot explain itself is indistinguishable later
from one somebody typed at random.

### What this cost, and the rule it produced

The `effects` word was inert for its whole life: `render.py` falls back to its
own defaults when `made_by.motion` is absent, and `edit.js` never wrote it, so
`none` and `loud` rendered byte-identical files. Nothing said so.

The rule: **a knob that cannot be shown to change the output is not a knob.**
`bench/verdict.py variants` hashes every render before sealing a blind
comparison and refuses to ask a human to rank two identical files — because that
ranking would have been written down as `how: truth`.
