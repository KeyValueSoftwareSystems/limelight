/* frame.js tests -- the beat-locked gesture interpreter + overlap composition.
   Plain node idiom. frame(position, plan, {layout, library}) is pure in position. */
"use strict";
const { frame } = require("./frame.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);
const near = (a, b, e) => Math.abs(a - b) <= (e === undefined ? 1e-6 : e);

const RIG = { rig: "arc4-head", fixtures: [
  { id: "par_1", type: "par7", angle_deg: -32.5 }, { id: "par_8", type: "par7", angle_deg: -17 },
  { id: "par_15", type: "par7", angle_deg: 17 }, { id: "par_22", type: "par7", angle_deg: 32.5 },
  { id: "head", type: "head13" } ] };
// inner = par_8, par_15 (+-17); outer = par_1, par_22 (+-32.5)

const LIB = {
  hold_x: { id: "hold_x", kind: "individual", gesture: {
    group: "all_pars", keys: [{ at: 0, intent: { colour: [1, 0.85, 0.65], level: 0.4 } }], repeat: "hold" } },
  alt_x: { id: "alt_x", kind: "individual", gesture: {
    pattern: "inner_outer_alternation", group: "all_pars", keys: [
      { at: 0, target: "inner", intent: { level: 0.9, colour: [1, 0, 0] } },
      { at: 0, target: "outer", intent: { level: 0 } },
      { at: 1, target: "inner", intent: { level: 0 } },
      { at: 1, target: "outer", intent: { level: 0.9, colour: [0, 0, 1] } }], repeat: "loop" } },
  head_x: { id: "head_x", kind: "individual", gesture: {
    group: "head", keys: [{ at: 0, intent: { pan: 0.1, tilt: 0.5, level: 0.9, colour: "white" } },
      { at: 2, intent: { pan: 0.9 } }, { at: 4, intent: { pan: 0.1 } }], repeat: "loop" } },
  combo_x: { id: "combo_x", kind: "combination", gesture: { parts: [
    { gesture: { pattern: "inner_outer_alternation", group: "all_pars", keys: [
      { at: 0, target: "inner", intent: { level: 0.9, colour: [1, 0, 0] } },
      { at: 0, target: "outer", intent: { level: 0 } }] } },
    { gesture: { group: "head", keys: [{ at: 0, intent: { pan: 0.3, tilt: 0.5, level: 0.9, colour: "white" } }] } } ] } },
  hold_dim: { id: "hold_dim", kind: "individual", gesture: {
    group: "all_pars", keys: [{ at: 0, intent: { colour: [0, 0, 1], level: 0.3 } }], repeat: "hold" } },
  hold_bright: { id: "hold_bright", kind: "individual", gesture: {
    group: "all_pars", keys: [{ at: 0, intent: { colour: [1, 0, 0], level: 0.9 } }], repeat: "hold" } },
};
const CTX = { layout: RIG, library: LIB };
const span = (seq_id, priority, intensity) =>
  ({ from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, seq_id, priority, params: { intensity } });
const lvl = (F, id) => F.fixtures.find(f => f.id === id).intent.level;

/* ---- hold, coverage, intensity, dark, determinism ----------------------- */
{
  const plan = { grid: { beats_per_bar: 4 }, assignments: [span("hold_x", 0, 0.8)] };
  const F = frame({ bar: 1, beat: 1 }, plan, CTX);
  ok("frame has an entry for every fixture", F.fixtures.length === 5);
  const par1 = F.fixtures.find(f => f.id === "par_1").intent;
  ok("a hold renders its colour on the group", Array.isArray(par1.colour) && par1.level > 0);
  ok("intensity scales the level", near(par1.level, 0.4 * 0.8, 1e-3), "level " + par1.level);
  ok("an untargeted fixture is dark", lvl(F, "head") === 0);
  ok("frame is deterministic",
     JSON.stringify(frame({ bar: 1, beat: 1 }, plan, CTX)) === JSON.stringify(F));
}

/* ---- inner/outer alternation swaps by beat ------------------------------ */
{
  const plan = { grid: { beats_per_bar: 4 }, assignments: [span("alt_x", 0, 1)] };
  const b1 = frame({ bar: 1, beat: 1 }, plan, CTX);   // globalBeat 0 (even) -> inner
  const b2 = frame({ bar: 1, beat: 2 }, plan, CTX);   // globalBeat 1 (odd)  -> outer
  ok("alternation lights the inner pair on the downbeat",
     lvl(b1, "par_8") > 0 && lvl(b1, "par_1") === 0, `in ${lvl(b1, "par_8")} out ${lvl(b1, "par_1")}`);
  ok("and the outer pair on the next beat",
     lvl(b2, "par_1") > 0 && lvl(b2, "par_8") === 0, `in ${lvl(b2, "par_8")} out ${lvl(b2, "par_1")}`);
}

/* ---- head movement animates across the bar ------------------------------ */
{
  const plan = { grid: { beats_per_bar: 4 }, assignments: [span("head_x", 0, 1)] };
  const p1 = frame({ bar: 1, beat: 1 }, plan, CTX).fixtures.find(f => f.id === "head").intent;
  const p3 = frame({ bar: 1, beat: 3 }, plan, CTX).fixtures.find(f => f.id === "head").intent;
  ok("the head is lit and aimed", p1.level > 0 && p1.pan != null);
  ok("the head pan moves across the bar", p1.pan !== p3.pan, `${p1.pan} vs ${p3.pan}`);
}

/* ---- a combination lights several groups at once ------------------------ */
{
  const plan = { grid: { beats_per_bar: 4 }, assignments: [span("combo_x", 0, 1)] };
  const F = frame({ bar: 1, beat: 1 }, plan, CTX);
  ok("a combination lights both the pars and the head",
     lvl(F, "head") > 0 && lvl(F, "par_8") > 0, `head ${lvl(F, "head")} inner ${lvl(F, "par_8")}`);
}

/* ---- overlapping assignments compose ------------------------------------ */
{
  const plan = { grid: { beats_per_bar: 4 }, assignments: [span("hold_dim", 0, 1), span("hold_bright", 1, 1)] };
  const par1 = frame({ bar: 1, beat: 1 }, plan, CTX).fixtures.find(f => f.id === "par_1").intent;
  ok("overlap composes level as the max", near(par1.level, 0.9, 1e-3), "level " + par1.level);
  ok("and the higher-priority colour wins",
     JSON.stringify(par1.colour) === JSON.stringify([1, 0, 0]), JSON.stringify(par1.colour));
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
