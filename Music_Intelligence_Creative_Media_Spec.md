# MUSIC INTELLIGENCE → CREATIVE MEDIA
## Engineering Specification / Context Brief for Claude Code

**Purpose:** Source-of-truth context for extending the existing Music Intelligence project toward **music-synchronized video editing for ads, reels, short-form content, music videos, and other time-based creative media**, while preserving the same universal intelligence layer used by the lighting team.

**Important:** We already have a substantial analysis pipeline. Do **not** assume the current map schema is correct merely because it exists. Treat it as an implementation artifact that must be inspected, tested, challenged, and either retained, migrated, or replaced based on evidence.

---

# 1. WHAT WE ARE BUILDING

We are building a **Music Intelligence layer** that creates a machine-readable, time-aware representation of music that can be consumed by multiple creative renderers.

First renderers:

1. **Video / content renderer** — primary focus for this workstream.
2. **Lighting renderer** — developed by other teammates.
3. Future: camera control, projection, VFX, choreography, etc.

The project is **not** fundamentally "AI video editing" and is **not** fundamentally "AI lighting."

The core product is:

> **A machine-readable representation of musical structure, trajectory, events, relationships, uncertainty, and creative affordances that downstream systems can compile into time-based creative actions.**

Conceptually:

```text
                         MUSIC
                           |
                           v
                 MUSICAL INTELLIGENCE
                           |
              +------------+------------+
              |                         |
              v                         v
       MEASURED EVIDENCE          SEMANTIC / LEARNED
              |                   EVIDENCE
              +------------+------------+
                           |
                           v
                MUSICAL REPRESENTATION
                           |
                           v
                  SONG-LEVEL CONTEXT
                           |
                           v
                CREATIVE INTERPRETATION
                           |
                           v
                  UNIVERSAL CREATIVE IR
                    /          \
                   /            \
                  v              v
             VIDEO IR       LIGHTING IR
                  |              |
                  v              v
             VIDEO COMPILER  DMX COMPILER
                  |              |
                  v              v
             EDIT / VFX       FIXTURES
```

The **universal layer must not contain assumptions that only make sense for lights or video.**

---

# 2. CURRENT STATE — DO NOT START FROM SCRATCH

We currently have a working music-analysis pipeline.

It produces one JSON map per song and a scorer grades the resulting map.

Current internal status:

- Five recordings mapped.
- Current mean: **0.807 across 16 weighted checks**.
- This is promising but is NOT treated as proof that the representation is correct.
- The scorer is an engineering ruler, not an oracle.
- Existing components:
  - librosa
  - Demucs (6-stem)
  - MuQ
  - MuQ-MuLan
  - MERT
  - ChordMini
  - basic-pitch
  - Whisper
  - beat_this
- **Essentia is NOT currently part of the stack.** It may be proposed experimentally, but do not describe it as existing infrastructure.
- **MERT is currently load-bearing.** Identity and surprise are computed from MERT-derived rows. Do not remove or silently replace MERT without an explicit experiment.

The current map is **event-based rather than a fixed grid**.

Important temporal characteristics:

- Accents are placed to approximately **7–17 ms** against the raw waveform.
- Moments are graded at approximately **half-a-beat tolerance**.
- A 0.5 s fixed state array is therefore not sufficient as the sole representation.

Intended hybrid representation:

```text
CONTINUOUS QUANTITIES
    energy
    brightness
    tension
    velocities / derivatives
    etc.
        |
    time series / arrays

INSTANTS
    beats
    accents
    hits
    moments
    onset-like events
        |
    timestamped event lists

INTERVALS
    chapters
    sections
    spans
    holds
        |
    [start, end] intervals
```

---

# 3. CRITICAL SCIENTIFIC / ENGINEERING RULE

## Never grade a thing against its own output.

Before believing a score, inspect what the two sides of the comparison share.

If the writer and the "reference" use the same code, feature family, intermediate representation, or directly dependent output, their agreement may be meaningless.

Examples already caught:

### Meter bug

Drums were used to create the metric and drums were also used to grade it. Both sides confidently agreed while potentially agreeing on the same wrong interpretation.

### Energy bug

The target "energy" and reference were both derived from loudness-like information, making the apparent correlation circular.

### Failed build decoder

A build hypothesis was decoded using stem counts and chord rate.

Result:

```text
decoded spans        0.359
randomly shifted     0.366
```

The decoder did **not** discriminate from random offsets and was given zero weight.

Do not revive this as a successful learned/decoded result.

---

# 4. INDEPENDENCE MODEL

There is no universal ground-truth ranking.

Human annotations are NOT automatically ground truth for this project. Human annotators have disagreement and failure modes.

For our purposes, a particularly strong form of evidence is:

> **Re-measuring the same recording through a path that shares no code and no feature family with the writer.**

Every evaluated metric should expose provenance / independence metadata.

Example:

```json
{
  "metric": "identity",
  "writer": {
    "method": "MERT_similarity",
    "feature_family": "MERT"
  },
  "reference": {
    "method": "independent_audio_model",
    "feature_family": "different"
  },
  "shared_code": false,
  "shared_feature_family": false
}
```

Do not invent a universal numerical ranking of independence. Record the dependency structure so the scorer can reason about it.

---

# 5. MOSS-MUSIC

MOSS-Music is an **independent hypothesis generator**, not ground truth and not a replacement for measured fields.

It must be run **blind**:

1. Give MOSS the audio.
2. Ask for its hypothesis.
3. Do NOT tell it our current answer.
4. Only then compare with the existing representation.
5. Feed the comparison into the scorer.

Two immediate experiments:

### A. Malayalam hook

Whisper currently hallucinates on at least one Malayalam track.

Use MOSS independently to hypothesize:

- recurring salient vocal/melodic section
- likely hook location
- structural repetition

### B. Identity / repetition disagreement

One song currently has identity scoring around **0.02** because two existing methods disagree about where material repeats.

Use MOSS to produce an independent structural hypothesis.

Possible outcomes:

```text
Existing A ≈ MOSS
Existing B ≠ MOSS
```

or:

```text
Existing A ≠ MOSS
Existing B ≈ MOSS
```

or:

```text
A ≠ B
A ≠ MOSS
B ≠ MOSS
```

The last case should be represented as unresolved ambiguity, not forced into one identity label.

---

# 6. LLM BOUNDARY

The LLM may operate at the **creative interpretation layer**.

It may also act as a candidate generator elsewhere, provided that an independent scorer remains the judge.

The LLM must NOT write numeric measured fields.

Bad:

```text
LLM -> energy = 0.83
LLM -> brightness = 0.71
LLM -> tension = 0.64
```

Bad:

```text
audio -> LLM -> "build = rising energy"
```

Good:

```text
measured representation
+
trajectory
+
events
+
uncertainty
+
aesthetic profile
+
creative constraints
        |
      LLM
        |
creative intent
```

The LLM can produce:

```json
{
  "strategy": "restrained_anticipation",
  "headroom": "high",
  "dominant_action": "hold",
  "release_strategy": "full_spatial_expansion"
}
```

It must not invent the underlying measurements.

It should not determine final hardware timing either. Compilers do that.

---

# 7. MUSIC IS NOT JUST A STATE

A naive system might treat a song as:

```text
time -> energy
time -> brightness
time -> beat
```

That is insufficient.

The representation should capture, as supported by evidence:

```text
STATE
STRUCTURE
TRAJECTORY
EVENTS
RELATIONSHIPS
CONTEXT / EXPECTATION
UNCERTAINTY
```

A musical "build" cannot be defined as:

```text
energy ↑ = BUILD
```

We have observed a real build into a drop where measured composite energy fell:

```text
0.42
0.31
0.15
0.10
0.09
0.13
-> DROP
```

Do NOT claim that the system learned falling energy as anticipation.

We observed it through measurement and hypothesis testing. The attempted decoder was non-discriminative and received zero weight.

The representation must therefore allow a musical function to be inferred from relationships and context rather than one acoustic trajectory.

Potential future evidence may include:

- repetition
- onset/rhythmic density
- stem presence/absence
- harmonic movement
- phrase position
- similarity to previous sections
- upcoming salient event
- recent trajectory
- contrast against preceding section
- learned embedding trajectory
- semantic structural hypotheses
- confidence / competing hypotheses

But these must be implemented and validated experimentally, not asserted because they sound musically plausible.

---

# 8. UNIVERSAL MUSICAL REPRESENTATION

The musical representation must NOT mention:

- PAR lights
- DMX
- moving heads
- cuts
- camera zooms
- B-roll
- transitions

Those belong downstream.

The universal representation should answer:

```text
What is happening?
When?
How strongly?
How is it changing?
What happened before?
What may matter relative to what came before/after?
Where are important events?
Which interpretations are uncertain?
What relationships exist between sections/events?
```

A conceptual representation:

```json
{
  "song": {},

  "continuous": {
    "times": [],
    "energy": [],
    "brightness": [],
    "tension": [],
    "density": [],
    "embedding_refs": []
  },

  "events": [
    {
      "id": "evt_001",
      "time": 93.600,
      "type": "salient_event",
      "strength": 0.91,
      "evidence": []
    }
  ],

  "intervals": [
    {
      "id": "sec_004",
      "start": 80.2,
      "end": 93.6,
      "type": "section",
      "hypotheses": []
    }
  ],

  "relationships": [
    {
      "source": "sec_002",
      "target": "sec_004",
      "type": "repetition",
      "confidence": 0.71
    }
  ],

  "uncertainty": {
    "identity": []
  }
}
```

This is illustrative only.

**Do not adopt it blindly. Audit the existing map first.**

---

# 9. TREAT THE CURRENT MAP AS A HYPOTHESIS

The existing map could be excellent, partially useful, overfit to current scorers, internally inconsistent, unnecessarily complicated, missing important concepts, or some mixture.

Claude Code must therefore perform an **audit before extending it**.

Audit:

### Representation
- Are continuous and discrete information separated correctly?
- Are timestamps precise enough?
- Are intervals explicit?
- Are events independent of states?
- Are derived values distinguishable from measured values?

### Provenance
For every field:
- Where did it come from?
- Which model/code produced it?
- What raw information does it depend on?
- Is it measured, derived, inferred, or generated?
- Is it independently validated?

### Semantics
- Does the field have a stable meaning?
- Is it physical/acoustic or interpretive?
- Does the name imply more certainty than the pipeline actually has?

### Leakage / circularity
- Does any scorer compare outputs derived from the same feature family?
- Is any "reference" downstream of the prediction?
- Is an LLM-generated label treated as measured truth?
- Are apparently independent fields mathematically dependent?

### Generality
- Does it work across genres?
- Does it preserve ambiguity?
- Does it support long-form context?
- Can video and lighting consume the same information?

### Temporal correctness
- Does it preserve sub-beat event precision?
- Can it express long spans?
- Can it represent instantaneous events without a grid?
- Can it express intentional inactivity?

Produce an audit report:

```text
KEEP
CHANGE
REMOVE
UNCERTAIN
```

Do not redesign blindly.

---

# 10. CREATIVE INTELLIGENCE

After musical evidence comes creative interpretation.

```text
MUSICAL EVIDENCE
        +
MUSICAL STRUCTURE
        +
AESTHETIC PROFILE
        +
OUTPUT MEDIUM
        +
AVAILABLE ASSETS
        +
CONSTRAINTS
        |
CREATIVE INTENT
```

The same music can therefore yield different outputs.

Example:

```text
Music + "luxury automotive ad"
    -> slower cuts
    -> hero shots
    -> restrained motion
    -> high negative space
```

versus:

```text
Music + "high-energy Instagram reel"
    -> shorter cuts
    -> stronger visual accents
    -> faster shot changes
    -> more aggressive transitions
```

The musical representation stays the same. The creative policy changes.

This is what keeps the project universal.

---

# 11. AESTHETIC PROFILE

Do NOT reduce taste to four scalar knobs.

An aesthetic profile should encode:

### Preferences
- visual intensity
- motion preference
- contrast preference
- colour tendency
- temporal aggression
- repetition tolerance

### Policies
- maximum normal intensity
- preferred transition duration
- minimum hold duration
- maximum effect density
- preferred amount of repetition
- whether abrupt cuts are acceptable
- whether visual silence is desirable

### Budgets
- attention budget
- number of major visual accents
- maximum high-intensity moments
- movement budget
- transition budget

### Restraint

A machine given a value every bar will tend to do something every bar.

Therefore "do nothing" is a legitimate creative action.

Conceptually:

```json
{
  "restraint": {
    "allow_no_change": true,
    "minimum_rest_duration_s": 8,
    "preserve_headroom": true
  }
}
```

A HOLD is not missing data.

It means:

> **The system deliberately chose not to spend visual attention.**

---

# 12. UNIVERSAL CREATIVE IR

The first downstream implementation is video, but the IR must not become a video-only hack.

Use temporal primitives that naturally generalize.

At minimum:

## EVENT

Instantaneous or near-instantaneous creative cue.

```json
{
  "type": "event",
  "time": 93.600,
  "action": "IMPACT",
  "strength": 1.0
}
```

## SPAN

A continuous intention over an interval.

```json
{
  "type": "span",
  "start": 20.0,
  "end": 110.0,
  "action": "INTENSIFY",
  "from": 0.15,
  "to": 0.65,
  "curve": "ease_in_out"
}
```

## HOLD

An explicit period of intentional restraint.

```json
{
  "type": "hold",
  "start": 40.0,
  "end": 70.0,
  "action": "HOLD",
  "reason": "preserve_headroom_for_upcoming_release"
}
```

These are generic temporal creative primitives.

Video can interpret:

```text
EVENT -> cut / flash / impact transition
SPAN  -> gradual camera motion / visual escalation
HOLD  -> preserve shot / no transition / visual breathing room
```

Lighting can interpret:

```text
EVENT -> cue
SPAN  -> intensity / colour / movement trajectory
HOLD  -> preserve lighting state
```

---

# 13. SEMANTIC ZONES

Do not bind the universal IR to physical devices.

Use semantic targets / zones.

Video examples:

```text
foreground
subject
background
environment
hero
supporting
left
center
right
wide
close
```

Lighting examples:

```text
left_field
center_field
right_field
attention
```

The universal layer says:

> **what kind of creative attention is desired**

The renderer says:

> **what assets / fixtures can satisfy it.**

---

# 14. VIDEO IS THE PRIMARY NEW RENDERER

The video system should answer:

> Given a music representation and a set of source video assets, how should the video be edited to make the visual experience feel musically intentional?

This is much more interesting than:

```text
beat -> cut
```

The system should potentially consider:

- beat alignment
- phrase boundaries
- section changes
- salient musical events
- repetition
- buildup / release relationships
- contrast
- visual continuity
- shot duration
- shot salience
- visual motion
- subject identity
- shot composition
- asset reuse
- visual density
- aesthetic profile
- upcoming musical events
- deliberate holds
- transitions

Only include features that survive technical evaluation.

---

# 15. VIDEO INPUTS

The video renderer receives two major classes of input.

## A. Musical representation

The universal output.

## B. Visual asset representation

Each source video should be analyzed into metadata.

Do not make the LLM inspect raw video frames for every decision if deterministic preprocessing can provide useful metadata.

Conceptual asset representation:

```json
{
  "clip_id": "clip_014",
  "duration": 4.8,

  "shots": [
    {
      "start": 0.0,
      "end": 4.8,
      "type": "medium",
      "subject": "car",
      "motion": 0.72,
      "camera_motion": 0.31,
      "visual_energy": 0.65,
      "brightness": 0.44,
      "faces": 0,
      "composition": "center_subject"
    }
  ]
}
```

Conceptual tooling candidates:

- FFmpeg
- OpenCV
- shot-boundary detection
- object / subject detection
- CLIP-like visual embeddings
- optical-flow / motion estimates
- OCR where relevant
- subject tracking where needed

Do not add tools just because they are fashionable; choose based on evidence and the hackathon deadline.

---

# 16. VIDEO COMPILER

The video creative layer should NOT directly manipulate FFmpeg commands.

```text
Creative Intent
      |
      v
Video IR
      |
      v
Video Compiler
      |
      v
Timeline / Edit Decision List
      |
      v
FFmpeg / NLE-compatible output
```

The compiler handles deterministic mechanics:

- source clip selection
- in/out points
- timing
- cuts
- transitions
- speed changes
- crop / framing
- effects
- render settings

The creative layer decides what should happen.

The compiler decides how to execute it.

---

# 17. VIDEO IR — CONCEPTUAL EXAMPLE

A renderer-specific IR might eventually look like:

```json
{
  "timeline": [
    {
      "type": "span",
      "start": 0.0,
      "end": 8.2,
      "intent": "ESTABLISH",
      "shot_policy": {
        "preferred_duration": [3.0, 5.0],
        "motion": "low"
      }
    },

    {
      "type": "hold",
      "start": 8.2,
      "end": 14.8,
      "reason": "preserve_visual_headroom"
    },

    {
      "type": "event",
      "time": 14.8,
      "intent": "IMPACT",
      "edit_action": "CUT",
      "strength": 0.92
    }
  ]
}
```

Exact schema is deliberately NOT fixed yet.

First establish:

1. which fields are genuinely needed,
2. which are measurable,
3. which are creative,
4. which belong to the renderer,
5. which can be shared with lighting.

---

# 18. WHO CHOOSES A VIDEO CUT?

### Musical analysis

May say:

```text
event at 14.800s
salience = high
```

### Creative layer

May say:

```text
Use this event as a visual punctuation point.
```

### Video compiler

May say:

```text
Choose a cut from clip A at 14.800s.
```

The LLM should NOT silently turn:

```text
musical event
```

into:

```text
cut every beat
```

That is the reactive system we are trying to surpass.

---

# 19. LOOK-AHEAD IS REQUIRED

The creative system needs whole-song context.

It must be able to reason over:

```text
current moment
+
recent history
+
upcoming events
+
section destination
```

Example:

```text
0–20s:
long shots

20–40s:
gradually shorten shot duration

40–50s:
HOLD / preserve a shot

50s:
major musical event

50s:
cut to strongest visual
```

The decision at 45s depends partly on what happens at 50s.

Therefore the system should **compose the edit plan ahead of playback**, not make every edit independently from the current audio frame.

---

# 20. SHOT DURATION SHOULD NOT SIMPLY EQUAL BPM

A naive implementation:

```text
BPM = 128
-> cut every 0.46875s
```

is the wrong abstraction.

Treat musical events as **opportunities**, not mandatory edit commands.

Potential policy:

```text
major event       -> candidate cut
minor beat        -> usually ignore
phrase boundary   -> strong candidate
section change    -> strong candidate
repetition        -> consider visual repetition
HOLD              -> do not cut
climax            -> allow increased visual density
```

Final decisions are constrained by:

- aesthetic profile
- available footage
- continuity
- previous cuts
- upcoming events
- shot quality

---

# 21. VISUAL HEADROOM

The same concept that matters for lighting matters for video.

If every moment gets:

- a cut,
- zoom,
- transition,
- speed ramp,
- effect,

then nothing feels important.

The video renderer therefore needs explicit visual headroom.

Conceptually:

```text
VISUAL ATTENTION
--------------------------------
INTRO       ██
GROOVE      ███
BUILD       █████
RELEASE     ███████████████
BREAKDOWN   ██
CLIMAX      ███████████████████
```

The renderer must be allowed to do less before an important moment.

---

# 22. BEFORE VS AFTER

Compare the same source footage and same song.

## BEFORE — reactive / naive

```text
beat detection
    |
fixed beat-aligned cuts
    |
simple visual transitions
```

Expected result:

- synchronized
- technically correct
- repetitive
- no long-form composition

## AFTER — Music Intelligence

```text
song analysis
    |
musical representation
    |
trajectory / events / structure
    |
aesthetic policy
    |
creative intent
    |
video IR
    |
video compiler
    |
finished edit
```

Defensible claim:

> **Instead of treating every beat as an instruction, the system constructs a whole-song representation and uses it to decide where visual attention should be spent.**

Do not claim perfect musical understanding.

---

# 23. VIDEO DEMO DESIGN

Recommended hackathon input:

- one song
- 10–30 short source clips
- a stated creative brief

Example:

```text
Music: chosen track
Content: automotive / lifestyle / fashion footage
Format: 9:16
Style: high-energy premium social reel
```

Output A:

> Naive beat-synced edit.

Output B:

> Music-intelligent edit.

Show the machine-readable timeline underneath:

```text
MUSIC
------------------------------------------------
INTRO       BUILD        RELEASE       GROOVE
---------------+------------------------------
               |
VIDEO
-------SHOT------------HOLD----CUT----SHOT----
```

The intermediate artifact makes the reasoning visible.

---

# 24. UNIVERSAL ARTIFACT

The strongest architecture is not:

```text
song -> video
```

or:

```text
song -> lights
```

It is:

```text
song
 |
MUSIC INTELLIGENCE ARTIFACT
 |
creative renderers
```

For example:

```text
                    MUSIC
                      |
              MUSIC INTELLIGENCE
                      |
              musical_artifact.json
                      |
       +--------------+--------------+
       |              |              |
       v              v              v
     VIDEO          LIGHTING        CAMERA
       |              |              |
       v              v              v
      EDIT           DMX          MOVEMENT
```

This is why video and lighting should share the foundation.

---

# 25. PROVENANCE MUST REACH THE CREATIVE OUTPUT

Every important creative action should be traceable backwards.

Example:

```text
VIDEO CUT @ 93.600s
       |
       v
Creative intent:
"punctuate release"
       |
       v
Aesthetic policy:
"reserve major cuts for high-salience events"
       |
       v
Musical evidence:
salient event @ 93.600s
       |
       +-- beat evidence
       +-- stem evidence
       +-- embedding evidence
       +-- independent evidence
```

For a HOLD:

```text
Why did the video remain on this shot for 12 seconds?

-> HOLD
-> preserve visual headroom
-> no sufficiently strong event during interval
-> upcoming salient event at 93.600s
-> aesthetic profile prefers contrast
```

This makes the system inspectable.

---

# 26. UNCERTAINTY MUST SURVIVE INTO CREATIVE REASONING

Suppose identity is unresolved:

```text
Hypothesis A: section repeats previous motif
confidence: 0.48

Hypothesis B: new section
confidence: 0.44

Hypothesis C: unclear
confidence: 0.08
```

Do not force:

```text
identity = A
```

Let the creative layer operate under uncertainty.

Example:

```text
If identity is uncertain:
avoid aggressive visual callbacks
prefer a neutral transition
preserve flexibility for the next event
```

Measurement uncertainty does not have to prevent creative action.

---

# 27. LLM OUTPUT CONTRACT

Do not send thousands of raw feature rows to an LLM.

Use hierarchy:

```text
SONG
  |
SECTIONS
  |
PHRASES
  |
LOCAL STATES
  |
EVENTS
```

The LLM can reason over:

- section summaries
- trajectories
- event lists
- repetition relationships
- uncertainty
- aesthetic profile
- available video assets
- creative brief

It should return structured creative intent.

Example:

```json
{
  "global_strategy": "...",

  "segments": [
    {
      "start": 0.0,
      "end": 20.0,
      "intent": "...",
      "attention_budget": 0.25,
      "preferred_visual_density": 0.30
    }
  ],

  "events": [
    {
      "time": 93.600,
      "intent": "major_visual_punctuation",
      "strength": 0.92
    }
  ],

  "holds": [
    {
      "start": 80.0,
      "end": 90.0,
      "reason": "preserve_headroom"
    }
  ]
}
```

Illustrative only.

---

# 28. VALIDATION OF LLM OUTPUT

Never trust raw LLM JSON.

Pipeline:

```text
LLM
 |
JSON schema validation
 |
semantic validation
 |
constraint validation
 |
IR
 |
compiler
```

Semantic checks should catch:

- overlapping contradictory actions
- invalid time ranges
- impossible transition durations
- exceeding aesthetic budgets
- nonexistent assets
- unavailable capabilities

---

# 29. HARDWARE / RENDERER INDEPENDENCE

The universal creative layer must not know:

```text
PAR1
DMX channel 17
moving head
```

Likewise, video creative intent should not know:

```text
FFmpeg filter_complex
```

Use:

```text
creative intent
       |
renderer-specific IR
       |
deterministic compiler
       |
physical / software execution
```

---

# 30. LIGHTING TEAM COMPATIBILITY

Lighting independently owns:

```text
semantic zones
+
spans
+
events
+
holds
+
aesthetic profile
+
fixture roles
+
latency model
+
deterministic compiler
```

Video should share the conceptual model, not copy lighting-specific fields.

Shared:

- temporal primitives
- provenance
- aesthetic policy
- attention budgets
- restraint
- musical events
- trajectories
- uncertainty
- creative intent

Renderer-specific:

- fixture roles
- DMX
- shot selection
- cut points
- transitions
- crop
- camera motion
- video effects

---

# 31. VIDEO VERTICAL SLICE

Before sophisticated intelligence, prove this wire:

```text
hard-coded music artifact
        |
hard-coded creative intent
        |
minimal video IR
        |
video compiler
        |
FFmpeg
        |
rendered reel
```

This is the video equivalent of the lighting team's Day-1 hardware smoke test.

The point is to prove the end-to-end wire before spending days on intelligence.

---

# 32. SECOND VIDEO MILESTONE

Replace the hard-coded music artifact with the existing map:

```text
existing map
    |
adapter
    |
universal representation
    |
simple video strategy
    |
video IR
    |
compiler
```

This will reveal whether the existing map is actually suitable for creative rendering.

---

# 33. THIRD VIDEO MILESTONE

Add visual asset analysis:

```text
SOURCE VIDEOS
     |
shot detection
     |
visual metadata
     |
asset index
```

Then allow the creative layer to choose among actual footage.

---

# 34. FOURTH VIDEO MILESTONE

Add LLM creative interpretation:

```text
music representation
+
visual asset representation
+
creative brief
+
aesthetic profile
        |
      LLM
        |
creative intent
        |
video IR
```

Do not let the LLM directly choose arbitrary raw timestamps if deterministic musical events or asset boundaries already exist.

---

# 35. FIFTH VIDEO MILESTONE

Build the actual before/after.

### Baseline

```text
beat -> cut
```

### Intelligence

```text
music
 |
evidence
 |
representation
 |
trajectory / structure / events
 |
creative intent
 |
video IR
 |
compiled edit
```

Same:

- song
- source footage
- output format

Only the decision process changes.

---

# 36. EVALUATION

Do not evaluate only the final video aesthetically.

Create measurable checks where possible.

### Musical alignment
- cuts near salient events
- cuts near phrase boundaries
- avoidance of irrelevant beats
- major visual changes near major musical events

### Temporal composition
- shot-duration trajectory
- visual-density trajectory
- transition density
- headroom before major moments

### Repetition
- repeated musical sections receive intentional visual callbacks
- visual repetition is not accidental
- repeated music can produce controlled visual variation

### Restraint
- unnecessary cuts are avoided
- holds occur where the strategy calls for them
- visual intensity is not saturated throughout

### Technical validity
- no missing media
- no illegal timeline ranges
- no frame-rate mismatch
- no broken renders

### Independence
Any metric comparing a generated field to another field must record whether the two sides share code or feature families.

---

# 37. THE SCORER IS A RULER, NOT A GOD

A score is evidence, not truth.

For every metric ask:

```text
What exactly is measured?
What is the writer?
What is the reference?
What do they share?
What failure mode could fool both?
```

If a metric cannot discriminate a proposed decoder from random or a null baseline, reduce/remove its weight.

Do not optimize the system merely to increase a questionable number.

---

# 38. SUCCESS CRITERIA

The project succeeds if we can demonstrate:

1. **Universal musical artifact**
   - A song becomes a structured representation rather than a stream of audio samples.

2. **Creative interpretation**
   - The representation plus an aesthetic/creative brief can produce a coherent visual strategy.

3. **Restraint**
   - The system can deliberately do nothing.

4. **Whole-song reasoning**
   - Current visual decisions can depend partly on upcoming musical events.

5. **Renderer separation**
   - The same musical intelligence can feed video and lighting.

6. **Before/after superiority**
   - The intelligent system produces a visibly more intentional result than a naive beat-reactive baseline.

7. **Technical credibility**
   - We can trace:
     audio -> evidence -> representation -> creative intent -> IR -> compiler -> artifact.

8. **Intellectual honesty**
   - Uncertainty and failed hypotheses are preserved rather than hidden.

---

# 39. BIGGER PRODUCT

The long-term product is not an auto-editor.

It is not an auto-lighting system.

It is:

> **A machine-readable representation of musical intent that can be rendered into different time-based creative media.**

Potential renderers:

```text
                    MUSIC
                      |
                      v
             MUSIC INTELLIGENCE
                      |
                      v
             CREATIVE ARTIFACT
                      |
       +--------------+--------------+
       v              v              v
     VIDEO          LIGHTING        CAMERA
       |              |              |
       v              v              v
      EDIT           DMX          MOVEMENT

       + future:
       projection
       VFX
       animation
       stage automation
       AR/VR
       interactive media
```

Lighting is the physical proof-of-concept.

Video is the current primary creative-media application.

---

# 40. CORE PHILOSOPHY

Keep these boundaries intact:

```text
MEASUREMENT
"What happened?"

        |

REPRESENTATION
"How do we describe what happened?"

        |

INTERPRETATION
"What does it mean in context?"

        |

AESTHETIC POLICY
"What kind of experience do we want?"

        |

CREATIVE INTENT
"What should happen creatively?"

        |

IR
"How do we represent that action abstractly?"

        |

COMPILER
"How does this renderer execute it?"

        |

OUTPUT
"Make the video / lights / camera actually do it."
```

The LLM belongs primarily in **interpretation and creative intent**.

The LLM does not replace measurement.

The compiler does not invent creative intent.

The renderer does not redefine the music.

---

# 41. TEAM PRIORITY

My workstream:

> **Video synchronization and editing for ads/reels/content.**

Other teammates:

> **Lighting rendering for 3 PAR + 1 moving head.**

Shared foundation:

- musical representation
- provenance
- uncertainty
- aesthetic profile concepts
- creative intent concepts
- universal temporal primitives

Do NOT block one workstream on renderer-specific implementation of the other.

---

# 42. IMMEDIATE TASK FOR CLAUDE CODE

Start in this order.

## A. Inspect the repository

Find:

- current map generator
- map schema
- scorer
- metric definitions
- model integrations
- MERT usage
- existing temporal representations
- existing tests
- example maps
- five mapped recordings if available

## B. Produce a technical audit

Do not modify architecture yet.

Answer:

1. What does the current map represent?
2. Which fields are measured?
3. Which are derived?
4. Which are inferred?
5. Which are semantically ambiguous?
6. Which are redundant?
7. Which cannot support video?
8. Which are useful for video?
9. Where are the precision/timestamp guarantees?
10. Where is circular evaluation?
11. Which components can be reused unchanged?
12. What should the universal representation become?

Output:

```text
KEEP
CHANGE
REMOVE
UNCERTAIN
```

## C. Run MOSS blind

Before seeing current answers, obtain MOSS hypotheses for:

- Malayalam hook
- identity/repetition disagreement

Then compare and score.

## D. Build the vertical video wire

Before sophisticated creative intelligence:

```text
music artifact
-> simple intent
-> video IR
-> compiler
-> FFmpeg
-> rendered reel
```

## E. Only then redesign / extend the representation

Do not assume the current map is sacred.

Do not assume it is garbage.

**Measure it.**

---

# 43. NON-NEGOTIABLES

1. **Never manufacture measured numbers with an LLM.**
2. **Never evaluate a field against a dependent output without explicitly accounting for the dependency.**
3. **Run independent model checks blind.**
4. **Do not force uncertain interpretations into false certainty.**
5. **Treat HOLD / deliberate inactivity as a real creative decision.**
6. **Preserve exact event timing.**
7. **Use spans/events/holds rather than forcing everything onto a fixed grid.**
8. **Keep the universal musical representation renderer-independent.**
9. **Keep compilers deterministic.**
10. **Do not claim the system learned a musical relationship unless training/evaluation actually establishes that.**
11. **Do not redesign the existing pipeline before auditing it.**
12. **Build a working vertical slice early.**
13. **Use the scorer as evidence and challenge the scorer itself.**
14. **The same musical artifact must be capable of driving both video and lighting.**
15. **The final demo must show the difference between beat reaction and whole-song creative composition.**

---

# END
