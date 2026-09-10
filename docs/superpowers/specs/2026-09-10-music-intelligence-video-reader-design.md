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

### 5.4 Two dead metrics, kept as warnings

- Correlating the whole visual-change curve against onset strength: motion
  *inside* shots swamps the cuts, every edit scored |r| < 0.04, the ranking was
  noise.
- Distance from a cut to the nearest onset peak: with peaks every 0.24 s every
  instant is a near miss, and a musical edit, a random edit and a beat-cut edit
  all read exactly 80 ms — the frame resolution.

Replaced by a hit rate at a fixed tolerance, with a refractory period on peak
picking so peaks can be no denser than one beat at 200 bpm.

### 5.5 Roughly half the "intelligent" cuts have no musical reason

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
| the intelligent edit beats a null | **NOT SHOWN** — see §5 and `bench/cutscore.py` |
| the intelligent edit is better | **unsupported** — no human verdict recorded yet |

The last two rows are the honest state of the work. `bench/verdict.py` exists
and nobody has run it. Until somebody does, the correct sentence is "no verdict
has been recorded", not "the intelligent edit is better".

---

## 8. Open problems

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
