/* Enumeration / suitability-matrix tests -- the taste gate. Plain node idiom.
   enumerate(layout) is a pure function of the layout: it returns the sequences that
   are possible AND land well on this rig, plus M[seq][context] scoring how well each
   fits each musical situation, plus a human-readable report. Sequences key off the
   device drivers' declared capabilities, never fixture ids. */
"use strict";
const { enumerate, view, validateSequence, VOCABULARY } = require("./preflight.js");

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

/* ---- LLM palette: validation grounds it to what the rig can do ---------- */
{
  const good = { id: "x_wash", kind: "individual", boldness: "ambient",
    requires: { groups: ["all_pars"], caps: ["colour", "level"] },
    occupies: ["pars:colour", "pars:level"],
    suitability: { intro: 0.8, verse: 0.3, break: 0.5, build: 0, drop: 0, outro: 0.8, silence: 0.5, final_drop: 0 } };
  ok("a grounded palette sequence validates", validateSequence(good, RIG).ok,
     JSON.stringify(validateSequence(good, RIG)));

  const needsPixels = { ...good, id: "x_pix", requires: { groups: ["all_pars"], caps: ["pixels"] } };
  ok("a sequence needing an absent capability is rejected", !validateSequence(needsPixels, RIG).ok);

  const badCombo = { id: "x_c", kind: "combination", boldness: "hero",
    requires: { groups: ["all_pars", "head"], caps: ["colour", "move"] },
    occupies: ["pars:colour", "pars:colour"],
    suitability: { intro: 0, verse: 0, break: 0, build: 0.3, drop: 1, outro: 0, silence: 0, final_drop: 1 } };
  ok("a combination with duplicate occupies is rejected", !validateSequence(badCombo, RIG).ok);

  const badScore = { ...good, id: "x_s", suitability: { ...good.suitability, drop: 1.5 } };
  ok("out-of-range suitability is rejected", !validateSequence(badScore, RIG).ok);
}

/* ---- LLM palette: merged with the heuristic base, invalid dropped -------- */
{
  const good = { id: "x_wash", kind: "individual", boldness: "ambient",
    requires: { groups: ["all_pars"], caps: ["colour", "level"] },
    occupies: ["pars:colour", "pars:level"],
    suitability: { intro: 0.8, verse: 0.3, break: 0.5, build: 0, drop: 0, outro: 0.8, silence: 0.5, final_drop: 0 } };
  const needsPixels = { ...good, id: "x_pix", requires: { groups: ["all_pars"], caps: ["pixels"] } };
  const palette = [good, { ...good, id: "x_wash2" }, needsPixels];

  const e = enumerate(RIG, { palette });
  const ids = e.sequences.map(s => s.id);
  ok("valid palette sequences are merged in", ids.includes("x_wash") && ids.includes("x_wash2"),
     ids.join(", "));
  ok("invalid palette sequences are dropped", !ids.includes("x_pix"));
  ok("palette suitability drives the matrix",
     e.matrix["x_wash"].intro > 0 && e.matrix["x_wash"].drop === 0,
     `intro ${e.matrix["x_wash"].intro} drop ${e.matrix["x_wash"].drop}`);
  ok("the heuristic base survives alongside the palette", ids.includes("pair_call_response"));
  ok("enumerate with a palette is deterministic",
     JSON.stringify(enumerate(RIG, { palette }).matrix) === JSON.stringify(enumerate(RIG, { palette }).matrix));
}


/* ---- the real layout: a flat line, 50 cm apart, head in the middle --------------
   Since 2026-09-13 the pars stand in a straight line facing the same way, not on an
   arc. Positions are metres in the AUDIENCE frame (+x is the audience's right): from
   behind the rig the right-most lamp is @1, so @1 is at the audience's left. */
{
  const { groupsOf } = require("./preflight.js");
  const L = require("./arc4-head.layout.json");
  const g = groupsOf(L);
  const xs = Object.fromEntries(L.fixtures.map(f => [f.id, f.at[0]]));
  ok("the layout states its frame of reference", L.frame === "audience", String(L.frame));
  ok("the layout says the lamps are a line, not an arc", L.geometry === "line", String(L.geometry));
  ok("@1 .. @22 run left to right from the audience, 0.5 m apart",
     xs.par_1 === -1 && xs.par_8 === -0.5 && xs.par_15 === 0.5 && xs.par_22 === 1, JSON.stringify(xs));
  ok("the head sits in the middle of the line", xs.head === 0);
  ok("the ordered group follows the line", g.arc.map(f => f.id).join(",") === "par_1,par_8,par_15,par_22", g.arc.map(f => f.id).join(","));
  ok("inner is the pair beside the head, outer the ends",
     g.inner.map(f => f.id).sort().join(",") === "par_15,par_8" && g.outer.map(f => f.id).sort().join(",") === "par_1,par_22");
  ok("the line spans two metres", Math.abs(g.span - 2) < 1e-9, String(g.span));
  ok("every lamp faces the same way (no per-lamp angle)", L.fixtures.filter(f => f.type === "par7").every(f => !f.angle_deg));
}

/* ---- affinity: per-family, from the fact vocabulary ------------------------ */
{
  const { validateAffinity } = require("./preflight.js");
  const base = { id: "aff_ok", kind: "individual", boldness: "accent",
    requires: { groups: ["all_pars"], caps: ["colour", "level"] }, occupies: ["pars:colour", "pars:level"],
    gesture: { group: "all_pars", keys: [{ at: 0, intent: { colour: [1, 0, 0] } }] } };
  const form = { intro: 0, verse: 0.5, break: 0.4, build: 0.6, drop: 0.9, outro: 0, silence: 0, final_drop: 0.9 };
  ok("a legacy suitability row still validates", validateSequence({ ...base, suitability: form }, RIG).ok);
  ok("a family-shaped affinity validates", validateSequence({ ...base, affinity: { form, doing: { peaking: 0.9, easing: 0.2, _default: 0.5 }, presence: { "drums:in": 0.8 } } }, RIG).ok,
     JSON.stringify(validateSequence({ ...base, affinity: { form, doing: { peaking: 0.9 } } }, RIG)));
  const unknownFact = validateSequence({ ...base, affinity: { form, doing: { grooving: 0.5 } } }, RIG);
  ok("an unknown fact is rejected and the message names it, its family and the allowed words",
     !unknownFact.ok && /grooving/.test(unknownFact.reason) && /doing/.test(unknownFact.reason) && /peaking/.test(unknownFact.reason), unknownFact.reason);
  const unknownFamily = validateSequence({ ...base, affinity: { form, mood: { happy: 1 } } }, RIG);
  ok("an unknown family is rejected", !unknownFamily.ok && /mood/.test(unknownFamily.reason), unknownFamily.reason);
  ok("an affinity value above 1 is rejected", !validateSequence({ ...base, affinity: { form, texture: { busy: 1.2 } } }, RIG).ok);
  ok("an affinity without form is rejected", !validateSequence({ ...base, affinity: { doing: { peaking: 1 } } }, RIG).ok);
  ok("neither affinity nor suitability is rejected", !validateSequence(base, RIG).ok);
  ok("validateAffinity is exported for generate.py's retry loop", validateAffinity({ form }).ok && !validateAffinity({ form, doing: { nope: 1 } }).ok);
  const protoFamily = validateAffinity({ form, constructor: { peaking: 0.5 } });
  ok("a family named after an Object.prototype member is rejected, not thrown",
     !protoFamily.ok && /constructor/.test(protoFamily.reason), protoFamily.reason);
  ok("a non-object (array) family table is rejected, not thrown",
     !validateAffinity({ form, doing: [0.5] }).ok);
}

/* ---- affinity: enumerate's palette merge must not crash on affinity-only seqs -- */
{
  const affSeq = { id: "x_aff", kind: "individual", boldness: "ambient",
    requires: { groups: ["all_pars"], caps: ["colour", "level"] },
    occupies: ["pars:colour", "pars:level"],
    affinity: { form: { intro: 0.9, verse: 0.3, break: 0.5, build: 0, drop: 0, outro: 0.9, silence: 0.5, final_drop: 0 },
                doing: { peaking: 0.8 } } };
  let threw = null, e = null;
  try { e = enumerate(RIG, { palette: [affSeq] }); } catch (err) { threw = err; }
  ok("enumerate does not throw on an affinity-only (no suitability) palette sequence",
     !threw, threw && threw.message);
  ok("its matrix row equals its affinity.form, gated as before",
     !!e && e.matrix.x_aff && e.matrix.x_aff.intro === 0.9 && e.matrix.x_aff.drop === 0,
     e && JSON.stringify(e.matrix.x_aff));
}

/* ---- enumerate: per-family affinity in the result, form table kept ----------- */
{
  const legacy = { id: "x_legacy", kind: "individual", boldness: "ambient",
    requires: { groups: ["all_pars"], caps: ["colour", "level"] }, occupies: ["pars:colour", "pars:level"],
    gesture: { group: "all_pars", keys: [{ at: 0, intent: { colour: [0, 0, 1] } }] },
    suitability: { intro: 0.9, verse: 0.3, break: 0.4, build: 0.1, drop: 0, outro: 0.9, silence: 0.8, final_drop: 0 } };
  const rich = { ...legacy, id: "x_rich", suitability: undefined,
    affinity: { form: legacy.suitability, doing: { establishing: 0.9, peaking: 0 }, presence: { "drums:out": 0.9, "drums:in": 0.3 } } };
  delete rich.suitability;
  const e = enumerate(RIG, { palette: [legacy, rich] });
  ok("the result carries an affinity block keyed family -> sequence -> fact",
     e.affinity && e.affinity.form && e.affinity.form.x_legacy && e.affinity.form.x_legacy.intro === 0.9, JSON.stringify(Object.keys(e.affinity || {})));
  ok("a legacy suitability row becomes affinity.form", e.affinity.form.x_legacy.drop === 0);
  ok("a rich sequence's other families are stored", e.affinity.doing.x_rich.establishing === 0.9 && e.affinity.presence.x_rich["drums:out"] === 0.9);
  ok("a sequence that does not mention a family is absent from that family's table", e.affinity.doing.x_legacy === undefined);
  ok("the base vocabulary carries fact anchors beyond form",
     e.affinity.doing.pair_call_response && e.affinity.doing.pair_call_response.peaking > 0.5 && e.affinity.presence.breathe && e.affinity.presence.breathe["drums:out"] > 0.5);
  ok("the form table is still there for the report and old callers", e.matrix.x_legacy.intro === 0.9 && e.matrix.pair_call_response.drop > 0);
  ok("fit is stored per sequence", e.fit && e.fit.x_legacy === 0.9 && e.fit.pair_call_response === e.sequences.find(s => s.id === "pair_call_response").fit);
  ok("the report ranks the strongest sequences per fact", Array.isArray(e.report.strongest_by_fact.doing.peaking) && e.report.strongest_by_fact.doing.peaking[0].id, JSON.stringify(e.report.strongest_by_fact.doing.peaking));
  ok("the cache round-trips through JSON", JSON.stringify(JSON.parse(JSON.stringify(e)).affinity) === JSON.stringify(e.affinity));
}

for (const [pass, name, detail] of out)
  console.log(`  ${pass ? "pass" : "FAIL"}  ${name}${detail ? "   " + detail : ""}`);
const bad = out.filter(r => !r[0]).length;
console.log(bad ? `\n${bad} FAILED` : `\nall ${out.length} checks pass`);
process.exit(bad ? 1 : 0);
