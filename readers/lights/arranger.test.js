/* Arranger tests -- a PAR look AND a head look for every section, with per-phase
   dynamics + drop-boundary blackout/blast. Pure in (score, seed). Plain node idiom. */
"use strict";
const { plan } = require("./arranger.js");
const { enumerate } = require("./preflight.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

const RIG = { rig: "arc4-head", fixtures: [
  { id: "par_1", type: "par7", angle_deg: -32.5 }, { id: "par_8", type: "par7", angle_deg: -17 },
  { id: "par_15", type: "par7", angle_deg: 17 }, { id: "par_22", type: "par7", angle_deg: 32.5 },
  { id: "head", type: "head13" } ] };
const EN = enumerate(RIG);

const SCORE = {
  grid: { bpm: 120, first_beat_s: 0, beats_per_bar: 4, bars: 24 },
  sections: [
    { from: { bar: 1, beat: 1 }, to: { bar: 5, beat: 1 }, name: "steady" },
    { from: { bar: 5, beat: 1 }, to: { bar: 9, beat: 1 }, name: "building" },
    { from: { bar: 9, beat: 1 }, to: { bar: 13, beat: 1 }, name: "thinning out" },
    { from: { bar: 13, beat: 1 }, to: { bar: 17, beat: 1 }, name: "building" },
    { from: { bar: 17, beat: 1 }, to: { bar: 21, beat: 1 }, name: "steady" },
    { from: { bar: 21, beat: 1 }, to: { bar: 25, beat: 1 }, name: "thinning out" },
  ],
  energy: { per: "bar", from_bar: 1, values: [
    0.05, 0.06, 0.05, 0.07, 0.9, 0.85, 0.92, 0.88, 0.15, 0.12, 0.14, 0.13,
    0.4, 0.45, 0.5, 0.55, 0.95, 0.9, 0.97, 0.93, 0.2, 0.1, 0.08, 0.05] },
  parts: [{ from_bar: 13, to_bar: 16, feels: "building", rise: 0.2 }],
};

/* ---- the whole rig is alive: a PAR look AND a head look per section ------ */
{
  const p = plan(SCORE, EN, 42);
  const par = p.assignments.filter(a => a.layer === "par");
  const head = p.assignments.filter(a => a.layer === "head");
  ok("every section gets a PAR look", par.length === SCORE.sections.length, `${par.length}`);
  ok("every section gets a HEAD look", head.length === SCORE.sections.length, `${head.length}`);
  ok("every look names a sequence in the matrix",
     [...par, ...head].every(a => EN.matrix[a.seq_id]));
  ok("PAR looks carry phase dynamics (floor/peak/mode)",
     par.every(a => a.params.floor != null && a.params.peak != null && a.params.mode));
  ok("same (score, seed) yields an identical plan",
     JSON.stringify(plan(SCORE, EN, 42)) === JSON.stringify(plan(SCORE, EN, 42)));
}

/* ---- arc + contrast: final drop boldest, drops get blackout + blast ------ */
{
  const p = plan(SCORE, EN, 42);
  ok("contexts run intro .. final_drop .. outro",
     p.contexts[0] === "intro" && p.contexts.includes("final_drop") &&
     p.contexts[p.contexts.length - 1] === "outro", p.contexts.join(", "));
  const fd = p.assignments.find(a => a.layer === "par" && a.context === "final_drop");
  ok("the final drop's PAR look is boldest (intensity 1)", fd && fd.params.intensity === 1,
     fd && String(fd.params.intensity));
  ok("drops get a pre-drop blackout and a white blast",
     p.assignments.some(a => a.type === "blackout") && p.assignments.some(a => a.type === "white_blast"));
  const drop = p.assignments.find(a => a.layer === "par" && a.context === "drop");
  ok("a drop keeps a high floor (never dark between hits)", drop && drop.params.floor >= 0.5,
     drop && String(drop.params.floor));
  const intro = p.assignments.find(a => a.layer === "par" && a.context === "intro");
  ok("an intro breathes from a low floor", intro && intro.params.mode === "breathe" && intro.params.floor < 0.3);
}

/* ---- a different seed gives a different show ----------------------------- */
{
  const a = plan(SCORE, EN, 1).assignments.filter(x => x.layer === "par").map(x => x.seq_id).join(",");
  const b = plan(SCORE, EN, 999).assignments.filter(x => x.layer === "par").map(x => x.seq_id).join(",");
  ok("a different seed changes the PAR choices", a !== b, `${a}\n     ${b}`);
}

/* ---- the real levels score (smoke) -------------------------------------- */
{
  const LEVELS = require("./levels.score.json");
  const layout = require("./arc4-head.layout.json");
  const palette = require("./arc4-head.palette.json");
  const FULL = enumerate(layout, { palette });
  const p = plan(LEVELS, FULL, 7);
  ok("levels: every section has a PAR and a HEAD look",
     p.assignments.filter(a => a.layer === "par").length === LEVELS.sections.length &&
     p.assignments.filter(a => a.layer === "head").length === LEVELS.sections.length);
  const fd = p.assignments.find(a => a.layer === "par" && a.context === "final_drop");
  ok("levels: the final drop's PAR look is boldest", fd && fd.params.intensity === 1);
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
