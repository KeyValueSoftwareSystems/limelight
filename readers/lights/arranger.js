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

/* ---- per-phase dynamics (from the Arc Rig Playbook) ---------------------
   floor/peak = PAR contrast (dark floor, full peak: the same peak feels harder
   from a lower floor); mode = how the level moves; head = the head's dimmer floor;
   motion = how hard the head moves (0 slow breath .. 1 room-wide, fast). */
const DYN = {
  intro:      { floor: 0.25, peak: 0.55, mode: "breathe", head: 0.45, motion: 0.30 },
  verse:      { floor: 0.28, peak: 1.00, mode: "hit",     head: 0.70, motion: 0.55 },
  break:      { floor: 0.12, peak: 1.00, mode: "hit",     head: 0.50, motion: 0.70 },
  build:      { floor: 0.18, peak: 1.00, mode: "hit",     head: 0.75, motion: 0.85 },
  drop:       { floor: 0.55, peak: 1.00, mode: "hit",     head: 0.90, motion: 1.00 },
  final_drop: { floor: 0.60, peak: 1.00, mode: "hit",     head: 1.00, motion: 1.00 },
  outro:      { floor: 0.05, peak: 0.40, mode: "breathe", head: 0.40, motion: 0.30 },
  silence:    { floor: 0.08, peak: 0.35, mode: "breathe", head: 0.35, motion: 0.30 },
};

/* ---- the plan: a PAR look AND a head look for EVERY section -------------- */
function plan(score, enumResult, seed) {
  const rng = mulberry32((seed || 0) >>> 0);
  const V = view(enumResult);
  const energyAt = energyReader(score);
  const sections = score.sections || [];
  const contexts = contextsFor(sections, energyAt, score);

  const bpb = (score.grid && score.grid.beats_per_bar) || 4;
  const atBeat = p => (p.bar - 1) * bpb + ((p.beat || 1) - 1);
  const fromBeat = B => ({ bar: Math.floor(B / bpb) + 1, beat: (((B % bpb) + bpb) % bpb) + 1 });
  const occOf = id => { const s = V.seq(id); return (s && s.occupies) || []; };

  /* classify a candidate by which fixtures it drives */
  const groupOf = id => {
    const o = occOf(id);
    const par = o.some(t => t.startsWith("pars:") || t.startsWith("all_pars"));
    const head = o.some(t => t.startsWith("head:"));
    return par && head ? "combo" : par ? "par" : head ? "head" : "other";
  };
  const pickFor = (ctx, grp) => {
    const all = V.candidates(ctx);
    const same = all.filter(c => groupOf(c.id) === grp);
    return pickWeighted(same.length ? same : all, rng);
  };

  const assignments = [];
  sections.forEach((sec, i) => {
    const context = contexts[i];
    const dyn = DYN[context] || DYN.verse;
    const e = sectionEnergyMean(sec, energyAt);
    const boldness = context === "final_drop" ? 1 : clamp01(0.6 + 0.4 * e);
    const rate = +(0.85 + 0.3 * rng()).toFixed(2);
    const hue = +rng().toFixed(3);

    /* the PARs: a look + the phase's contrast (floor/peak/mode) */
    const par = pickFor(context, "par");
    if (par) assignments.push({
      from: sec.from, to: sec.to, seq_id: par.id, context, layer: "par", priority: 0,
      params: { rate, hue, floor: dyn.floor, peak: dyn.peak, mode: dyn.mode, intensity: boldness },
      occupies: occOf(par.id), section: sec.name,
    });

    /* the head: always moving/lit, its own colour voice, speed by phase */
    const head = pickFor(context, "head");
    if (head) assignments.push({
      from: sec.from, to: sec.to, seq_id: head.id, context, layer: "head", priority: 1,
      params: { rate, hue, headDim: dyn.head, motion: dyn.motion, intensity: dyn.head },
      occupies: occOf(head.id), section: sec.name,
    });

    /* contrast at a drop: the last beat before it is black, its first beat blasts white */
    if (context === "drop" || context === "final_drop") {
      const f = atBeat(sec.from);
      assignments.push({ from: fromBeat(f - 1), to: sec.from, context, layer: "fx",
        priority: 9, type: "blackout", params: {}, occupies: [], section: sec.name });
      assignments.push({ from: sec.from, to: fromBeat(f + 1), context, layer: "fx",
        priority: 9, type: "white_blast", params: {}, occupies: [], section: sec.name });
    }
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
