# Recipe v0.3 — why the room stopped popping at random

Renjith's note on v0.2: *"the lights are unnatural… it has to feel rhythmic instead of random
pops."* He was describing a design failure, not a rendering one.

## What was wrong

Every one of the nine fixtures was driven by the same beat pulse. All four PARs pulsed together
126 times a minute, both strips ran the same comet, and the colour flipped on every beat. Music is
nested — beat inside bar inside four bars inside section — and v0.2 used only the fastest layer,
so the room had no rhythm to read. It had a flicker rate.

## Four clocks, not one

| clock | period here | what it drives |
|---|---|---|
| beat | 0.476 s | the accent, on two fixtures only, with a rest after it |
| bar | 1.905 s | which fixture leads, and the only moment colour may change |
| 4 bars | 7.62 s | spatial motion — the upstage sweep completes once per phrase |
| energy | the whole song | the floor everything sits on, and how busy the accents get |

## Roles, not four copies of one behaviour

This is the actual fix. v0.2 gave all four PARs identical behaviour with different depths, which
is still unison.

- **`par_1`, `par_4` — wash.** A continuous base that breathes once per bar and never pulses on
  the beat. The room is therefore never dark between beats, which is what stops it reading as
  flashing.
- **`par_2`, `par_3` — accent.** These carry the beat, and **which one leads alternates every
  bar**, so there is a left–right conversation at bar rate instead of a four-way strobe.
- **`strip_1` upstage — motion.** A sweep that takes four bars to cross. Slow enough to read as
  movement rather than flicker.
- **`strip_2` downstage — the answer.** Fires on beats **2 and 4** only. Since the PARs accent on
  1 and 3 at moderate energy, the room converses with itself instead of shouting in unison.

Busyness rises with energy: below 0.35 the accents land on downbeats only, below 0.60 on 1 and 3,
above that on all four. The room gets denser as the music does, without a new field.

## Anticipation — the thing a microphone can never do

Over the **bar before a drop**, every level is multiplied down to about a quarter. The room drains,
and then the drop hits a dark room. Measured on the real map: `0.24 → 0.18 → 0.15 → 0.11 → 0.08 →
0.07 → flash 1.00`.

This is only possible because the map knows the future. A competitor reacting to a live microphone
is always at least one beat late and can never dip *before* an event it has not heard yet. It is
the single most visible payoff of pre-analysis, and it costs one line.

## Build layering

Inside a build span, one element joins every quarter of the span — inner PARs, then the wash, then
the upstage sweep, then the downstage answer. The room fills the way the arrangement does, which
is what `rise` was always describing.

## Consequence for the reader lane

**v0.3 invalidates the golden frames in `readers/lights/pack/`.** That is the versioning clause
working as designed rather than a problem: the recipe changed, so the golden files are regenerated
and the checker re-run. They will not be regenerated until the recipe stops moving — Renjith has
not yet judged v0.3 — because handing Dheeraj a moving target is worse than handing him v0.2.
