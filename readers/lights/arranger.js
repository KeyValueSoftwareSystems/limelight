"use strict";
/* The arranger: a seeded, arc-aware PLAN for one song.
   ---------------------------------------------------------------------------
   plan(score, enumResult, seed) reads each section, derives a lighting CONTEXT
   from the song's energy curve and its place in the arc, looks that context up in
   the enumeration matrix, and draws a sequence with a seeded PRNG. It is a pure
   function of (score, seed): identical inputs -> identical plan, and nothing here
   depends on tempo or wall time (the protocol's two-clock rule -- the transport
   owns rate; the plan is in bars/beats). No LLM at play time.

   The score is the format the score endpoint returns: a grid, a flat list of
   `sections` (from/to in bar/beat, a feel name, a repeat label -- and, in other
   songs, possibly overlapping), and a per-bar `energy` curve, plus optional
   `parts` (rise/feels). Sections' feel names are noisy, so ENERGY + ARC drive the
   context; feel/rise only break ties. Overlapping sections yield concurrent
   assignments (conflict-avoided). */
const { view } = require("./preflight.js");

const clamp01 = v => Math.max(0, Math.min(1, v));

/* a small, fast, seedable PRNG -- deterministic for a given seed */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickWeighted = (cands, rng) => {
  if (!cands.length) return null;
  const total = cands.reduce((s, c) => s + c.score, 0);
  let r = rng() * total;
  for (const c of cands) { r -= c.score; if (r <= 0) return c; }
  return cands[cands.length - 1];
};

/* ---- reading the score ------------------------------------------------- */
function energyReader(score) {
  /* two shapes in the wild: {per, from_bar, values} (levels) and a bare per-bar
     array (raga). For a bare array, anchor it to the first section's bar. */
  let from, vals;
  if (Array.isArray(score.energy)) {
    vals = score.energy;
    from = (score.sections && score.sections.length)
      ? Math.min(...score.sections.map(s => s.from.bar)) : 1;
  } else {
    const E = score.energy || {};
    from = E.from_bar || 1; vals = E.values || [];
  }
  return bar => {
    const i = Math.round(bar) - from;
    if (i <= 0) return vals[0] || 0;
    if (i >= vals.length) return vals[vals.length - 1] || 0;
    return vals[i];
  };
}
function sectionEnergyMean(sec, energyAt) {
  let s = 0, n = 0;
  for (let b = sec.from.bar; b < sec.to.bar; b++) { s += energyAt(b); n++; }
  return n ? s / n : energyAt(sec.from.bar);
}
function partRise(sec, score) {
  const p = (score.parts || []).find(p => p.from_bar <= sec.from.bar && sec.from.bar <= p.to_bar);
  return p && typeof p.rise === "number" ? p.rise : null;
}

/* ---- energy + arc -> a lighting context (a matrix column) --------------- */
const HIGH = 0.5, VLOW = 0.1;
function contextsFor(sections, energyAt, score) {
  const means = sections.map(s => sectionEnergyMean(s, energyAt));
  const highIdx = means.map((m, j) => [j, m]).filter(x => x[1] >= HIGH).map(x => x[0]);
  const lastHigh = highIdx.length ? highIdx[highIdx.length - 1] : -1;
  return sections.map((sec, i) => {
    const e = means[i], first = i === 0, last = i === sections.length - 1;
    if (e >= HIGH) return i === lastHigh ? "final_drop" : "drop";
    if (first) return "intro";
    if (last) return "outro";
    if (e < VLOW) return "silence";
    const rise = partRise(sec, score);
    if ((rise !== null && rise > 0.05) || sec.name === "building") return "build";
    return "break";
  });
}

/* ---- the plan ---------------------------------------------------------- */
function plan(score, enumResult, seed) {
  const rng = mulberry32((seed || 0) >>> 0);
  const V = view(enumResult);
  const energyAt = energyReader(score);
  const sections = score.sections || [];
  const contexts = contextsFor(sections, energyAt, score);

  const bpb = (score.grid && score.grid.beats_per_bar) || 4;
  const atBeat = p => (p.bar - 1) * bpb + ((p.beat || 1) - 1);
  const beatsOverlap = (a, b) => a[0] < b[1] && b[0] < a[1];
  const occOf = id => { const s = V.seq(id); return (s && s.occupies) || []; };

  const assignments = [], placed = [];
  sections.forEach((sec, i) => {
    const context = contexts[i];
    let cands = V.candidates(context);
    if (!cands.length) cands = V.candidates("verse");   // safe fallback
    const pick = pickWeighted(cands, rng);
    const rate = +(0.75 + 0.5 * rng()).toFixed(2);      // the sequence's own time-scale
    const hue = +rng().toFixed(3);                       // a seeded colour rotation hint
    if (!pick) return;

    /* overlap conflict-avoidance: if this section overlaps ones already placed,
       don't let two concurrent sequences claim the same fixture-attribute. Keep the
       seeded pick unless it clashes; then take the best non-clashing candidate. */
    const span = [atBeat(sec.from), atBeat(sec.to)];
    const activeOcc = placed.filter(p => beatsOverlap(p.span, span)).flatMap(p => p.occ);
    let chosen = pick;
    if (occOf(pick.id).some(t => activeOcc.includes(t))) {
      const alt = cands.find(c => !occOf(c.id).some(t => activeOcc.includes(t)));
      if (alt) chosen = alt;
    }
    const occ = occOf(chosen.id);
    const clash = occ.some(t => activeOcc.includes(t));   // true only if no clean option existed

    const e = sectionEnergyMean(sec, energyAt);
    const intensity = context === "final_drop" ? 1.0 : +Math.min(0.95, 0.35 + 0.6 * e).toFixed(3);
    placed.push({ span, occ });
    assignments.push({
      from: sec.from, to: sec.to, seq_id: chosen.id, context,
      layer: "section", priority: i, clash,
      params: { intensity, rate, hue },
      occupies: occ, section: sec.name, repeat: sec.repeat,
    });
  });

  return { seed: (seed || 0) >>> 0, grid: score.grid, contexts, assignments };
}

module.exports = { plan, contextsFor, sectionEnergyMean, energyReader };

/* ---- CLI: plan a score and print the show, section by section ------------
     node readers/lights/arranger.js [readers/lights/levels.score.json] [seed]   */
if (require.main === module) {
  const fs = require("fs"), path = require("path");
  const { enumerate } = require("./preflight.js");
  const scoreFile = process.argv[2] || path.join(__dirname, "levels.score.json");
  const seed = +(process.argv[3] || 1);
  const score = JSON.parse(fs.readFileSync(scoreFile, "utf8"));
  const layout = JSON.parse(fs.readFileSync(path.join(__dirname, "arc4-head.layout.json"), "utf8"));
  let palette = [];
  try { palette = JSON.parse(fs.readFileSync(path.join(__dirname, "arc4-head.palette.json"), "utf8")); } catch (e) {}
  const en = enumerate(layout, { palette });
  const p = plan(score, en, seed);
  console.log(`\n${score.score || "song"} — plan @ seed ${seed}   (${p.assignments.length} sections, ${en.sequences.length}-sequence palette)`);
  for (const a of p.assignments)
    console.log("  bar " + String(a.from.bar).padStart(3) + "-" + String(a.to.bar).padStart(3) +
      "  " + String(a.section || "").padEnd(13) + " " + a.context.padEnd(11) +
      " -> " + a.seq_id.padEnd(26) + " i=" + a.params.intensity + " rate=" + a.params.rate +
      (a.clash ? " [clash]" : ""));
}
