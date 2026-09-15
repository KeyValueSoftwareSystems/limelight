#!/usr/bin/env node
"use strict";
/* The plan the page draws ghost clips from. The only thing that can go quietly
   wrong here is bar numbering: the arranger counts bars in the renderer's
   corrected space, the page counts them session.js's way, and the two coincide
   whenever shift is 0 -- which it is for most songs. So exercise shift != 0. */
const assert = require("node:assert/strict");
const { planFor } = require("./plan.js");

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); pass++; console.log("  ok   " + name); }
  catch (e) { fail++; console.log("  FAIL " + name + "\n       " + e.message); }
};

const bpb = 4;
const assignments = [
  { from: { bar: 3, beat: 1 }, to: { bar: 3, beat: 3 }, type: "white_blast",
    layer: "fx", params: { strength: 1 }, context: "drop" },
  { from: { bar: 5, beat: 1 }, to: { bar: 6, beat: 1 }, type: "accent_strobe",
    layer: "accent", params: {}, context: "build" },
  { from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, type: "modulate",
    layer: "modulate", params: { gain: 1.1, motion: 0.15, doing: "expanding" } },
  { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, layer: "par",
    seq_id: "hold_indigo" },
  { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, layer: "head",
    seq_id: "head_roam_dusk" },
];
const sections = [{ from: { bar: 1 } }, { from: { bar: 9 } }];

ok("punctuation is carried, modulate and base looks are not", () => {
  const plan = planFor({ assignments }, [], bpb, 0);
  assert.equal(plan.punctuation.length, 2);
  assert.deepEqual(plan.punctuation.map((x) => x.fx), ["white_blast", "accent_strobe"]);
});

ok("with shift 0 the plan's bars are the page's bars", () => {
  const plan = planFor({ assignments }, [], bpb, 0);
  assert.equal(plan.punctuation[0].bar, 3);
});

ok("with shift 1 every bar moves by one -- the bridge", () => {
  const plan = planFor({ assignments }, [], bpb, 1);
  assert.equal(plan.punctuation[0].bar, 4);
  assert.equal(plan.punctuation[1].bar, 6);
});

ok("a negative shift moves bars the other way", () => {
  const plan = planFor({ assignments }, [], bpb, -2);
  assert.equal(plan.punctuation[0].bar, 1);
});

ok("length is measured in beats, and the beat within the bar is kept", () => {
  const plan = planFor({ assignments }, [], bpb, 0);
  assert.equal(plan.punctuation[0].beats, 2);
  assert.equal(plan.punctuation[0].beat, 1);
  assert.equal(plan.punctuation[1].beats, 4);
});

ok("ids are stable and unique", () => {
  const a = planFor({ assignments }, [], bpb, 0).punctuation.map((x) => x.id);
  const b = planFor({ assignments }, [], bpb, 0).punctuation.map((x) => x.id);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

ok("dynamics comes from the modulate layer, in page bars", () => {
  const plan = planFor({ assignments }, [], bpb, 1);
  assert.equal(plan.dynamics.length, 1);
  assert.equal(plan.dynamics[0].bar, 2);
  assert.equal(plan.dynamics[0].beats, 16);
  assert.equal(plan.dynamics[0].gain, 1.1);
  assert.equal(plan.dynamics[0].doing, "expanding");
});

ok("each section reports the base look covering its first beat", () => {
  const plan = planFor({ assignments }, sections, bpb, 0);
  assert.equal(plan.looks.length, 2);
  assert.deepEqual(plan.looks[0], { section: 0, par: "hold_indigo", head: "head_roam_dusk" });
  assert.deepEqual(plan.looks[1], { section: 1, par: null, head: null });
});

console.log("\n%d passed, %d failed", pass, fail);
process.exit(fail ? 1 : 0);
