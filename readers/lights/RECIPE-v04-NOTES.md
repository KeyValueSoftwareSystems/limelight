# Recipe v0.4 — the pops, measured and removed

Renjith on v0.3: *"still a lot of sudden pops and flashes instead of the typical smoothness we
expect from real shows."* He was right again, and this time the cause was architectural rather
than a matter of taste.

## Why it popped: a look switched instantaneously

`look(t)` returned one string. At a boundary every fixture jumped to a different formula in a
single frame. No amount of tuning inside a look could fix that, because the discontinuity was
*between* looks.

**v0.4 segments the looks from the map once, then crossfades between them.** The frame stays a
pure function of `t` — the crossfade weight is itself a function of `t`, not a fader holding
state, so scrubbing is still exact and a frame at `t = 47` is still computable cold.

```
into flash   0.03 s    a drop should hit
into stop    0.22 s
into drop    0.30 s
everything   1.10 s
```

## The measurement, because "smooth" is otherwise an opinion

Largest change in any channel between consecutive frames, at 40 fps, across all 7,026 frames of
the song and all 19 fixtures:

| | v0.3 | v0.4 |
|---|---|---|
| median | 0.016 | 0.016 |
| 90th percentile | 0.118 | **0.080** |
| 99th percentile | 0.474 | **0.134** |
| frames jumping > 0.15 | 406 (5.8%) | **6 (0.085%)** |
| where those occur | throughout | **61.5 s, 63.5 s, 140 s, 168.5 s** |

Those four times are a strobe entering at a build tail, the two drops, and the return. **Every
remaining discontinuity is a musical event.** Fog is excluded from the metric: it is a relay, 0
or 1 is physically correct, and its nine-second lag means the room never sees the step.

## Three bugs found by measuring

**The head phase jumped every downbeat.** I had written `th = 2π · t · speed`, which modulates
frequency by multiplying time — so whenever energy changed, the phase moved discontinuously, and
the error grew with `t`. Pan slewed at **2.88 units per second against a 0.45 limit**. The fix is
to integrate rather than multiply: the rate is piecewise constant between downbeats, so the
integral is exact and precomputable as a lookup table derived from the map. Purity is preserved
because it remains a function of `t` and nothing else. Pan now peaks at **0.20 /s**, tilt at
**0.20 /s**, both inside the layout's declared slew limits with headroom.

**`return` ramped from zero**, blacking the room out for a frame before rebuilding. It now ramps
from 0.38.

**The downstage strip stepped from 0 to full on the backbeat** — no attack at all, on the largest
surface in the room. Fades are now 0.28 of a beat, about 130 ms. Below roughly 100 ms a level
change on a large surface reads as a flash rather than a hit, which was the whole complaint.

## The rig is now 19 fixtures

| count | kind | role |
|---|---|---|
| 6 | PAR, back truss | wash with a travelling wave, one pass per four bars |
| 4 | uplight, back wall | a slow colour bed on an eight-bar breath. Depth, almost never pulses |
| 4 | moving head, front truss | the movement and the beat. Mirrored in pairs, lead alternates by bar |
| 2 | strobe | drops and build tails only, ramped in and out |
| 2 | LED strip, 24 px | upstage sweeps over four bars; downstage answers on beats 2 and 4 |
| 1 | fog | commanded nine seconds early |

Moving heads never stop. Pan and tilt are a two-to-one figure whose period is eight bars, the
pairs mirror each other, and speed scales with energy through the integrated phase. `layout.json`
now declares `max_pan_per_s` and `max_tilt_per_s`, and the renderer's test asserts against them —
a recipe that would tear a real motor now fails a check rather than a fixture.

## Still open

`readers/lights/pack/` golden frames remain on v0.2 and are now two recipe versions stale. They
stay that way until the recipe stops moving; regenerating against a target that changes twice a
day is worse for the reader lane than leaving it pinned.
