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

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
