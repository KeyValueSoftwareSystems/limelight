/* frame.js tests -- dynamics-driven PAR hits, a lively head, and the contrast
   overrides. Pure in position. Plain node idiom. */
"use strict";
const { frame } = require("./frame.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 1e-6 : e);

const RIG = { rig: "arc4-head", fixtures: [
  { id: "par_1", type: "par7", angle_deg: -32.5 }, { id: "par_8", type: "par7", angle_deg: -17 },
  { id: "par_15", type: "par7", angle_deg: 17 }, { id: "par_22", type: "par7", angle_deg: 32.5 },
  { id: "head", type: "head13" } ] };
const LIB = {
  hold_x: { id: "hold_x", kind: "individual", gesture: {
    group: "all_pars", keys: [{ intent: { colour: [1, 0, 0] } }] } },
  head_x: { id: "head_x", kind: "individual", gesture: {
    group: "head", keys: [{ intent: { colour: "white", tilt: 0.5 } }] } },
  pair_x: { id: "pair_x", kind: "individual", gesture: {
    pattern: "inner_outer_alternation", group: "all_pars", keys: [
      { at: 0, target: "inner", intent: { level: 0.95, colour: [1, 0, 0] } },
      { at: 0, target: "outer", intent: { level: 0 } },
      { at: 1, target: "inner", intent: { level: 0 } },
      { at: 1, target: "outer", intent: { level: 0.95, colour: [0, 0.25, 1] } } ] } },
};
const CTX = { layout: RIG, library: LIB };
const g = (F, id) => F.fixtures.find(f => f.id === id).intent;
const par = (params) => ({ grid: { beats_per_bar: 4 },
  assignments: [{ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "hold_x", layer: "par", priority: 0, params }] });

/* ---- the hard hit: spike on the beat, floor between -------------------- */
{
  const plan = par({ floor: 0.55, peak: 1, mode: "hit", intensity: 1 });
  const onBeat = g(frame({ bar: 1, beat: 1 }, plan, CTX), "par_1");
  const between = g(frame({ bar: 1, beat: 1.5 }, plan, CTX), "par_1");
  ok("a hit spikes to the peak on the beat", near(onBeat.level, 1.0, 0.02), "on " + onBeat.level);
  ok("and falls to the floor between beats", near(between.level, 0.55, 0.02), "between " + between.level);
  ok("colour comes from the gesture", JSON.stringify(onBeat.colour) === JSON.stringify([1, 0, 0]));
}

/* ---- contrast: a low floor makes the same peak hit harder ------------- */
{
  const hi = g(frame({ bar: 1, beat: 1.5 }, par({ floor: 0.12, peak: 1, mode: "hit", intensity: 1 }), CTX), "par_1");
  ok("a breakdown floor (0.12) sits far below a drop floor (0.55)", near(hi.level, 0.12, 0.02), "floor " + hi.level);
}

/* ---- pair-alt (inner/outer call-and-response): the fixes -------------- */
{
  const planP = { grid: { beats_per_bar: 4 }, assignments: [{
    from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "pair_x", layer: "par",
    priority: 0, params: { floor: 0.12, peak: 1, mode: "hit", intensity: 1 } }] };
  const f0 = frame({ bar: 1, beat: 1 }, planP, CTX);   // globalBeat 0 -> inner active
  const inner0 = g(f0, "par_8"), outer0 = g(f0, "par_1");
  ok("pair-alt: inner takes the inner colour (red)", JSON.stringify(inner0.colour) === JSON.stringify([1, 0, 0]));
  ok("pair-alt: outer takes the OUTER colour (blue), not the fallback red",
     JSON.stringify(outer0.colour) === JSON.stringify([0, 0.25, 1]), JSON.stringify(outer0.colour));
  ok("pair-alt: active pair full up, off pair fully OFF (not floor)",
     near(inner0.level, 1, 1e-3) && outer0.level === 0, `in ${inner0.level} out ${outer0.level}`);
  const f1 = frame({ bar: 1, beat: 2 }, planP, CTX);   // globalBeat 1 -> outer active
  ok("pair-alt: the pairs trade on the next beat",
     g(f1, "par_1").level === 1 && g(f1, "par_8").level === 0,
     `outer ${g(f1, "par_1").level} inner ${g(f1, "par_8").level}`);
  const mid = g(frame({ bar: 1, beat: 1.5 }, planP, CTX), "par_8");  // between beats
  ok("pair-alt: the active pair stays held between beats (no hit-envelope dip)",
     near(mid.level, 1, 1e-3), "held " + mid.level);
}

/* ---- the head is always alive and moving ------------------------------ */
{
  const plan = { grid: { beats_per_bar: 4 }, assignments: [
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "head_x", layer: "head", priority: 1, params: { headDim: 0.9, motion: 0.5 } }] };
  const h1 = g(frame({ bar: 1, beat: 1 }, plan, CTX), "head");
  const h2 = g(frame({ bar: 1, beat: 2 }, plan, CTX), "head");
  ok("the head is lit and aimed", h1.level > 0 && h1.pan != null, JSON.stringify(h1));
  ok("the head pan moves over time", h1.pan !== h2.pan, `${h1.pan} vs ${h2.pan}`);
}

/* ---- whole rig alive: par AND head together --------------------------- */
{
  const plan = { grid: { beats_per_bar: 4 }, assignments: [
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "hold_x", layer: "par", priority: 0, params: { floor: 0.55, peak: 1, mode: "hit", intensity: 1 } },
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "head_x", layer: "head", priority: 1, params: { headDim: 0.9, motion: 0.8 } }] };
  const F = frame({ bar: 1, beat: 1 }, plan, CTX);
  ok("pars and head are both lit at once", g(F, "par_1").level > 0 && g(F, "head").level > 0);
}

/* ---- contrast overrides: blackout and white blast --------------------- */
{
  const plan = { grid: { beats_per_bar: 4 }, assignments: [
    { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "hold_x", layer: "par", priority: 0, params: { floor: 0.6, peak: 1, mode: "hit", intensity: 1 } },
    { from: { bar: 2, beat: 1 }, to: { bar: 2, beat: 2 }, type: "blackout", priority: 9 },
    { from: { bar: 3, beat: 1 }, to: { bar: 3, beat: 2 }, type: "white_blast", priority: 9 }] };
  const blk = frame({ bar: 2, beat: 1 }, plan, CTX);
  ok("blackout takes the whole rig dark", blk.fixtures.every(f => f.intent.level === 0));
  const blast = frame({ bar: 3, beat: 1 }, plan, CTX);
  ok("white blast fires every fixture full", blast.fixtures.every(f => f.intent.level === 1));
  ok("blast pars are white", JSON.stringify(g(blast, "par_1").colour) === JSON.stringify([1, 1, 1]));
  ok("frame stays deterministic",
     JSON.stringify(frame({ bar: 2, beat: 1 }, plan, CTX)) === JSON.stringify(blk));
}


/* =========================================================================
   The finer structure at render time: weighted hits, pauses, hooks, subsection
   modulation, per-bar texture lanes and harmony-tinted colour.
   ========================================================================= */
const base = () => ({ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "hold_x", layer: "par", priority: 0,
  params: { floor: 0.5, peak: 1, mode: "hit", intensity: 1 } });
const headA = () => ({ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, seq_id: "head_x", layer: "head", priority: 1,
  params: { headDim: 0.8, motion: 0.5 } });
const P = (extra, more) => ({ grid: { beats_per_bar: 4 }, assignments: [base(), headA(), ...(extra || [])], ...(more || {}) });

/* ---- a hit's strength scales the blast; a full-weight blast is the old one ---- */
{
  const strong = frame({ bar: 2, beat: 1 }, P([{ from: { bar: 2, beat: 1 }, to: { bar: 2, beat: 2 }, type: "white_blast", priority: 9, params: { strength: 1 } }]), CTX);
  ok("a full-strength blast fires every fixture full", strong.fixtures.every(f => f.intent.level === 1));
  const light = frame({ bar: 2, beat: 1 }, P([{ from: { bar: 2, beat: 1 }, to: { bar: 2, beat: 2 }, type: "white_blast", priority: 9, params: { strength: 0.4 } }]), CTX);
  ok("a light blast is dimmer than a full one but still white",
     g(light, "par_1").level < 1 && g(light, "par_1").level >= 0.6 && JSON.stringify(g(light, "par_1").colour) === "[1,1,1]", `${g(light, "par_1").level}`);
  ok("a light blast leaves the head's prism alone", !g(light, "head").prism && g(strong, "head").prism === true);
}

/* ---- a pause sits the rig down for its beats, scaled by weight ---------------- */
{
  const plain = frame({ bar: 3, beat: 1 }, P(), CTX);
  const paused = frame({ bar: 3, beat: 1 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 4, beat: 1 }, type: "pause", priority: 8, params: { strength: 0.5, still: ["bass"] } }]), CTX);
  ok("a pause dims the pars well below the base hit", g(paused, "par_1").level < 0.6 * g(plain, "par_1").level, `${g(paused, "par_1").level} vs ${g(plain, "par_1").level}`);
  ok("a pause dims the head too", g(paused, "head").level < g(plain, "head").level);
  ok("a pause keeps the colour (it is a hush, not a blackout)", JSON.stringify(g(paused, "par_1").colour) === JSON.stringify(g(plain, "par_1").colour) && g(paused, "par_1").level > 0);
  const hard = frame({ bar: 3, beat: 1 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 4, beat: 1 }, type: "pause", priority: 8, params: { strength: 1, still: [] } }]), CTX);
  ok("a heavier pause hushes harder", g(hard, "par_1").level < g(paused, "par_1").level);
  const after = frame({ bar: 4, beat: 1 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 4, beat: 1 }, type: "pause", priority: 8, params: { strength: 0.5 } }]), CTX);
  ok("the beat after the pause is back to the base", after.fixtures[0].intent.level === plain.fixtures[0].intent.level);
}

/* ---- a hook lifts the look and puts the prism in ----------------------------- */
{
  const plain = frame({ bar: 3, beat: 1.5 }, P(), CTX);
  const hooked = frame({ bar: 3, beat: 1.5 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 5, beat: 1 }, type: "hook", priority: 7, params: { strength: 0.8 } }]), CTX);
  ok("a hook lifts the PAR level between hits", g(hooked, "par_1").level > g(plain, "par_1").level, `${g(hooked, "par_1").level} vs ${g(plain, "par_1").level}`);
  ok("a strong hook turns the head's prism on", g(hooked, "head").prism === true && !g(plain, "head").prism);
}

/* ---- subsection modulation: gain on the pars, motion on the head --------------- */
{
  const plain = frame({ bar: 3, beat: 1.5 }, P(), CTX);
  const quieter = frame({ bar: 3, beat: 1.5 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 5, beat: 1 }, type: "modulate", priority: 4, params: { gain: 0.8, motion: 0 } }]), CTX);
  ok("a modulation gain of .8 scales the PAR level by .8", near(g(quieter, "par_1").level, 0.8 * g(plain, "par_1").level, 0.01), `${g(quieter, "par_1").level}`);
  const faster = frame({ bar: 3, beat: 2.3 }, P([{ from: { bar: 3, beat: 1 }, to: { bar: 5, beat: 1 }, type: "modulate", priority: 4, params: { gain: 1, motion: 0.4 } }]), CTX);
  const still = frame({ bar: 3, beat: 2.3 }, P(), CTX);
  ok("a motion lift changes the head's sweep", g(faster, "head").pan !== g(still, "head").pan, `${g(faster, "head").pan} vs ${g(still, "head").pan}`);
}

/* ---- texture lanes: per bar, width closes the arc, pace drives the head --------- */
{
  const lanes = { from_bar: 1, width: [0, 1, 0.5, 0.5, null, 0.5, 0.5, 0.5], pace: [0.5, 0.5, 0, 1, 0.5, 0.5, 0.5, 0.5],
    pump: [0.5, 0.5, 0.5, 0.5, 0, 1, 0.5, 0.5], brightness: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0, 1], air: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    drums: [1, 1, 1, 1, 1, 1, 1, 0.1], vocals: [0, 0, 0, 0, 0, 0, 0, 0.9] };
  const plan = P([{ from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, type: "accent_strobe", priority: 2, params: { strength: 0.8 } }], { lanes });
  const narrow = frame({ bar: 1, beat: 1 }, plan, CTX), wide = frame({ bar: 2, beat: 1 }, plan, CTX);
  ok("a narrow bar dims the outer pars against the inner", g(narrow, "par_1").level < g(narrow, "par_8").level, `${g(narrow, "par_1").level} vs ${g(narrow, "par_8").level}`);
  ok("a wide bar lights the outer pars as full as the inner", near(g(wide, "par_1").level, g(wide, "par_8").level, 0.01));
  const slow = frame({ bar: 3, beat: 2.3 }, plan, CTX), fast = frame({ bar: 4, beat: 2.3 }, plan, CTX);
  ok("pace moves the head's sweep", slow.fixtures.find(f => f.id === "head").intent.pan !== fast.fixtures.find(f => f.id === "head").intent.pan);
  const soft = frame({ bar: 5, beat: 1.5 }, plan, CTX), pumped = frame({ bar: 6, beat: 1.5 }, plan, CTX);
  ok("a deeper pump drops the floor between hits (a harder hit)", g(pumped, "par_8").level < g(soft, "par_8").level, `${g(pumped, "par_8").level} vs ${g(soft, "par_8").level}`);
  const dull = frame({ bar: 7, beat: 1 }, plan, CTX), bright = frame({ bar: 8, beat: 1 }, plan, CTX);
  ok("a bright bar whitens the colour", g(bright, "par_8").colour[1] > g(dull, "par_8").colour[1], `${g(bright, "par_8").colour} vs ${g(dull, "par_8").colour}`);
  ok("the strobe accent fires while the drums are in", g(dull, "par_8").strobe > 0);
  ok("the strobe accent stays quiet on a bar where the drums are out", !g(bright, "par_8").strobe);
  ok("a vocal bar lifts the head", g(bright, "head").level > g(dull, "head").level, `${g(bright, "head").level} vs ${g(dull, "head").level}`);
  ok("a null lane bar renders like the neutral middle", near(g(frame({ bar: 5, beat: 1 }, plan, CTX), "par_1").level, g(frame({ bar: 3, beat: 1 }, plan, CTX), "par_1").level, 0.01));
}

/* ---- harmony tints the colour bar by bar -------------------------------------- */
{
  const harmony = { from_bar: 1, hue: [0.0, 0.5, 0.5, null], minor: [false, false, true, null], sure: [0.9, 0.9, 0.9, 0.9], key: { hue: 0, minor: false } };
  const plan = P([], { harmony });
  const c1 = g(frame({ bar: 1, beat: 1 }, plan, CTX), "par_1").colour, c2 = g(frame({ bar: 2, beat: 1 }, plan, CTX), "par_1").colour;
  ok("bars with different chords get different PAR colours", JSON.stringify(c1) !== JSON.stringify(c2), `${c1} vs ${c2}`);
  ok("the colour stays a saturated [r,g,b]", c2.length === 3 && Math.max(...c2) > 0.9 && Math.min(...c2) < 0.3, `${c2}`);
  const c4 = g(frame({ bar: 4, beat: 1 }, plan, CTX), "par_1").colour;
  ok("a bar with no chord keeps the gesture's own colour", JSON.stringify(c4) === JSON.stringify([1, 0, 0]));
  const unsure = P([], { harmony: { ...harmony, sure: [0, 0, 0, 0] } });
  ok("an unconfident chord does not tint", JSON.stringify(g(frame({ bar: 2, beat: 1 }, unsure, CTX), "par_1").colour) === JSON.stringify([1, 0, 0]));
  const c3 = g(frame({ bar: 3, beat: 1 }, plan, CTX), "par_1").colour;
  ok("a minor chord is a shade darker than the same major", Math.max(...c3) < Math.max(...c2), `${c3} vs ${c2}`);
  ok("without harmony the colour is the gesture's (today's behaviour)", JSON.stringify(g(frame({ bar: 2, beat: 1 }, P(), CTX), "par_1").colour) === JSON.stringify([1, 0, 0]));
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
