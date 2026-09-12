"use strict";
/* Enumeration -- the taste gate. A pure function of the LAYOUT:
     enumerate(layout) -> { sequences, matrix, report }
   Sequences that are both POSSIBLE and LAND WELL on this rig, a suitability matrix
   M[seq][context] = fit(seq,layout) x affinity(seq,context), and a readable report.
   Computed once per layout and cached; the arranger reuses it across every score.

   Sequences key off the device DRIVERS' declared capabilities (never fixture ids),
   so a richer rig auto-enables the sequences its fixtures support. */
const drivers = require("./drivers/index.js");
const { FACTS, FAMILIES, toVector, cellFor } = require("./facts.js");

const capsOf = fixture => drivers.forType(fixture.type).can;

/* ---- groups: capability- and geometry-derived, never type-hardcoded ------ */
function groupsOf(layout) {
  const fx = (layout.fixtures || []).map(f => ({ id: f.id, type: f.type, can: capsOf(f),
    x: f.at ? f.at[0] : (f.angle_deg || 0) }));
  const cap = (f, c) => f.can.includes(c);

  const pars = fx.filter(f => cap(f, "colour") && cap(f, "level") && !cap(f, "move"));
  const movers = fx.filter(f => cap(f, "move"));
  const strobers = fx.filter(f => cap(f, "strobe"));
  const lasers = fx.filter(f => cap(f, "laser"));

  const arc = [...pars].sort((a, b) => a.x - b.x);
  const centre = pars.length ? pars.reduce((s, f) => s + f.x, 0) / pars.length : 0;
  const byDist = [...pars].sort((a, b) => Math.abs(a.x - centre) - Math.abs(b.x - centre));
  const half = Math.floor(pars.length / 2);
  const inner = byDist.slice(0, half);
  const outer = byDist.slice(half, half * 2);

  return { fx, pars, movers, strobers, lasers, arc, inner, outer,
           span: pars.length ? arc[arc.length - 1].x - arc[0].x : 0 };
}

const clamp01 = v => Math.max(0, Math.min(1, v));

/* The contexts are the situations the protocol can report -- form types, plus a
   curated conjunction column for the final-drop situation. Rig-independent: a new
   rig adds sequence ROWS, never context COLUMNS. */
const CONTEXTS = FACTS.form;
const FIT_FLOOR = 0.35;   // a cell (fit x affinity) below this scores 0 but is reported

/* ---- the sequence vocabulary (rig-independent; pruned per layout) --------
   Each sequence declares: requires (feasibility), fit (does it LAND on this rig,
   0..1), affinity (does it SUIT each context, 0..1), and boldness. */
const VOCABULARY = [
  { id: "pair_call_response", kind: "individual", boldness: "accent",
    occupies: ["pars:colour", "pars:level"],
    requires: g => g.inner.length >= 1 && g.outer.length >= 1,
    fit: g => {
      const n = g.inner.length + g.outer.length;
      if (n < 2) return 0;
      const balance = Math.min(g.inner.length, g.outer.length) /
                      Math.max(g.inner.length, g.outer.length);
      return clamp01(0.5 * balance + 0.5 * Math.min(n, 4) / 4);
    },
    affinity: { intro: 0, verse: 0.5, break: 0.4, build: 0.6, drop: 0.9, outro: 0,
                silence: 0, final_drop: 0.95 } },

  { id: "travelling_pulse", kind: "individual", boldness: "accent",
    occupies: ["pars:colour", "pars:level"],
    requires: g => g.pars.length >= 3,
    /* a chase reads better the more lamps it walks across; on only 4 it is modest */
    fit: g => (g.pars.length >= 3 ? clamp01(0.3 + 0.1 * g.pars.length) : 0),
    affinity: { intro: 0, verse: 0.7, break: 0.4, build: 0.5, drop: 0.5, outro: 0,
                silence: 0, final_drop: 0.4 } },

  { id: "strobe_pops", kind: "individual", boldness: "accent",
    occupies: ["pars:strobe"],
    requires: g => g.strobers.length >= 1,
    fit: g => (g.strobers.length >= 1 ? 0.8 : 0),
    affinity: { intro: 0, verse: 0.2, break: 0.4, build: 0.7, drop: 0.8, outro: 0,
                silence: 0, final_drop: 0.85 } },

  { id: "head_sweep", kind: "individual", boldness: "hero",
    occupies: ["head:move"],
    requires: g => g.movers.length >= 1,
    fit: g => (g.movers.length >= 1 ? 0.9 : 0),
    affinity: { intro: 0, verse: 0.4, break: 0.3, build: 0.7, drop: 0.9, outro: 0,
                silence: 0, final_drop: 0.9 } },

  { id: "breathe", kind: "individual", boldness: "ambient",
    occupies: ["pars:level"],
    requires: g => g.pars.length >= 1,
    fit: g => (g.pars.length >= 1 ? 0.8 : 0),
    affinity: { intro: 0.85, verse: 0.2, break: 0.5, build: 0, drop: 0, outro: 0.85,
                silence: 0.55, final_drop: 0 } },

  /* compound: a scripted arc within one span -- whitening into accelerating pops,
     ending dark before the drop. */
  { id: "build_ramp", kind: "compound", boldness: "accent",
    steps: [{ at: 0, seq: "breathe" }, { at: 0.4, seq: "strobe_pops" }],
    occupies: ["pars:colour", "pars:level", "pars:strobe"],
    requires: g => g.pars.length >= 2 && g.strobers.length >= 1,
    fit: g => clamp01(0.5 + 0.1 * g.pars.length),
    affinity: { intro: 0, verse: 0, break: 0.2, build: 0.9, drop: 0.3, outro: 0,
                silence: 0, final_drop: 0.3 } },

  /* combination: several sequences layered concurrently, pre-vetted for taste. Its
     parts must not claim the same fixture-attribute (checked at enumeration). */
  { id: "drop_combo_A", kind: "combination", boldness: "hero",
    parts: [{ seq: "pair_call_response" }, { seq: "head_sweep" }, { seq: "strobe_pops" }],
    requires: g => g.inner.length >= 1 && g.outer.length >= 1 &&
      g.movers.length >= 1 && g.strobers.length >= 1,
    fit: g => Math.min(seqFit("pair_call_response", g), seqFit("head_sweep", g),
                       seqFit("strobe_pops", g)),
    affinity: { intro: 0, verse: 0, break: 0, build: 0.3, drop: 0.95, outro: 0,
                silence: 0, final_drop: 1.0 } },

  /* A dangerous device type: only enumerated if the layout also carries the enforced
     safety limits for it. A gesture with no enforced limit is never offered. */
  { id: "laser_sweep", kind: "individual", boldness: "hero",
    occupies: ["laser:beam"],
    requires: (g, layout) => g.lasers.length >= 1 &&
      !!(layout.limits && layout.limits.laser_zones),
    fit: g => (g.lasers.length >= 1 ? 0.85 : 0),
    affinity: { intro: 0, verse: 0.2, break: 0.2, build: 0.6, drop: 0.9, outro: 0,
                silence: 0, final_drop: 0.95 } },
];

const byIdVocab = id => VOCABULARY.find(v => v.id === id);
const seqFit = (id, g) => { const s = byIdVocab(id); return s && s.fit ? s.fit(g) : 0; };
/* a combination's effective occupancy = the union of its parts' claims */
const comboOccupies = s => {
  const set = [];
  for (const p of (s.parts || [])) for (const t of (byIdVocab(p.seq).occupies || [])) set.push(t);
  return set;
};
const comboConflicts = s => {
  const toks = comboOccupies(s);
  return new Set(toks).size !== toks.length;
};

/* dangerous capabilities may only be enumerated if the layout carries their limits */
const DANGEROUS = { laser: "laser_zones", pyro: "pyro_zones" };

/* which capabilities and named groups this layout actually has */
function layoutFacts(layout) {
  const g = groupsOf(layout);
  const caps = new Set(g.fx.flatMap(f => f.can));
  const groups = new Set();
  if (g.inner.length) groups.add("inner");
  if (g.outer.length) groups.add("outer");
  if (g.pars.length) { groups.add("all_pars"); groups.add("arc"); }
  if (g.movers.length) { groups.add("head"); groups.add("movers"); }
  if (g.strobers.length) groups.add("strobers");
  if (g.lasers.length) groups.add("lasers");
  return { g, caps, groups };
}

/* per-family affinity: { form: {ctx: 0..1}, doing?: {fact: 0..1, _default?}, ... }.
   Facts come from facts.js's vocabulary; the message names the offending word and
   the allowed ones, because generate.py feeds it back to the model. */
function validateAffinity(aff) {
  const bad = reason => ({ ok: false, reason });
  if (!aff || typeof aff !== "object") return bad("missing affinity");
  if (!aff.form || typeof aff.form !== "object") return bad("affinity.form missing");
  for (const fam of Object.keys(aff)) {
    if (!FACTS[fam]) return bad("unknown affinity family `" + fam + "`; allowed: " + FAMILIES.join(", "));
    const table = aff[fam];
    if (!table || typeof table !== "object") return bad("affinity." + fam + " is not an object");
    for (const f of Object.keys(table)) {
      if (f !== "_default" && !FACTS[fam].includes(f))
        return bad("unknown fact `" + f + "` in family `" + fam + "`; allowed: " + FACTS[fam].join(", "));
      const x = table[f];
      if (typeof x !== "number" || x < 0 || x > 1) return bad("bad affinity for " + fam + "." + f);
    }
  }
  for (const ctx of CONTEXTS) {
    const v = aff.form[ctx];
    if (typeof v !== "number" || v < 0 || v > 1) return bad("bad suitability for " + ctx);
  }
  return { ok: true };
}
/* a sequence's affinity, whichever way it was written */
const affinityOf = seq => seq.affinity || (seq.suitability ? { form: seq.suitability } : null);

/* Validate an externally-supplied (e.g. LLM-generated) sequence against this rig.
   This is the gate that keeps a generated palette grounded and safe: it can only
   use capabilities and groups the rig actually has, dangerous types need limits,
   combinations must be conflict-free, and every suitability score is a 0..1 number. */
function validateSequence(seq, layout) {
  const { caps, groups } = layoutFacts(layout);
  const bad = reason => ({ ok: false, reason });
  if (!seq || typeof seq.id !== "string" || !seq.id) return bad("missing id");
  if (!["individual", "compound", "combination"].includes(seq.kind)) return bad("bad kind");
  if (!["ambient", "accent", "hero"].includes(seq.boldness)) return bad("bad boldness");
  const req = seq.requires || {};
  for (const c of (req.caps || [])) {
    if (!caps.has(c)) return bad("needs absent capability: " + c);
    if (DANGEROUS[c] && !(layout.limits && layout.limits[DANGEROUS[c]]))
      return bad("dangerous capability without limits: " + c);
  }
  for (const gr of (req.groups || [])) if (!groups.has(gr)) return bad("needs absent group: " + gr);
  const occ = seq.occupies || [];
  if (!Array.isArray(occ)) return bad("occupies not an array");
  if (seq.kind === "combination" && new Set(occ).size !== occ.length)
    return bad("combination self-conflict");
  return validateAffinity(affinityOf(seq));
}

/* enumerate(layout, { palette }) -> { sequences, matrix, report }
   The heuristic BASE vocabulary (computed fit x affinity) is always present and
   deterministic; an optional PALETTE (validated, pre-scored, e.g. LLM-generated)
   is merged on top. The matrix is the arranger's contract either way. */
function enumerate(layout, options) {
  options = options || {};
  const g = groupsOf(layout);
  const gate = v => (v >= FIT_FLOOR ? +v.toFixed(4) : 0);

  const keptBase = VOCABULARY.filter(s => s.requires(g, layout) &&
    !(s.kind === "combination" && comboConflicts(s)));

  const matrix = {};
  const sequences = [];

  for (const s of keptBase) {
    const f = s.fit ? s.fit(g) : 0;
    const row = {};
    for (const ctx of CONTEXTS) row[ctx] = gate(f * ((s.affinity && s.affinity[ctx]) || 0));
    matrix[s.id] = row;
    sequences.push({ id: s.id, kind: s.kind, boldness: s.boldness, source: "base",
      fit: +f.toFixed(4), occupies: s.kind === "combination" ? comboOccupies(s) : (s.occupies || []),
      ...(s.parts ? { parts: s.parts.map(p => p.seq) } : {}) });
  }

  let rejected = 0, dup = 0;
  for (const seq of (options.palette || [])) {
    if (matrix[seq && seq.id]) { dup++; continue; }
    const v = validateSequence(seq, layout);
    if (!v.ok) { rejected++; continue; }
    const row = {};
    for (const ctx of CONTEXTS) row[ctx] = gate(seq.suitability[ctx]);
    matrix[seq.id] = row;
    sequences.push({ id: seq.id, kind: seq.kind, boldness: seq.boldness, source: "llm",
      fit: +Math.max(...CONTEXTS.map(c => seq.suitability[c])).toFixed(4),
      occupies: seq.occupies || [],
      ...(Array.isArray(seq.parts) ? { parts: seq.parts.map(p => p && p.seq).filter(Boolean) } : {}) });
  }

  const impossible = VOCABULARY.filter(s => !keptBase.includes(s)).map(s => s.id);
  const weak = sequences.filter(s => CONTEXTS.every(c => matrix[s.id][c] === 0)).map(s => s.id);
  const strongest = {};
  for (const ctx of CONTEXTS) {
    strongest[ctx] = sequences.map(s => ({ id: s.id, score: matrix[s.id][ctx] }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  }
  const report = { rig: layout.rig || null, can_do: sequences.map(s => s.id),
    impossible, weak, strongest,
    sources: { base: keptBase.length, llm: sequences.length - keptBase.length },
    rejected, dup };

  return { sequences, matrix, report };
}

/* ---- boldness budgets per context: a taste guardrail independent of the seed,
   so a quiet section can't stack hero sequences however the PRNG falls. -------- */
const BUDGETS = {
  intro: { hero: 0, accent: 1, ambient: 2 }, outro: { hero: 0, accent: 1, ambient: 2 },
  verse: { hero: 1, accent: 2, ambient: 1 }, break: { hero: 1, accent: 2, ambient: 1 },
  build: { hero: 1, accent: 3, ambient: 1 }, drop: { hero: 2, accent: 3, ambient: 1 },
  silence: { hero: 0, accent: 0, ambient: 1 }, final_drop: { hero: 2, accent: 3, ambient: 1 },
};
const DEFAULT_BUDGET = { hero: 1, accent: 2, ambient: 1 };

/* The arranger's read-only view over a (possibly cached) enumeration result:
   which sequences suit a context, how many of each boldness it may use, and the
   sequence summaries. Works on plain JSON, so it runs over <layout>.matrix.json. */
function view(result) {
  const M = result.matrix || {};
  const byId = Object.fromEntries((result.sequences || []).map(s => [s.id, s]));
  return {
    candidates: ctx => (result.sequences || [])
      .map(s => ({ id: s.id, score: (M[s.id] || {})[ctx] || 0, boldness: s.boldness }))
      .filter(c => c.score > 0).sort((a, b) => b.score - a.score),
    budget: ctx => BUDGETS[ctx] || DEFAULT_BUDGET,
    seq: id => byId[id] || null,
  };
}

module.exports = { enumerate, view, validateSequence, validateAffinity, affinityOf, layoutFacts, groupsOf,
                   VOCABULARY, CONTEXTS, FIT_FLOOR, BUDGETS, FACTS };

/* ---- CLI: enumerate a layout, print the taste report, cache the matrix ---
     node readers/lights/preflight.js [readers/lights/arc4-head.layout.json]      */
if (require.main === module) {
  const fs = require("fs"), path = require("path");
  const file = process.argv[2] || path.join(__dirname, "arc4-head.layout.json");
  const layout = JSON.parse(fs.readFileSync(file, "utf8"));
  const base = path.basename(file).replace(/\.layout\.json$|\.json$/, "");

  /* load the (LLM-generated) palette cache if present, else base-only */
  let palette = [];
  try { palette = JSON.parse(fs.readFileSync(path.join(path.dirname(file), base + ".palette.json"), "utf8")); }
  catch (e) { /* no palette yet -- heuristic base only */ }

  const result = enumerate(layout, { palette });
  const out = path.join(path.dirname(file), base + ".matrix.json");
  fs.writeFileSync(out, JSON.stringify(result, null, 1));

  const r = result.report;
  console.log(`\nRIG: ${r.rig}   (${result.sequences.length} sequences: ${r.sources.base} base + ${r.sources.llm} llm; ${r.rejected} rejected, ${r.dup} dup)`);
  console.log("CAN DO:          " + r.can_do.join(" · "));
  if (r.weak.length) console.log("WEAK (low weight): " + r.weak.join(" · "));
  console.log("IMPOSSIBLE HERE: " + (r.impossible.join(" · ") || "—"));
  console.log("STRONGEST BY CONTEXT:");
  for (const ctx of CONTEXTS) {
    const top = (r.strongest[ctx] || []).map(x => `${x.id} (${x.score})`).join(", ");
    console.log("  " + ctx.padEnd(12) + (top || "—"));
  }
  console.log(`\n-> ${out}`);
}
