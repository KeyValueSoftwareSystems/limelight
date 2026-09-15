"use strict";
/* Enumeration -- the taste gate. A pure function of the LAYOUT:
     enumerate(layout) -> { sequences, fit, affinity, matrix, report }
   Sequences that are both POSSIBLE and LAND WELL on this rig; affinity is the
   per-family table (family -> sequence -> fact -> 0..1) each sequence declared,
   matrix is the form table (fit x affinity.form) kept for the report and older
   callers, and report is a readable summary of both.
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
    description: "The inner pair and the outer pair trade every beat, hot magenta answering cyan.",
    occupies: ["pars:colour", "pars:level"],
    gesture: { pattern: "inner_outer_alternation", group: "all_pars", keys: [
      { at: 0, target: "inner", intent: { colour: [1, 0.1, 0.5], level: 1 } }, { at: 0, target: "outer", intent: { level: 0 } },
      { at: 1, target: "inner", intent: { level: 0 } }, { at: 1, target: "outer", intent: { colour: [0.1, 0.7, 1], level: 1 } } ] },
    requires: g => g.inner.length >= 1 && g.outer.length >= 1,
    fit: g => {
      const n = g.inner.length + g.outer.length;
      if (n < 2) return 0;
      const balance = Math.min(g.inner.length, g.outer.length) /
                      Math.max(g.inner.length, g.outer.length);
      return clamp01(0.5 * balance + 0.5 * Math.min(n, 4) / 4);
    },
    affinity: { form: { intro: 0, verse: 0.5, break: 0.4, build: 0.6, drop: 0.9, outro: 0, silence: 0, final_drop: 0.95 },
                doing: { peaking: 0.9, intensifying: 0.8, expanding: 0.8, holding: 0.6, easing: 0.4, thinning: 0.2, _default: 0.5 },
                presence: { "drums:in": 0.9, "drums:out": 0.3 },
                texture: { busy: 0.8, narrow: 0.7, sparse: 0.4 } } },

  { id: "travelling_pulse", kind: "individual", boldness: "accent",
    description: "A warm pulse walks along the line one lamp per beat, bounces at the ends and trails a tail.",
    occupies: ["pars:colour", "pars:level"],
    gesture: { group: "arc", direction: "bounce", stagger: 1, repeat: "loop", keys: [
      { at: 0, intent: { colour: [1, 0.75, 0.35], level: 1 } }, { at: 1, intent: { level: 0.45 } } ] },
    requires: g => g.pars.length >= 3,
    /* a chase reads better the more lamps it walks across; on only 4 it is modest */
    fit: g => (g.pars.length >= 3 ? clamp01(0.3 + 0.1 * g.pars.length) : 0),
    affinity: { form: { intro: 0, verse: 0.7, break: 0.4, build: 0.5, drop: 0.5, outro: 0, silence: 0, final_drop: 0.4 },
                doing: { establishing: 0.7, easing: 0.7, holding: 0.7, developing: 0.7, peaking: 0.4, _default: 0.5 },
                texture: { wide: 0.8, sparse: 0.6 } } },

  { id: "strobe_pops", kind: "individual", boldness: "accent",
    description: "Every strobing lamp pops white at a fast fixture strobe.",
    occupies: ["pars:strobe"],
    gesture: { group: "strobers", keys: [{ at: 0, intent: { colour: [1, 1, 1], level: 1, strobe: 0.7 } }] },
    requires: g => g.strobers.length >= 1,
    fit: g => (g.strobers.length >= 1 ? 0.8 : 0),
    affinity: { form: { intro: 0, verse: 0.2, break: 0.4, build: 0.7, drop: 0.8, outro: 0, silence: 0, final_drop: 0.85 },
                doing: { peaking: 1, intensifying: 0.9, expanding: 0.7, easing: 0.2, thinning: 0, suspending: 0, _default: 0.4 },
                presence: { "drums:in": 0.9, "drums:out": 0 },
                texture: { busy: 0.9, sparse: 0.2 } } },

  { id: "head_sweep", kind: "individual", boldness: "hero",
    description: "The head sweeps the whole room end to end in white, level, and back.",
    occupies: ["head:move"],
    gesture: { group: "head", repeat: "loop", keys: [
      { at: 0, intent: { pan: 0.05, tilt: 0.5, colour: "white", level: 0.9 } }, { at: 4, intent: { pan: 0.95 } }, { at: 8, intent: { pan: 0.05 } } ] },
    requires: g => g.movers.length >= 1,
    fit: g => (g.movers.length >= 1 ? 0.9 : 0),
    affinity: { form: { intro: 0, verse: 0.4, break: 0.3, build: 0.7, drop: 0.9, outro: 0, silence: 0, final_drop: 0.9 },
                texture: { wide: 0.8 },
                presence: { "vocals:in": 0.5 } } },

  { id: "breathe", kind: "individual", boldness: "ambient",
    description: "All lamps breathe a warm amber wash once a bar.",
    occupies: ["pars:level"],
    gesture: { group: "all_pars", keys: [{ at: 0, intent: { colour: [1, 0.7, 0.4], level: 0.7 } }] },
    requires: g => g.pars.length >= 1,
    fit: g => (g.pars.length >= 1 ? 0.8 : 0),
    affinity: { form: { intro: 0.85, verse: 0.2, break: 0.5, build: 0, drop: 0, outro: 0.85, silence: 0.55, final_drop: 0 },
                doing: { establishing: 0.9, suspending: 0.9, thinning: 0.9, closing: 0.9, easing: 0.8, peaking: 0.1, intensifying: 0.2, _default: 0.5 },
                presence: { "drums:out": 0.9, "drums:in": 0.4 },
                texture: { sparse: 0.8, busy: 0.2 } } },

  /* compound: a scripted arc within one span -- whitening into accelerating pops,
     ending dark before the drop. */
  { id: "build_ramp", kind: "compound", boldness: "accent",
    description: "Amber whitens and climbs over the first part of the span, then white strobe pops take over.",
    steps: [{ at: 0, seq: "breathe" }, { at: 0.4, seq: "strobe_pops" }],
    gesture: { steps: [
      { at: 0, gesture: { group: "all_pars", repeat: "once", keys: [
        { at: 0, intent: { colour: [1, 0.6, 0.15], level: 0.4 } }, { at: 4, intent: { colour: [1, 1, 1], level: 1 } } ] } },
      { at: 0.4, gesture: { group: "strobers", keys: [{ at: 0, intent: { colour: [1, 1, 1], level: 1, strobe: 0.7 } }] } } ] },
    occupies: ["pars:colour", "pars:level", "pars:strobe"],
    requires: g => g.pars.length >= 2 && g.strobers.length >= 1,
    fit: g => clamp01(0.5 + 0.1 * g.pars.length),
    affinity: { form: { intro: 0, verse: 0, break: 0.2, build: 0.9, drop: 0.3, outro: 0, silence: 0, final_drop: 0.3 },
                doing: { intensifying: 1, expanding: 0.8, peaking: 0.7, easing: 0.2, thinning: 0.1, _default: 0.4 } } },

  /* combination: several sequences layered concurrently, pre-vetted for taste. Its
     parts must not claim the same fixture-attribute (checked at enumeration). */
  { id: "drop_combo_A", kind: "combination", boldness: "hero",
    description: "The pairs trade magenta and cyan under strobe pops while the head sweeps the room.",
    parts: [{ seq: "pair_call_response" }, { seq: "head_sweep" }, { seq: "strobe_pops" }],
    requires: g => g.inner.length >= 1 && g.outer.length >= 1 &&
      g.movers.length >= 1 && g.strobers.length >= 1,
    fit: g => Math.min(seqFit("pair_call_response", g), seqFit("head_sweep", g),
                       seqFit("strobe_pops", g)),
    affinity: { form: { intro: 0, verse: 0, break: 0, build: 0.3, drop: 0.95, outro: 0, silence: 0, final_drop: 1.0 },
                doing: { peaking: 1, expanding: 0.9, intensifying: 0.8, holding: 0.7, easing: 0.3, _default: 0.5 },
                presence: { "drums:in": 1, "drums:out": 0.1 },
                texture: { busy: 0.9 } } },

  /* ---- one-shots (spec phase B): punctuation a MOMENT draws from the matrix. Each
     maps to one of the renderer's typed effects (gesture.fx) for duration_beats,
     placed at the moment (slot "on"), the beat before ("before") or over the
     moment's span ("span"). affinity.moment lists the kinds and weight bands it
     answers; `_default: 0` vetoes every other moment, so a hush never fires on an
     entrance. Bare bars carry no moment fact, so one-shots never compete with looks. */
  ...[
    { id: "impact", fx: "white_blast", slot: "on", dur: 1, bold: "hero", occ: [],
      form: { intro: 0.3, verse: 0.7, break: 0.7, build: 0.8, drop: 1, outro: 0.3, silence: 0.2, final_drop: 1 },
      moment: { drop: 1, peak: 1, entrance: 1, release: 0.9, accent: 0.7, change: 0.5, transition: 0.6, highlight: 0.6, breakdown: 0.2, heavy: 1, firm: 0.7, light: 0.3, _default: 0 } },
    { id: "breath", fx: "blackout", slot: "before", dur: 1, bold: "hero", occ: [],
      form: { intro: 0.2, verse: 0.6, break: 0.7, build: 0.9, drop: 1, outro: 0.2, silence: 0.2, final_drop: 1 },
      moment: { drop: 1, breakdown: 0.6, build: 0.3, entrance: 1, release: 0.6, heavy: 1, firm: 0, light: 0, _default: 0 } },
    { id: "flash", fx: "white_blast", slot: "on", dur: 1, bold: "accent", occ: [],
      form: { intro: 0.4, verse: 0.8, break: 0.8, build: 0.8, drop: 0.7, outro: 0.4, silence: 0.3, final_drop: 0.7 },
      moment: { tempo_change: 0.9, register_shift: 0.6, entrance: 0.5, accent: 0.9, change: 0.8, highlight: 0.8, release: 0.5, transition: 0.6, light: 1, firm: 0.6, heavy: 0.2, _default: 0 } },
    { id: "hush", fx: "pause", slot: "span", dur: 4, bold: "accent", occ: [],
      form: { intro: 0.6, verse: 1, break: 1, build: 0.8, drop: 0.8, outro: 0.6, silence: 0.8, final_drop: 0.8 },
      moment: { breakdown: 1, pause: 1, heavy: 1, firm: 1, light: 1, _default: 0 } },
    { id: "hook_lift", fx: "hook", slot: "span", dur: 4, bold: "accent", occ: [],
      form: { intro: 0.4, verse: 0.9, break: 0.9, build: 0.9, drop: 0.9, outro: 0.4, silence: 0.3, final_drop: 0.9 },
      moment: { register_shift: 1, hook: 1, heavy: 1, firm: 1, light: 0.8, _default: 0 } },
    { id: "riser", fx: "whiten", slot: "span", dur: 8, bold: "accent", occ: [],
      form: { intro: 0.3, verse: 0.7, break: 0.9, build: 1, drop: 0.6, outro: 0.2, silence: 0.3, final_drop: 0.6 },
      moment: { build: 1, rise: 1, heavy: 1, firm: 1, light: 0.6, _default: 0 } },
    { id: "fill_flicker", fx: "accent_strobe", slot: "span", dur: 4, bold: "accent", occ: ["pars:strobe"],
      form: { intro: 0.1, verse: 0.6, break: 0.8, build: 0.9, drop: 1, outro: 0.1, silence: 0, final_drop: 1 },
      moment: { rhythm_change: 1, build: 0.5, fill: 1, heavy: 1, firm: 1, light: 0.7, _default: 0 } },
    { id: "exit_dip", fx: "modulate", slot: "span", dur: 4, bold: "ambient", occ: [], params: { gain: 0.75, motion: -0.2, doing: "exit" },
      form: { intro: 0.5, verse: 0.9, break: 0.9, build: 0.7, drop: 0.7, outro: 0.9, silence: 0.6, final_drop: 0.7 },
      moment: { exit: 1, breakdown: 0.7, heavy: 1, firm: 1, light: 1, _default: 0 } },
  ].map(o => ({ id: o.id, kind: "oneshot", boldness: o.bold, occupies: o.occ, duration_beats: o.dur,
    gesture: { fx: o.fx, slot: o.slot, ...(o.params ? { params: o.params } : {}) },
    requires: g => g.pars.length >= 1, fit: () => 0.9,
    affinity: { form: o.form, moment: o.moment } })),

  /* A dangerous device type: only enumerated if the layout also carries the enforced
     safety limits for it. A gesture with no enforced limit is never offered. */
  { id: "laser_sweep", kind: "individual", boldness: "hero",
    occupies: ["laser:beam"],
    requires: (g, layout) => g.lasers.length >= 1 &&
      !!(layout.limits && layout.limits.laser_zones),
    fit: g => (g.lasers.length >= 1 ? 0.85 : 0),
    affinity: { form: { intro: 0, verse: 0.2, break: 0.2, build: 0.6, drop: 0.9, outro: 0, silence: 0, final_drop: 0.95 } } },
];

const byIdVocab = id => VOCABULARY.find(v => v.id === id);
/* a combination's gesture is its parts' gestures, layered (frame.js merges them per lamp) */
for (const s of VOCABULARY) if (s.kind === "combination" && !s.gesture && Array.isArray(s.parts))
  s.gesture = { parts: s.parts.map(p => { const q = byIdVocab(p.seq); return q && q.gesture ? q.gesture : null; }).filter(Boolean) };

/* the base looks as a renderer library ({ id -> sequence with its gesture }): the
   palette never carried them, so bake/play rendered them as a plain white wash --
   travelling_pulse never travelled. Merge under the LLM palette: library = { ...palette, ...baseLibrary() }. */
function baseLibrary() {
  const lib = {};
  for (const s of VOCABULARY) if (s.gesture && s.kind !== "oneshot")
    lib[s.id] = { id: s.id, kind: s.kind, boldness: s.boldness, description: s.description || "", occupies: s.occupies || [], gesture: s.gesture };
  return lib;
}
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
    if (!FAMILIES.includes(fam)) return bad("unknown affinity family `" + fam + "`; allowed: " + FAMILIES.join(", "));
    const table = aff[fam];
    if (!table || typeof table !== "object" || Array.isArray(table)) return bad("affinity." + fam + " is not an object");
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
  if (!["individual", "compound", "combination", "oneshot"].includes(seq.kind)) return bad("bad kind");
  if (seq.kind === "oneshot") {
    if (!(Number.isInteger(seq.duration_beats) && seq.duration_beats > 0)) return bad("a oneshot needs duration_beats (a positive integer)");
    const aff = seq.affinity || {};
    if (!aff.moment || typeof aff.moment !== "object") return bad("a oneshot needs affinity.moment");
    if (!seq.gesture || typeof seq.gesture.fx !== "string") return bad("a oneshot needs gesture.fx");
  }
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

/* enumerate(layout, { palette }) -> { sequences, fit, affinity, matrix, report }
   The heuristic BASE vocabulary (computed fit x affinity) is always present and
   deterministic; an optional PALETTE (validated, pre-scored, e.g. LLM-generated)
   is merged on top. affinity is keyed family -> sequence -> fact; matrix is the
   form table (fit x affinity.form) kept for the report and older callers, and
   remains the arranger's contract either way. */
function enumerate(layout, options) {
  options = options || {};
  const g = groupsOf(layout);
  const gate = v => (v >= FIT_FLOOR ? +v.toFixed(4) : 0);

  const keptBase = VOCABULARY.filter(s => s.requires(g, layout) &&
    !(s.kind === "combination" && comboConflicts(s)));

  const matrix = {}, fit = {};
  const affinity = {};
  for (const fam of FAMILIES) affinity[fam] = {};
  const store = (id, aff) => { for (const fam of Object.keys(aff)) affinity[fam][id] = { ...aff[fam] }; };
  const sequences = [];

  for (const s of keptBase) {
    const f = +(s.fit ? s.fit(g) : 0).toFixed(4);
    const row = {};
    for (const ctx of CONTEXTS) row[ctx] = gate(f * ((s.affinity.form && s.affinity.form[ctx]) || 0));
    matrix[s.id] = row; fit[s.id] = f; store(s.id, s.affinity);
    sequences.push({ id: s.id, kind: s.kind, boldness: s.boldness, source: "base",
      fit: f, occupies: s.kind === "combination" ? comboOccupies(s) : (s.occupies || []),
      ...(s.parts ? { parts: s.parts.map(p => p.seq) } : {}),
      ...(s.kind === "oneshot" ? { gesture: s.gesture, duration_beats: s.duration_beats } : {}) });
  }

  let rejected = 0, dup = 0;
  for (const seq of (options.palette || [])) {
    if (matrix[seq && seq.id]) { dup++; continue; }
    const v = validateSequence(seq, layout);
    if (!v.ok) { rejected++; continue; }
    const aff = affinityOf(seq);
    const row = {};
    for (const ctx of CONTEXTS) row[ctx] = gate(aff.form[ctx]);
    const f = +Math.max(...CONTEXTS.map(c => aff.form[c])).toFixed(4);
    matrix[seq.id] = row; fit[seq.id] = f; store(seq.id, aff);
    sequences.push({ id: seq.id, kind: seq.kind, boldness: seq.boldness, source: "llm",
      fit: f, occupies: seq.occupies || [],
      ...(Array.isArray(seq.parts) ? { parts: seq.parts.map(p => p && p.seq).filter(Boolean) } : {}),
      ...(seq.kind === "oneshot" ? { gesture: seq.gesture, duration_beats: seq.duration_beats } : {}) });
  }

  const impossible = VOCABULARY.filter(s => !keptBase.includes(s)).map(s => s.id);
  const weak = sequences.filter(s => CONTEXTS.every(c => matrix[s.id][c] === 0)).map(s => s.id);
  const strongest = {};
  for (const ctx of CONTEXTS) {
    strongest[ctx] = sequences.map(s => ({ id: s.id, score: matrix[s.id][ctx] }))
      .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  }
  /* per fact, the sequences that most want it (their affinity, weighted by fit for
     base sequences) -- so taste stays inspectable per family */
  const strongest_by_fact = {};
  for (const fam of FAMILIES) {
    if (fam === "form") continue;
    strongest_by_fact[fam] = {};
    for (const fact of FACTS[fam]) {
      strongest_by_fact[fam][fact] = sequences
        .map(s => ({ id: s.id, score: affinity[fam][s.id] && affinity[fam][s.id][fact] != null
          ? +((s.source === "base" ? fit[s.id] : 1) * affinity[fam][s.id][fact]).toFixed(4) : 0 }))
        .filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
    }
  }
  const report = { rig: layout.rig || null, can_do: sequences.map(s => s.id),
    impossible, weak, strongest, strongest_by_fact,
    sources: { base: keptBase.length, llm: sequences.length - keptBase.length },
    rejected, dup };

  return { sequences, fit, affinity, matrix, report };
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

/* The arranger's read-only view over a (possibly cached) enumeration result. A
   context may be a form name or a fact VECTOR (facts.js); the cell is computed on
   the fly from the per-family affinity (fit x geomean; a 0 vetoes). A cache that
   predates affinity scores form only from its matrix. */
function view(result) {
  const M = result.matrix || {}, A = result.affinity || null, F = result.fit || {};
  const sequences = result.sequences || [];
  const byId = Object.fromEntries(sequences.map(s => [s.id, s]));
  const gate = v => (v >= FIT_FLOOR ? +v.toFixed(4) : 0);
  const affOf = id => {
    if (!A) return null;
    const out = {};
    for (const fam of FAMILIES) if (A[fam] && A[fam][id]) out[fam] = A[fam][id];
    return out.form ? out : null;
  };
  const fitK = s => (s.source === "llm" ? 1 : (F[s.id] != null ? F[s.id] : (s.fit != null ? s.fit : 1)));
  const score = (s, ctx) => {
    const v = toVector(ctx);
    /* a one-shot is punctuation: it answers a MOMENT and nothing else, so a bar
       without a moment fact never offers one (an unmatched family would be neutral) */
    if (s.kind === "oneshot" && !(v.moment && v.moment.length)) return 0;
    const aff = affOf(s.id);
    if (!aff) return (M[s.id] || {})[v.form] || 0;       /* an older cache: form only */
    return gate(cellFor(aff, fitK(s), v));
  };
  return {
    candidates: ctx => sequences
      .map(s => ({ id: s.id, score: score(s, ctx), boldness: s.boldness }))
      .filter(c => c.score > 0).sort((a, b) => b.score - a.score),
    budget: ctx => BUDGETS[toVector(ctx).form] || DEFAULT_BUDGET,
    seq: id => byId[id] || null,
    facts: FACTS,
  };
}

module.exports = { enumerate, view, validateSequence, validateAffinity, affinityOf, layoutFacts, groupsOf, baseLibrary,
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
  console.log("STRONGEST BY FACT:");
  for (const fam of Object.keys(r.strongest_by_fact || {})) {
    const line = Object.keys(r.strongest_by_fact[fam])
      .filter(f => r.strongest_by_fact[fam][f].length)
      .map(f => f + ": " + r.strongest_by_fact[fam][f].slice(0, 2).map(x => x.id).join("/"))
      .join("   ");
    if (line) console.log("  " + fam.padEnd(9) + line);
  }
  console.log(`\n-> ${out}`);
}
