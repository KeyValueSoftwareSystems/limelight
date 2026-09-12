/* Enumeration / suitability-matrix tests -- the taste gate. Plain node idiom.
   enumerate(layout) is a pure function of the layout: it returns the sequences that
   are possible AND land well on this rig, plus M[seq][context] scoring how well each
   fits each musical situation, plus a human-readable report. Sequences key off the
   device drivers' declared capabilities, never fixture ids. */
"use strict";
const { enumerate, view, VOCABULARY } = require("./preflight.js");

const out = [];
const ok = (name, cond, detail) => out.push([!!cond, name, detail || ""]);

/* the current rig: four PARs on an arc + one moving head */
const RIG = {
  rig: "arc4-head",
  fixtures: [
    { id: "par_1", type: "par7", angle_deg: -32.5 },
    { id: "par_8", type: "par7", angle_deg: -17 },
    { id: "par_15", type: "par7", angle_deg: 17 },
    { id: "par_22", type: "par7", angle_deg: 32.5 },
    { id: "head", type: "head13" },
  ],
};
const noHead = { rig: "arc4", fixtures: RIG.fixtures.filter(f => f.type !== "head13") };

/* ---- feasibility keys off driver capabilities --------------------------- */
{
  const ids = enumerate(RIG).sequences.map(s => s.id);
  ok("a mover enables head sequences", ids.includes("head_sweep"), ids.join(", "));
  ok("PAR sequences are always available with pars", ids.includes("pair_call_response"),
     ids.join(", "));

  const idsNoHead = enumerate(noHead).sequences.map(s => s.id);
  ok("no mover -> no head sequences", !idsNoHead.some(id => id.startsWith("head_")),
     idsNoHead.join(", "));
  ok("but the par sequences remain", idsNoHead.includes("pair_call_response"),
     idsNoHead.join(", "));
}

/* ---- portability: a fixture type this rig lacks (laser), and its safety gate -- */
{
  const laser = VOCABULARY.find(s => s.id === "laser_sweep");
  ok("laser_sweep is in the vocabulary (portable, not deleted)", !!laser);
  ok("but pruned on a rig with no laser fixture",
     !enumerate(RIG).sequences.some(s => s.id === "laser_sweep"));

  const gWithLaser = { pars: [], movers: [], strobers: [], lasers: [{ id: "laz" }],
    inner: [], outer: [], arc: [], span: 0 };
  ok("a laser fixture WITHOUT enforced safety limits does not enable it",
     laser && !laser.requires(gWithLaser, { fixtures: [], limits: {} }));
  ok("a laser fixture WITH laser_zones limits enables it",
     laser && laser.requires(gWithLaser, { fixtures: [], limits: { laser_zones: ["ceiling"] } }));
}

/* ---- the suitability matrix: scores in 0..1, affinity respects meaning --- */
{
  const e = enumerate(RIG);
  const M = e.matrix;
  ok("every enumerated sequence has a matrix row", e.sequences.every(s => M[s.id]),
     Object.keys(M).join(", "));
  ok("all scores are in 0..1",
     Object.values(M).every(row => Object.values(row).every(v => v >= 0 && v <= 1)));
  ok("a hero sequence scores 0 for intro (respecting meaning)",
     M["head_sweep"]["intro"] === 0, "head_sweep@intro " + M["head_sweep"]["intro"]);
  ok("and scores positively for drop", M["head_sweep"]["drop"] > 0,
     "head_sweep@drop " + M["head_sweep"]["drop"]);
}

/* ---- fit ordering: a symmetric gesture beats a chase on only 4 lamps ----- */
{
  const byId = Object.fromEntries(enumerate(RIG).sequences.map(s => [s.id, s]));
  ok("travelling_pulse is enumerated on a par arc", !!byId["travelling_pulse"]);
  ok("pair_call_response out-fits travelling_pulse on the 4-par arc",
     byId["pair_call_response"].fit > byId["travelling_pulse"].fit,
     `${byId["pair_call_response"].fit} vs ${byId["travelling_pulse"].fit}`);
}

/* ---- the report: a legible taste artifact ------------------------------- */
{
  const e = enumerate(RIG);
  ok("report names sequences impossible on this rig",
     e.report.impossible.includes("laser_sweep"), e.report.impossible.join(", "));
  ok("report counts what this rig can do",
     e.report.can_do.length === e.sequences.length, e.report.can_do.join(", "));
  ok("report ranks the strongest sequences for the final drop",
     Array.isArray(e.report.strongest.final_drop) && e.report.strongest.final_drop.length > 0,
     JSON.stringify(e.report.strongest.final_drop));
}

/* ---- determinism: the matrix is a pure function of the layout ------------ */
{
  const a = JSON.stringify(enumerate(RIG).matrix);
  const b = JSON.stringify(enumerate(RIG).matrix);
  ok("the same layout yields an identical matrix (cacheable, score-independent)", a === b);
}

/* ---- the arranger-facing interface -------------------------------------- */
{
  const v = view(enumerate(RIG));
  const drop = v.candidates("drop");
  ok("candidates(drop) are positive and sorted by suitability desc",
     drop.length > 0 && drop.every(c => c.score > 0) &&
     drop.every((c, i) => i === 0 || drop[i - 1].score >= c.score),
     drop.map(c => `${c.id}:${c.score}`).join(", "));
  ok("intro has an ambient option and offers no hero sequence",
     v.candidates("intro").length > 0 && v.candidates("intro").every(c => c.boldness !== "hero"),
     v.candidates("intro").map(c => `${c.id}(${c.boldness})`).join(", "));
  ok("boldness budget caps heroes low in a verse", v.budget("verse").hero <= 1,
     JSON.stringify(v.budget("verse")));
  ok("seq(id) returns the sequence", v.seq("head_sweep") && v.seq("head_sweep").id === "head_sweep");
}

/* ---- the model spans individual / compound / combination ---------------- */
{
  const e = enumerate(RIG);
  const kinds = new Set(e.sequences.map(s => s.kind));
  ok("the enumerated set spans individual, compound and combination kinds",
     kinds.has("individual") && kinds.has("compound") && kinds.has("combination"),
     [...kinds].join(", "));
  const combos = e.sequences.filter(s => s.kind === "combination");
  ok("every enumerated combination is conflict-free (no two parts claim one fixture-attr)",
     combos.length > 0 && combos.every(c => new Set(c.occupies).size === c.occupies.length),
     combos.map(c => `${c.id}[${(c.occupies || []).join(",")}]`).join(" ; "));
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
