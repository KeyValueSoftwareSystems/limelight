# arc4-head effects — PROMPT 2 of 2: the 3 bindings

Self-contained task. You are writing 3 Node.js CommonJS lighting-effect modules for
the **arc4-head** rig in `portal/venues/arc4-head/`. Work only on the files listed under
"Your files". Do not touch anything else — another session owns the gestures.

## Your files (create/overwrite these 3 only)
```
follow.js   split.js   accent.js
```
**Do NOT modify:** `helpers.js`, `manifest.json`, `portal/baker.js`, `portal/bakelib.js`,
or any other `*.js` in this folder (the states/gestures are done — **read impact.js and
drone.js as your style reference**).

## The rig
**arc4-head**: 4 × par7 (7ch each, offsets 0, 7, 14, 21) + 1 × head13 (13ch, offset 28) = 41 channels.
- par7: `0 master(=255)  1 R  2 G  3 B  4 strobe`. head13: `0 pan 1 pan_fine 2 tilt 3 tilt_fine 4 speed 5 master 6 strobe 7 colour_wheel 8 gobo 9 prism`.
- Groups: `LEFT=[par_1,par_8]  RIGHT=[par_15,par_22]  INNER=[par_8,par_15]  OUTER=[par_1,par_22]`.

## The helpers module (`const H = require("./helpers");` — `H.` prefix everywhere)
```
H.emptyFrame()  H.clamp(v,lo,hi)  H.parseColour(v,fb)  H.parseColours(v,fb)
H.PARS H.HEADS H.PAR_IDS H.HEAD_IDS H.LEFT H.RIGHT H.INNER H.OUTER  H.parsForExtent(extent)
H.setPar(frame, par, colour, level)   H.setHead(frame, head, {level,colour,pan,tilt,gobo,prism,strobe})
                                      // pan/tilt 0..1 -> 0..255; omit -> park
H.framesPerBeat(bpm)  H.easeInOut  H.hitEnv(t)
```
Head reference (0..1): park pan ≈ 0.662, centre tilt ≈ 0.498. Sweep well within **pan 0.40–0.80, tilt 0.14–0.47**.

## The module contract for BINDINGS (this is the important part)
A binding is a **live** effect: it does not return a fixed animation, it returns a `render`
function the baker calls **once per output frame** with the measured stream value AND the
frame time:

```js
module.exports = function follow(params, ctx) {          // ctx = { fps:40, bpm, layout }
  const bpm = ctx.bpm;
  function render(value, t) {        // value = live 0..1 (see below); t = seconds into the show
    const frame = H.emptyFrame();
    // ...paint pars + head from `value`, and you MAY move the head using `t`...
    return frame;                    // one 41-element DMX array
  }
  return {
    binding: true,
    render,
    frames: [render(0.3, 0)],        // a preview frame (baker uses render(), but include this)
    loop_beats: 0,
    per_fixture: [...ids this drives..., ...H.HEAD_IDS],
  };
};
```

What `value` is, per binding:
- **follow** → a scalar `0..1` (one instrument's live level).
- **split** → a two-element array `[left, right]`, each `0..1` (two instruments' live levels).
- **accent** → a scalar `0..1` (a drum-onset envelope; peaks on hits, near 0 between them).

Key points:
- The baker feeds the **real, changing** stream value every frame (it used to feed a constant —
  that is fixed). So a flat-looking render is a bug in your math, not the data.
- `t` (seconds) lets the head move on its own slow clock even when `value` is steady — compute a
  beat phase with `const beat = t * bpm / 60;`. **Do not** hand-limit pan/tilt per frame; the
  baker slew-limits the head centrally.
- `render` must be pure and cheap (called thousands of times) and tolerate `value` being 0.
- Always `"use strict";` and `const H = require("./helpers");`.

## The 3 effects to build
1. **follow** — `params: {stream, depth, extent, smooth}`. `render(v, t)`: the extent's pars sit
   at `v × depth`, but keep a small floor so it stays **alive even at low values** (e.g. a warm
   glow that never fully dies). Head master follows the level; head pan oscillates **slowly**
   using `t` (a full sweep over ~8 beats). Warm colour.
2. **split** — `params: {streams, colours}`. `render([left, right], t)`: LEFT pars in
   `colours[0]` at `left`, RIGHT pars in `colours[1]` at `right`. The head pans **toward whichever
   side is louder** (continuous: pan tracks the left/right balance) and takes the louder side's
   colour. Parse colours with `H.parseColours(params.colours, [[...],[...]])`.
3. **accent** — `params: {threshold, extent, for_beats}`. `render(v, t)`: when `v > threshold`,
   **flash** the extent's pars white at full and pop the head (bright + a strobe kick); when
   `v ≤ threshold`, pars are very dim or off. It should read as sharp flashes on the beats that
   matter, dark between.

## Test each module
```
node portal/venues/test-effect.js arc4-head follow --bpm 120
node portal/venues/test-effect.js arc4-head split  --bpm 120
node portal/venues/test-effect.js arc4-head accent --bpm 120
```
Quick sanity that render actually varies with the value (the old bug was a constant):
```
node -e 'const f=require("./portal/venues/arc4-head/follow.js")({depth:0.7,extent:"all"},{fps:40,bpm:120});
console.log("v=0.2 ->", f.render(0.2,0).slice(1,4), " v=0.9 ->", f.render(0.9,0).slice(1,4));'
node -e 'const s=require("./portal/venues/arc4-head/split.js")({colours:["#3366cc","#ff8833"]},{fps:40,bpm:120});
const x=s.render([0.9,0.1],0); console.log("left par_1 RGB", x.slice(1,4), "right par_22 RGB", x.slice(22,25));'
```
Then bake end-to-end with a plan that binds them (e.g. a section with `follow`/`split`/`accent`):
```
node portal/baker.js hub/files/score/raga-of-revenge.score <a-plan-with-bindings>.json \
  --rig arc4-head --lights /tmp/out.lights.json
```

## Acceptance
- `render(low)` and `render(high)` produce clearly different frames (follow/accent), and
  `split.render([0.9,0.1])` lights the LEFT pars and `split.render([0.1,0.9])` lights the RIGHT.
- The head moves under a steady value (via `t`) for follow.
- A bake using the bindings shows the pars tracking the music (not flat, not black), with no
  pan/tilt jump >7 per frame (the baker enforces the latter).
```
```
