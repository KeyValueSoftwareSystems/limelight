// The baseline: cut on the beat, and think about nothing else.
//
// This is the thing the whole lane exists to beat, so it is written to be a
// FAIR opponent rather than a straw man. It gets the same map, the same clips,
// the same brief and the same chooser as the intelligent policy. It respects
// the brief's shot-length bounds, because a baseline that emits 0.1-second
// shots would lose for a reason that has nothing to do with musical
// understanding.
//
// What it does not get is the argument of this project: it never looks at where
// it is in the song, what is coming, what already happened, or whether a moment
// is worth spending a cut on. It divides the beat grid by a constant and cuts.
"use strict";
const ASSETS = require("./assets.js");

function run(ctx) {
  const { map, brief, index, seed } = ctx;
  const beats = (map.beats || []).slice();
  const dur = ctx.length_s;
  const pool = ASSETS.cohere(ASSETS.shots(index, brief),
                             (brief.coherence || {}).radius,
                             (brief.coherence || {}).min_shots);

  // Choose the beat multiple that lands nearest the brief's cut budget, so the
  // baseline is spending the same attention as the policy it is compared with.
  const perMin = (brief.budgets && brief.budgets.cuts_per_minute) || 20;
  const wantCuts = Math.max(1, Math.round(perMin * dur / 60));
  let every = Math.max(1, Math.round(beats.length / wantCuts));
  const minS = (brief.budgets && brief.budgets.min_shot_s) || 0.5;

  const cuts = [];
  for (let i = 0; i < beats.length; i += every) {
    const t = beats[i];
    if (t <= 0.001 || t >= dur) continue;
    if (cuts.length && t - cuts[cuts.length - 1] < minS) continue;
    cuts.push(t);
  }

  // The same footage limit the rules policy obeys. Applied here too, so that a
  // difference between the two edits is never just that one of them was allowed
  // to ask for shots the clips cannot supply.
  const cap = Math.max(1.0, ASSETS.longest(pool) - 0.05);
  const edges = ASSETS.capSlots([0].concat(cuts, [dur]), cap, [], null).edges;
  const timeline = [];
  const used = new Map();
  let prev = null, prevKin = null;
  for (let i = 0; i < edges.length - 1; i++) {
    const start = edges[i], end = edges[i + 1];
    const want = end - start;
    const s = ASSETS.choose(pool, want, used, prev, brief, seed, prevKin, false);
    if (!s) continue;
    used.set(s.clip_id + "#" + s.shot + "#" + (s.moment || 0),
             (used.get(s.clip_id + "#" + s.shot + "#" + (s.moment || 0)) || 0) + 1);
    prev = s.clip_id;
    prevKin = s.source_category;
    timeline.push({
      start: +start.toFixed(3), end: +end.toFixed(3),
      clip_id: s.clip_id, shot: s.shot,
      in_s: ASSETS.inPoint(s, want),
      because: { rule: "every-" + every + "-beats", salience: null,
                 evidence: ["beats[" + (i * every) + "]"] }
    });
  }
  return {
    timeline: timeline,
    holds: [],   // it never decides to do nothing; that is the point
    budget: { allowed: wantCuts, spent: Math.max(0, timeline.length - 1),
              why_underspent: null }
  };
}
module.exports = { run: run, id: "naive", label: "beat -> cut" };
