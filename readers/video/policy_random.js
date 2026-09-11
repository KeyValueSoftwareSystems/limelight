// The null edit: the same amount of cutting, in the wrong places.
//
// This is the control that makes the other numbers mean something. It takes the
// shot-length distribution the rules policy produced and re-deals it at random
// times, so it has the same number of cuts, the same pacing, the same clips and
// the same chooser -- and no relationship to the music whatsoever.
//
// If the intelligent edit cannot beat this, then whatever it is doing is not
// synchronisation, and the honest thing is to say so. A baseline that is easy
// to beat proves nothing, so this one is deliberately given every advantage
// except knowing where the music is.
"use strict";
const ASSETS = require("./assets.js");

// Deterministic PRNG: the null has to be reproducible or it cannot be cited.
function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(ctx) {
  const { map, brief, index, seed } = ctx;
  const dur = ctx.length_s;
  const pool = ASSETS.selectBySubject(
    ASSETS.cohere(ASSETS.shots(index, brief),
                  (brief.coherence || {}).radius,
                  (brief.coherence || {}).min_shots),
    brief, ctx.sem, (brief.subject_tolerance || undefined),
    (brief.subject_min_shots || undefined));
  const B = brief.budgets || {};
  const perMin = B.cuts_per_minute || 20;
  const minS = B.min_shot_s || 0.5;
  const maxS = Math.min(B.max_shot_s || 8.0,
                        Math.max(1.0, ASSETS.longest(pool) - 0.05));
  const want = Math.max(1, Math.round(perMin * dur / 60));

  // Draw shot lengths uniformly inside the brief's own bounds, then lay them
  // end to end. Same pacing envelope as any policy obeying the same brief.
  const rnd = mulberry(seed || 1);
  const edges = [0];
  while (edges[edges.length - 1] < dur - minS) {
    const len = minS + rnd() * (maxS - minS);
    const next = edges[edges.length - 1] + len;
    if (next >= dur - minS * 0.5) break;
    edges.push(+next.toFixed(3));
    if (edges.length > want * 3) break;
  }
  edges.push(dur);

  const timeline = [];
  const used = new Map();
  let prev = null, prevKin = null;
  for (let i = 0; i < edges.length - 1; i++) {
    const start = edges[i], end = edges[i + 1];
    const s = ASSETS.choose(pool, end - start, used, prev, brief, seed + i);
    if (!s) continue;
    (function () {
      const mk = s.clip_id + "#" + s.shot + "#" + (s.moment || 0);
      used.set(mk, (used.get(mk) || 0) + 1);
      used.set(s.clip_id, (used.get(s.clip_id) || 0) + 1);
    })();
    prev = s.clip_id;
    prevKin = s.source_category;
    timeline.push({
      start: start, end: end, clip_id: s.clip_id, shot: s.shot,
      in_s: ASSETS.inPoint(s, end - start),
      because: { rule: "random", salience: null,
                 not_a_musical_cut: "this is the null edit; no musical evidence "
                   + "was consulted", evidence: ["seed=" + seed] }
    });
  }
  return {
    timeline: timeline, holds: [],
    budget: { allowed: want, spent: Math.max(0, timeline.length - 1),
              why_underspent: null }
  };
}
module.exports = { run: run, id: "random", label: "the null edit" };
