/* Arranger tests -- the seeded, arc-aware plan, over the REAL score format
   (flat sections named by feel + a per-bar energy curve). Plain node idiom.
   plan(score, enumResult, seed) is a pure function of (score, seed): it derives a
   lighting context per section (from energy + arc), looks up the enumeration matrix,
   and draws sequences with a seeded PRNG. No time, no rate, no LLM. */
"use strict";
const { plan } = require("./arranger.js");
const { enumerate } = require("./preflight.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

const RIG = {
  rig: "arc4-head",
  fixtures: [
    { id: "par_1", type: "par7", angle_deg: -32.5 }, { id: "par_8", type: "par7", angle_deg: -17 },
    { id: "par_15", type: "par7", angle_deg: 17 }, { id: "par_22", type: "par7", angle_deg: 32.5 },
    { id: "head", type: "head13" },
  ],
};
const EN = enumerate(RIG);   // base-only matrix is enough for arranger logic

/* a synthetic score in the ENDPOINT format: low intro, a drop, a dip, a rising
   build, a final (highest) drop, a low outro. */
const SCORE = {
  grid: { bpm: 120, first_beat_s: 0, beats_per_bar: 4, bars: 24 },
  sections: [
    { from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, name: "steady", repeat: "A" },
    { from: { bar: 5, beat: 1 }, to: { bar: 9, beat: 1 }, name: "building", repeat: "B" },
    { from: { bar: 9, beat: 1 }, to: { bar: 13, beat: 1 }, name: "thinning out", repeat: "A" },
    { from: { bar: 13, beat: 1 }, to: { bar: 17, beat: 1 }, name: "building", repeat: "A" },
    { from: { bar: 17, beat: 1 }, to: { bar: 21, beat: 1 }, name: "steady", repeat: "B" },
    { from: { bar: 21, beat: 1 }, to: { bar: 25, beat: 1 }, name: "thinning out", repeat: "A" },
  ],
  energy: { per: "bar", from_bar: 1, values: [
    0.05, 0.06, 0.05, 0.07, 0.9, 0.85, 0.92, 0.88, 0.15, 0.12, 0.14, 0.13,
    0.4, 0.45, 0.5, 0.55, 0.95, 0.9, 0.97, 0.93, 0.2, 0.1, 0.08, 0.05] },
  parts: [
    { from_bar: 1, to_bar: 4, feels: "steady", rise: 0 },
    { from_bar: 5, to_bar: 8, feels: "building", rise: 0.1 },
    { from_bar: 9, to_bar: 12, feels: "thinning out", rise: -0.1 },
    { from_bar: 13, to_bar: 16, feels: "building", rise: 0.2 },
    { from_bar: 17, to_bar: 20, feels: "steady", rise: 0.05 },
    { from_bar: 21, to_bar: 24, feels: "thinning out", rise: -0.15 }],
};

/* ---- cycle 1: coverage, validity, context-fit, determinism -------------- */
{
  const p = plan(SCORE, EN, 42);
  ok("every section gets an assignment",
     p.assignments.length === SCORE.sections.length, `${p.assignments.length}`);
  ok("every assignment names a sequence in the matrix",
     p.assignments.every(a => EN.matrix[a.seq_id]));
  ok("every assignment's sequence suits its derived context (score > 0)",
     p.assignments.every(a => EN.matrix[a.seq_id][a.context] > 0),
     p.assignments.map(a => `${a.section}->${a.context}:${a.seq_id}`).join("  "));
  ok("same (score, seed) yields an identical plan",
     JSON.stringify(plan(SCORE, EN, 42)) === JSON.stringify(plan(SCORE, EN, 42)));
}

/* ---- cycle 2: the arc -- the final drop is the boldest ------------------- */
{
  const p = plan(SCORE, EN, 42);
  const fd = p.assignments.find(a => a.context === "final_drop");
  ok("the last high-energy section is mapped to final_drop", !!fd,
     p.assignments.map(a => a.context).join(", "));
  ok("the final drop has the maximum intensity of any section",
     fd && Math.max(...p.assignments.map(a => a.params.intensity)) === fd.params.intensity,
     fd && `final ${fd.params.intensity} vs max ${Math.max(...p.assignments.map(a => a.params.intensity))}`);
  ok("the first low section reads as intro, the last as outro",
     p.assignments[0].context === "intro" && p.assignments[p.assignments.length - 1].context === "outro",
     `${p.assignments[0].context} .. ${p.assignments[p.assignments.length - 1].context}`);
}

/* ---- cycle 3: a different seed gives a different show -------------------- */
{
  const a = plan(SCORE, EN, 1).assignments.map(x => x.seq_id).join(",");
  const b = plan(SCORE, EN, 999).assignments.map(x => x.seq_id).join(",");
  ok("a different seed changes the sequence choices", a !== b, `${a}\n     ${b}`);
}

/* ---- the real levels score (smoke) -------------------------------------- */
{
  const LEVELS = require("./levels.score.json");
  const layout = require("./arc4-head.layout.json");
  const palette = require("./arc4-head.palette.json");
  const FULL = enumerate(layout, { palette });
  const p = plan(LEVELS, FULL, 7);
  ok("plans every section of the real levels score",
     p.assignments.length === LEVELS.sections.length, `${p.assignments.length}/${LEVELS.sections.length}`);
  const fd = p.assignments.find(a => a.context === "final_drop");
  ok("levels: the final drop is the boldest section",
     fd && Math.max(...p.assignments.map(a => a.params.intensity)) === fd.params.intensity);
}

/* ---- cycle 4: overlapping sections -> concurrent, conflict-avoided ------- */
{
  const at = p => (p.bar - 1) * 4 + ((p.beat || 1) - 1);
  const overlap = (a, b) => at(a.from) < at(b.to) && at(b.from) < at(a.to);
  const OVERLAP = {
    grid: { bpm: 120, first_beat_s: 0, beats_per_bar: 4, bars: 12 },
    sections: [
      { from: { bar: 1, beat: 1 }, to: { bar: 9, beat: 1 }, name: "steady", repeat: "A" },
      { from: { bar: 5, beat: 1 }, to: { bar: 9, beat: 1 }, name: "building", repeat: "B" },
    ],
    energy: { per: "bar", from_bar: 1, values: [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.5, 0.5, 0.5, 0.5] },
  };
  let sawConcurrent = false, safe = true, cleanSeeds = 0;
  for (let s = 0; s < 8; s++) {
    const A = plan(OVERLAP, EN, s).assignments;
    let clean = true;
    for (let i = 0; i < A.length; i++) for (let j = i + 1; j < A.length; j++) {
      if (overlap(A[i], A[j])) {
        sawConcurrent = true;
        const share = A[i].occupies.some(t => A[j].occupies.includes(t));
        if (share) { clean = false; if (!(A[i].clash || A[j].clash)) safe = false; }
      }
    }
    if (clean) cleanSeeds++;
  }
  ok("overlapping sections produce concurrent assignments", sawConcurrent);
  ok("concurrent assignments never silently double-claim a fixture-attribute", safe);
  ok("conflict-avoidance yields a clean overlap for at least one seed", cleanSeeds > 0,
     `${cleanSeeds}/8 seeds clean`);
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
