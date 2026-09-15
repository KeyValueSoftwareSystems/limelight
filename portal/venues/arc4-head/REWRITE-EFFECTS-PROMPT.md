# Rewrite the 17 DMX effect functions for the arc4-head rig

## Context

You are rewriting the lighting effect modules in `portal/venues/arc4-head/`. Each effect is a Node.js CommonJS module that produces raw DMX frames for a small lighting rig. The current versions are too static — states are flat single-frame looks, gestures are basic fades, and the moving head is almost always parked. The result looks dead on screen and on the physical rig.

## The rig

**arc4-head**: 4 × par7 (7ch each) + 1 × head13 (13ch) = 41 DMX channels, universe 0.

### par7 channels (×4, at offsets 0, 7, 14, 21)
| Offset | Role       | Notes                              |
|--------|------------|------------------------------------|
| 0      | master     | Always set to 255. Brightness is baked into RGB. |
| 1      | R          | 0–255                              |
| 2      | G          | 0–255                              |
| 3      | B          | 0–255                              |
| 4      | strobe     | 0 = off, 1–255 = slow→fast         |
| 5–6    | keep_zero  |                                    |

### head13 channels (×1, at offset 28)
| Offset | Role         | Notes                                  |
|--------|--------------|----------------------------------------|
| 0      | pan          | 0–255, centre ≈ 169                    |
| 1      | pan_fine     | 0–255                                  |
| 2      | tilt         | 0–255, centre ≈ 127, audience ≈ 40     |
| 3      | tilt_fine    | 0–255                                  |
| 4      | speed        | 0 = slow, 200 = fast (use 200)         |
| 5      | master       | 0–255 overall brightness               |
| 6      | strobe       | 0 = off, 1–255 = slow→fast             |
| 7      | colour_wheel | see values below                       |
| 8      | gobo         | 0 = open, 80 = flower                  |
| 9      | prism        | 0 = off, 100 = six-facet               |
| 10–12  | keep_zero    |                                        |

### Colour wheel values
white=4, red=20, yellow=36, blue=52, green=68, pink=84, orange=100, light_blue=116

### Head movement rules
- The head should MOVE in most effects. In the old (working) pipeline, the head sweeps continuously: pan oscillates ~100↔203, tilt ~31↔120. This makes the single beam cut through the room.
- Use sinusoidal or triangular oscillation for pan/tilt over the beat duration.
- Max safe pan/tilt change per frame: 7 DMX values.
- Park position: pan=169 tilt=127. Only park when the effect explicitly calls for stillness.

### Fixture groups
```
PARS  = [{id:"par_1", offset:0}, {id:"par_8", offset:7}, {id:"par_15", offset:14}, {id:"par_22", offset:21}]
HEADS = [{id:"head", offset:28}]
INNER = [par_8, par_15]
OUTER = [par_1, par_22]
LEFT  = [par_1, par_8]
RIGHT = [par_15, par_22]
ENDS  = [par_1, par_22]
```

## The helpers module

You have `helpers.js` (do NOT modify it) with these exports:

```js
// Constants
TOTAL_CH, FPS (40), PAR, HEAD, COLOUR_WHEEL, HEAD_PARK
PARS, HEADS, ALL_FIXTURES, PAR_IDS, HEAD_IDS
INNER, OUTER, LEFT, RIGHT, ENDS

// Fixture selection
parsForExtent(extent)         // "all"|"inner"|"outer"|"left"|"right"|"ends"|"single" → [{id, offset}]
fixtureIdsForExtent(extent)   // same but returns string[]

// Frame helpers
emptyFrame()                  // new Array(41).fill(0)
clamp(v, lo, hi)

// Colour
parseColour(v, fallback)      // hex string, named colour, [r,g,b] 0-1 or 0-255 → [r,g,b] 0-1
parseColours(v, fallback)     // array of colours
rgb255(rgb)                   // [r,g,b] 0-1 → [R,G,B] 0-255
nearestWheelColour(rgb)       // → {name, value, rgb}

// Set fixture channels
setPar(frame, par, colour, level)     // master=255, R/G/B = colour*level
setParStrobe(frame, par, hz)          // 0 = off
setHead(frame, head, opts)            // opts: {level, colour, pan, tilt, gobo, prism, strobe}
                                      // pan/tilt: 0-1 (maps to 0-255)
                                      // if pan/tilt omitted → HEAD_PARK values

// Timing
framesPerBeat(bpm)            // Math.round(FPS * 60 / bpm)

// Easing (t: 0→1)
easeLinear(t), easeInOut(t), easeSettle(t), easeCurve(name)

// Envelopes (t: 0→1)
hitEnv(t)     // sharp attack, 300ms decay: t<0.08 → 1, then fades to 0
swellEnv(t, rise)  // rise then fall: t<rise → t/rise, else 1→0
```

## Module signature

Every effect module exports a single function:

```js
module.exports = function effectName(params, ctx) {
  // params: effect dial values from the show plan
  // ctx: { fps: 40, bpm: number, layout: object }
  
  return {
    frames: [frame, frame, ...],   // array of 41-element DMX arrays
    loop_beats: N,                  // 0 for bindings, N for looping effects
    per_fixture: ["par_1", ...],    // fixture IDs this effect drives
    // for bindings only:
    binding: true,
    render: function(laneValue) { ... },  // returns a single frame
  };
};
```

## The 17 effects to rewrite

### States (loop a short animation — NOT a single static frame)

1. **drone** — `params: {amount, colour, extent}`. Low ambient. MUST animate: slow gentle breathing on the pars (±15% of amount over 4 beats), head gently nodding tilt ±5 at low level. NOT a static frame.

2. **wash** — `params: {amount, colour, extent}`. Mid-level fill. MUST animate: slow colour-shift cycling (±10% RGB variation over 8 beats), head sweeping pan slowly across the rig (sinusoidal, full travel over 8 beats), head master at amount×0.7.

### Gestures (bounded departures)

3. **impact** — `params: {colour, extent, for_beats}`. Full flash. All pars to max, head to max with strobe at 15hz for first 2 frames, head snaps to centre, prism ON for 4 frames then off. Sharp attack, hard decay.

4. **blackout** — `params: {for_beats}`. Everything to zero. Head master 0 but keep pan/tilt at last known position (use HEAD_PARK). Total darkness.

5. **hush** — `params: {depth, for_beats, keep}`. Levels fall. Pars fade from current towards depth×amount. Head dims and tilt drifts down slowly. Eased settle curve.

6. **ramp** — `params: {to, curve}`. Rising build. Pars go from near-black to `to` level over the duration. Head level rises, pan starts narrow (centre) and widens to full sweep, tilt rises. Colour warms as it rises (shift toward amber). This should feel like tension building.

7. **stab** — `params: {colour, extent, for_beats}`. Partial hit. Selected pars flash using hitEnv. Head does a quick snap to a random position and back. Not all fixtures — only the extent.

8. **lift** — `params: {by, over_beats, tilt}`. Sustained rise. Pars brighten by `by` with settle curve. Head tilt moves upward, level increases. Holds at the new level (does not return).

9. **trade** — `params: {colours, for_beats, travel}`. Left↔right handoff. First half: left pars ON in colour[0], right dim. Second half: swap. Head pans from left to right to match. Should feel like a call-and-response.

10. **isolate** — `params: {which, colour, rest}`. One lamp highlighted. Target par at colour/0.7, all others at rest level (grey). Head aims at the isolated par (pan toward that fixture's position). Rest of rig nearly dark.

11. **strip** — `params: {to, over_beats}`. Controlled pullback. Pars fade down to `to` with settle curve. Head dims, tilt drops. Sequential — outer pars dim first, then inner.

12. **cut** — `params: {for_beats}`. Momentary silence. All zeros for the duration. Head zeroed.

13. **swell** — `params: {colour, for_beats, rise}`. Bloom. Pars rise to peak then fall (swellEnv). Head level follows the envelope. Head does a slow tilt sweep up on the rise, back down on the fall. Colour on head matches pars.

14. **gear** — `params: {from, to}`. Rate shift. Generate a pulsing pattern at the new rate (to/from × bpm). Pars pulse with a sine wave. Head oscillates pan faster. This is about rhythm change.

### Bindings (live render function)

15. **follow** — `params: {stream, depth, extent, smooth}`. Returns `render(laneValue)` where laneValue is 0–1. Pars at laneValue×depth. Head master follows. Head pan oscillates slowly. Must feel alive even at low values.

16. **split** — `params: {streams, colours}`. Returns `render([leftValue, rightValue])`. Left pars in colour[0] at leftValue, right pars in colour[1] at rightValue. Head pans toward whichever side is louder.

17. **accent** — `params: {threshold, extent, for_beats}`. Returns `render(onsetValue)`. When onsetValue > threshold: flash pars white at full, head strobe for 1 frame. When below: very dim or off.

## Critical requirements

1. **The head must MOVE in most effects.** Sweep pan sinusoidally, oscillate tilt. Use the beat timing (ctx.bpm, framesPerBeat) to make movement musical. The head is the most visually striking fixture — parking it wastes it.

2. **States must NOT be a single frame.** Generate multiple frames that loop. A drone should breathe. A wash should have subtle movement. Generate at least 4 beats of frames for states.

3. **Gestures should be punchy.** Use the head's strobe, prism, and gobo for impacts. Use snap movements for stabs. Use slow sweeps for ramps and swells.

4. **Use `H.` prefix for all helper calls** (e.g., `H.emptyFrame()`, `H.setPar(...)`, `H.setHead(...)`, `H.parseColour(...)`).

5. **Always `"use strict";`** at the top. Always `const H = require("./helpers");`.

6. **Test each module** by running: `node portal/venues/test-effect.js arc4-head <effect> --bpm 120`

## File list to create/overwrite

Create these 17 files in `portal/venues/arc4-head/`:
```
drone.js, wash.js, impact.js, blackout.js, hush.js, ramp.js, stab.js,
lift.js, trade.js, isolate.js, strip.js, cut.js, swell.js, gear.js,
follow.js, split.js, accent.js
```

Do NOT modify `helpers.js` or `manifest.json`.
