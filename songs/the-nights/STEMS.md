# What the stems said

Six-stem separation with Demucs `htdemucs_6s`, run locally. Free, MIT, no account, no upload,
about two minutes on CPU. Independent 2026 comparisons put the gap between the best paid engine
and a well-configured free one under a decibel, so there is nothing here worth buying.

## The trap, first

**Demucs output runs a uniform +25.08 ms late against the source.** Identical on all six stems, so
it is internal framing rather than per-stem drift, and one shift corrects it — residual lag after
correcting is 0.00 ms and the six stems then reconstruct the mix to a 26% residual.

Earlier, mp3-encoded stems were **+50 ms** out, from the encoder delay on top of this. So: write
WAV, measure the offset once by cross-correlating the stem sum against the source, and subtract it.
Twenty-five milliseconds is inside the ±70 ms beat tolerance, which is exactly what makes it
dangerous — every number derived from uncorrected stems is wrong by less than the bench can see.

## The voice vacates both drops

| | voice before | voice at the drop | drums at the drop |
|---|---|---|---|
| drop 1, 63.621 s | 0.50 | **0.02** | 0.99 |
| drop 2, 139.816 s | 0.61 | **0.12** | 1.00 |

Vocal out, drums at maximum. That is a *measurable* signature of a drop in this song, and it is
not available from the mix — the full-band spectral flux sees a busy moment either way.

## The spotlight, measured rather than guessed

The most exposed vocal in the song is at **137.911 s** — voice at 1.00 against drums 0.20 and
other 0.11 — which is **1.9 seconds before drop 2**. Voice alone, then the room detonates. That is
the strongest single demo moment in the track and no one had to listen for it.

Runners-up: 44.572, 46.477, 90.289, 120.767.

## Vocal entries and exits, to the downbeat

```
IN  0:02   OUT 0:48   IN 0:52   OUT 1:01   IN 1:18   OUT 2:04
IN  2:08   OUT 2:19   IN 2:21   OUT 2:35   IN 2:36   OUT 2:38   IN 2:40   OUT 2:50
```

Two of these settle open questions. The vocal leaves at **1:01**, two and a half seconds before
drop 1 — so the pre-drop gap is a *vocal* gap, not a silence, which is consistent with finding no
silence anywhere in this record. And the vocal returns at **78.860 s**, which independently
confirms the chapter boundary I suspected near 78 from the energy dip at 84–88. Two different
measurements agreeing on a boundary I had flagged as missing is worth more than either alone.

## The hook is not separable — an honest negative

The lead hook stays inside `other`. `guitar` peaks at 0:12 and `piano` at 1:11, which are the verse
pluck and a chord stab. So **six-stem separation will not hand us "the hook plays here"** — if the
map wants that fact, it needs a field for it and a model trained to find it. Worth knowing before
someone spends a week assuming separation solves it.

## The new field

`stems` now sits in the map: per-instrument presence, one value per downbeat, normalised on each
stem's 2nd–98th percentile.

This is the gap flagged in `FINDINGS.md` after the first pass — *kick presence was the single most
informative signal in the song and it is neither a moment nor a span nor an energy value* — and
the same hole meant a lighting reader wanting to spotlight the voice had no way to know where the
voice was. It goes in under the rule: a field goes in when a reader breaks without it.

---

# First section reviewed by ear — 2026-09-03

Renjith, listening to the first thirty seconds:

> *around second 2, you hear 3 drum sounds which have to be accounted for*
> *the start of bar 10 marks the start of kicks that then stop at the end of bar 16*

Both check out on the isolated drums stem, and one of them lands exactly on a boundary I had
already detected — which is the strongest validation the grid has had.

## The kick region

Kick energy at beat positions, per bar, measured on the lag-corrected drums stem:

```
bars 2-9    0.345 - 0.457      toms, not the kick
bar 10      0.949   <- steps up 2.5x
bars 11-16  0.906 - 0.956      holds
bar 17      0.143   <- drops 6.7x
bars 19+    0.000
```

Bar 10 starts at **17.904 s** and bar 17 at **31.238 s**. That second number is *exactly* the
chapter boundary the analysis had already found at 31.238 — the same instant, from two unrelated
methods, one of them a human ear. The grid, the period, the phase and the bar phase are all
implicated in that agreement, so all four are now much better attested than before.

Bar 9 versus bar 10 also turned out to be two different events rather than one: **the bass enters
at bar 10** (0.000 → 0.191) together with the kick, while my detected boundary at 16.00 s is
bar 9. So something changes a bar before the band arrives — which is ordinary in pop and means the
boundary at 16.00 is probably right *and* incomplete.

**Why my first pass got this wrong:** I measured "kick presence" on the low band of the *full
mix*, where a bass note and a kick are indistinguishable. That reported the kick as present from
0.69 s. On the isolated drums stem the distinction is unambiguous — bars 2–9 are toms at 0.39, and
the four-on-the-floor is 0.95. Separation earns its keep here.

**Not stored as a new field.** `stems.drums` already carries this and no reader breaks without a
declaration, so it is recorded under `verified_by_human` as confirmation of the measured curve.
The rule holds: a field goes in when a reader breaks without it, not when a fact is interesting.

## The three drum sounds — a real format gap

This one *does* break a reader. The loudest drum onsets between 1.5 and 3.0 s:

| at | what | strength | position |
|---|---|---|---|
| 1.715 | hat | 0.729 | beat 3 + 0.00 — **on** the grid |
| 2.100 | hat | 0.714 | beat 3 + 0.81 — **off** the grid |
| 2.425 | snare | 0.635 | beat 4 + 0.50 — **off** the grid |
| 2.663 | snare | 0.707 | beat 4 + 1.00 — the downbeat of bar 2 |

Two of the three sit *between* beats. So a reader asked to stab three times at second 2 cannot get
those times from `beats`, and `stems` is sampled per downbeat so it cannot either. They are not
`moments` — the six kinds are structural and closed. **The map had no way to express them.**

Hence `accents`: individual percussive events with a time, a strength and which drum. Across the
song there are **983 of them, and 71% do not sit on the beat grid** — so a reader working from
`beats` alone was missing most of the percussion in the record.

## The map records everything; the recipe chooses

Making the show react to all 983 put the flicker straight back in — frames changing by more than
0.15 went from 10 to 208, and p99 from 0.137 to 0.180. It was also wrong musically: nobody stabs
every hi-hat.

So the recipe keeps accents above 0.42 strength and thins them so two stabs are never inside
300 ms — **173 stabs out of 983 recorded**. That is the separation of concerns working exactly as
intended: the *map* says what the music does, the *recipe* decides what to react to. p99 is back
to 0.153, and the hits that remain are the fills, which is what was asked for.

The first six stabs: 1.715 hat, 2.100 hat, 2.425 snare, 2.829 snare, 3.152 kick, 4.103 kick.

---

# The observation tier — 2026-09-03

> *The idea is to capture everything in a music, every single beat, including the ones like at the
> start, the instruments, their volume envelope, feeling, notes and chords.*

This exposed a real tension. I had been applying *a field goes in when a reader breaks without it*,
which is a **minimalist** rule. The ask is **completeness**. Both are right, and the resolution is
that the rule was never about what to measure — it was about what to **promise**.

| tier | contents | policy |
|---|---|---|
| **interface** | beats, downbeats, chapters, moments, spans, energy | what readers compile against. Small, stable, human-correctable, a one-way door. **Be miserly.** |
| **observation** | accents, stems, envelopes, chords, key, notes | what was measured. Additive, append-only, nothing breaks by adding. **Be generous.** |
| **learned** | `vectors` | everything with no name — which is where *feeling* lives |

## What is measured now

**Volume envelopes** — per beat, per stem, in dB below each stem's own 99th percentile. 369 values
× 6 stems. These were already being computed and thrown away every pass.

**Chords** — per bar, chroma template match over bass + other + guitar + piano against 36 templates
(major, minor, dominant 7th), median-smoothed across three bars. The song sits almost entirely on
**F#7 / B / D#m / F#**, which is coherent with:

**Key: F#**, by Krumhansl-Schmuckler profile correlation at 0.860 — a high correlation, so this is
a confident estimate rather than a guess.

**Bass notes** — per beat, autocorrelation f0 on the 38–420 Hz band of the bass stem. 175 of 369
beats voiced, and the most common roots are **C# (53), F# (39), B (37), D# (22)** — the tonic,
dominant and relative minor of F#. Two independent methods agreeing on the tonality.

Note the first sixteen beats are all unvoiced, which is correct: the bass does not enter until
bar 10, exactly as Renjith said.

## Still missing, honestly

- **Polyphonic notes.** Chords give the harmony; a full note-level transcription of the synths is
  a genuinely hard problem and not close to free.
- **Feeling.** This is not a named field and should not become one. It is the argument for the
  vector tier: there is no word for *this feels like the second half of a Coldplay song*, and the
  only honest place for it is a learned representation with the named fields decoded out of it.

## First look at the WebGL render, and three fixes

The beams were right first time — tight cones, real volumetric falloff, the front and upstage
trusses crossing properly. Three things made it look wrong, and one had been predicted:

1. **The crowd was not black.** `0x010105` is a *linear* value, and small linear values lift hard
   through the sRGB encode — about 14/255 — with bloom from the beams bleeding on top. A silhouette
   has to be 0. Same correction applied to the walls and the truss, which were reading as grey
   scaffolding floating mid-room.
2. **Thirty-six people packed into 2.6 m of depth** merged into a fence across the frame. Depth now
   spreads to 4.7 m and is biased away from the camera, so the crowd recedes; shoulder width varies
   per person. The heights were always right at 1.52–1.86 m.
3. **The floor read as a magenta carpet.** Pool intensities were roughly 2.5× too high, and the
   floor's mirror share was 0.42. Now 0.24/0.40/0.20 and 0.30 — light on a floor rather than paint.

The LED bars were also 12 cm slabs; a real one is a couple of centimetres.

---

# Auto-exposure, and what "designed for this one song" actually requires

> *some are just too bright … music does not feel like it is fully captured, it cannot be just
> slightly better than the current systems, it really has to be agile and know the music like it
> was designed to play for that one song*

## The blow-out was a conceptual error, not a constant

At the second drop the whole frame went white. Four things compounded, and the root one is that
**my exposure went UP when the room got bright**:

```
ex     = 1.05 + 0.35·haze + 0.30·strobe   ->  1.55 at the drop
strobe beam gain 2.30, head gain 1.55
bloom strength   0.75 + 0.55·haze         ->  1.135
beam density     0.30 + 0.95·haze         ->  0.965, over 20 additive beams
```

A camera in a club **stops down**. So exposure is now driven by the frame's own emitted light:

```
load = mean level across the 22 emitters
ex   = (1.02 + 0.16·haze) / (1 + 2.15·load)
```

At an idle load that is 1.02; at a full drop it is about 0.42 — a two-and-a-half stop pull-down,
computed from the frame, so it is still a pure function of `t` with no state and scrubbing stays
exact. Gains cut to par 0.72 / head 1.05 / strobe 0.95, bloom to 0.42 at threshold 1.05, density
to `0.24 + 0.52·haze`.

## The harder point: completeness of observation does not produce taste

This is worth being exact about, because it is the difference between the project succeeding and
being a slightly better SoundSwitch.

A human designer's show feels written for one song because of five things. Four of them are
missing information, and are now fixable:

| what a designer does | what it needs | state |
|---|---|---|
| hits *that specific* fill, not a class of fill | `accents` — 983 events, 71% off-grid | **done** |
| stops when the music stops | `stems.drums` gating the accent | **done** |
| makes the second chorus bigger than the first | **section identity** — which sections are the *same* | **done, this pass** |
| grows the whole show toward its end | **arc** — position in the song | **done, this pass** |
| chooses a look *for this song* | taste | **not information at all** |

**Section identity is the one that was really missing.** Two chapters both called `drop` were
indistinguishable, so a reader could not make the second bigger than the first — and escalating a
repeat is most of what separates a written show from a reactive one. Sections are now clustered by
cosine similarity of a 19-dimension centroid (six stem presences, energy, twelve chord bins) and
carry an `id`, a `repeat` count and an `arc`. Measured effect: build #2 now runs at ×1.26 against
build #1's ×0.94, and the final drop at ×1.09 against the first drop's ×0.97.

The clustering also **independently re-flagged the segmentation error**. The two builds merged into
one identity `D`; the two drops did *not*, coming out `E` and `G`. That is because "drop 1" is
63.62–107.43, forty-four seconds covering **two** chorus passes with a vocal section between them,
while drop 2 is a single pass. Three separate methods have now pointed at a missing boundary near
78–92 s: the energy dip at 84–88, the vocal returning at 78.860, and now the section clustering
refusing to match the two drops. I have not moved it — Renjith is reviewing by ear in order and is
only at bar 16.

## What cannot be fixed by measuring more

The fifth row. **Taste is not information about the music**, so no amount of completeness in the
observation tier produces it. A perfectly complete map still yields a generic show if the recipe
mapping it to light is generic — and right now the recipe is one hand-written file, v0.5, argued
about by eye.

That is exactly what the correction corpus is for, and it is the part of this project with
long-term value. The path is: get the observation tier complete (nearly there), make corrections
cheap (the fix loop, done), collect enough of them that a preference model can be trained on which
of two fifteen-second versions a human picked, and let *that* choose the look. Until then the
honest description is: **the machine now knows the song thoroughly and still has someone else's
taste.**
