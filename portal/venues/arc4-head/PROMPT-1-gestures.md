# arc4-head effects — PROMPT 1 of 2: the remaining 5 gestures

Self-contained task. You are writing 5 Node.js CommonJS lighting-effect modules for
the **arc4-head** rig in `portal/venues/arc4-head/`. Work only on the files listed
under "Your files". Do not touch anything else — another session owns the bindings.

## Your files (create/overwrite these 5 only)
```
isolate.js   strip.js   cut.js   swell.js   gear.js
```
**Do NOT modify:** `helpers.js`, `manifest.json`, `portal/baker.js`, `portal/bakelib.js`,
or any other `*.js` in this folder (drone/wash/impact/blackout/hush/ramp/stab/lift/trade
are already done — **read them as your style reference**).

## The rig
**arc4-head**: 4 × par7 (7ch each, offsets 0, 7, 14, 21) + 1 × head13 (13ch, offset 28) = 41 channels.
- par7: `0 master(=255)  1 R  2 G  3 B  4 strobe  5-6 keep_zero` — brightness is baked into RGB.
- head13: `0 pan  1 pan_fine  2 tilt  3 tilt_fine  4 speed  5 master  6 strobe  7 colour_wheel  8 gobo  9 prism`.
- Groups: `INNER=[par_8,par_15]  OUTER=[par_1,par_22]  LEFT=[par_1,par_8]  RIGHT=[par_15,par_22]  ENDS=[par_1,par_22]`.

## The helpers module (`const H = require("./helpers");` — use the `H.` prefix everywhere)
```
H.emptyFrame()                       // new Array(41).fill(0)
H.clamp(v, lo, hi)
H.parseColour(v, fallback)           // hex/name/[r,g,b] -> [r,g,b] 0..1
H.parseColours(v, fallback)          // -> array of [r,g,b]
H.PARS, H.HEADS, H.PAR_IDS, H.HEAD_IDS, H.INNER, H.OUTER, H.LEFT, H.RIGHT, H.ENDS
H.parsForExtent(extent)              // "all|inner|outer|left|right|ends|single" -> [{id,offset}]
H.setPar(frame, par, colour, level)  // par is {id,offset}; colour 0..1; level 0..1
H.setParStrobe(frame, par, hz)
H.setHead(frame, head, opts)         // opts {level, colour, pan, tilt, gobo, prism, strobe}
                                     //   pan/tilt are 0..1 (mapped to 0..255); omit -> parks
H.framesPerBeat(bpm)                 // Math.round(40*60/bpm)
H.easeLinear, H.easeInOut, H.easeSettle, H.easeCurve(name)   // t:0->1
H.hitEnv(t)      // sharp attack, ~300ms decay
H.swellEnv(t, rise)  // rise to peak then fall
```
Head reference values (0..1): park pan ≈ 0.662, park/centre tilt ≈ 0.498, audience tilt ≈ 0.157.
Sweep ranges that read well: **pan 0.40–0.80, tilt 0.14–0.47**.

## The module contract (READ THIS — it changed)
Every module exports one function `(params, ctx) => result`, where `ctx = { fps:40, bpm, layout }`.

- **Gestures return `{ frames:[...41-elem arrays...], loop_beats: 0, per_fixture:[ids] }`.**
  The baker plays the frames **once, stretched across the gesture's span**. Generate frames
  at roughly one per output frame for smoothness: `N = H.framesPerBeat(ctx.bpm) * beats`
  where `beats` is the effect's duration dial (`for_beats` / `over_beats`), or ~8 if the
  effect has no duration dial (the frames stretch to whatever span the baker gives).
- **`per_fixture`** lists exactly the fixture ids this effect drives (the pars it lights +
  `H.HEAD_IDS` when it moves/lights the head). The baker only fills those fixtures.
- **The head must MOVE** in most gestures — sweep pan, oscillate tilt, snap on hits. A parked
  head wastes the most striking fixture.
- **Do NOT hand-limit pan/tilt change per frame.** The baker slew-limits the head centrally
  (≤7 DMX/frame, from the fixture profile). Just author a *smooth* path; the baker keeps it safe.
- Always `"use strict";` and `const H = require("./helpers");` at the top.

## The 5 effects to build
1. **isolate** — `params: {which, colour, rest}`. One lamp highlighted: the target par at
   `colour × ~0.7`, all other pars at `rest` level in grey, the head aims at the isolated par
   (pan toward that fixture's horizontal position — leftmost par → low pan, rightmost → high).
   Rest of the rig nearly dark. Holds for its span (a few frames of gentle life is fine).
   `which` may be a par index (number) or id (string); default to the middle par. Needs ≥3
   lamps to read as isolation — 4 pars is fine here.
2. **strip** — `params: {to, over_beats}`. Controlled pullback: pars fade down to `to` on a
   settle curve; head dims and tilt drops. **Sequential** — the OUTER pars fade first, the
   INNER pars a beat later (stagger the start of each pair's fade across the duration).
3. **cut** — `params: {for_beats}`. Momentary silence: all pars to zero, head master to zero
   (keep pan/tilt at park so the beam doesn't lurch back). Short.
4. **swell** — `params: {colour, for_beats, rise}`. Bloom: pars rise to a peak then fall
   (`H.swellEnv(t, rise)`); head level follows the same envelope; the head does a slow tilt
   sweep UP on the rise and back DOWN on the fall; head colour matches the pars.
5. **gear** — `params: {from, to}`. Rate shift: a pulsing pattern at the new rate
   (`to/from × bpm` feel). Pars pulse on a sine; the head oscillates its pan faster than the
   pars. This is about a rhythm change, so make it **loop** — return `loop_beats: 2` (or a
   small integer) and generate exactly `H.framesPerBeat(bpm) * loop_beats` frames so it tiles.

## Test each module
```
node portal/venues/test-effect.js arc4-head isolate --bpm 120
node portal/venues/test-effect.js arc4-head strip   --bpm 120
node portal/venues/test-effect.js arc4-head cut     --bpm 120
node portal/venues/test-effect.js arc4-head swell   --bpm 120
node portal/venues/test-effect.js arc4-head gear    --bpm 120
```
Then an end-to-end bake to confirm they compose (needs the score + a plan that uses them):
```
node portal/baker.js hub/files/score/raga-of-revenge.score \
  portal/work/raga-of-revenge-handcrafted.plan.json --rig arc4-head --lights /tmp/out.lights.json
```

## Acceptance
- All 5 modules load and run without error.
- Each returns multiple frames; the head moves in isolate/strip/swell/gear (cut parks it dark).
- gear tiles cleanly (`loop_beats` set, frame count = `framesPerBeat*loop_beats`).
- A bake using them produces lit, non-static output and no pan/tilt jump >7 per frame
  (the baker enforces the latter — just confirm it bakes clean).
```
```
