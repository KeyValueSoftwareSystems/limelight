// The edit a model asked for, executed by the same machinery as every other.
//
// This reads a COMMITTED intent.json written by readers/video/intent.py. It does
// not call anything. That is deliberate: an edit that depends on a live model
// call is an edit nobody can reproduce, and `frame = f(map, layout, recipe, t)`
// stops being true the moment a network round-trip sits inside it. The model is
// a build-time author whose output is reviewable as a diff.
//
// Everything after the choice of cut points is shared with policy_rules -- same
// chooser, same footage cap, same in-points. So a difference between the two
// edits is a difference in WHERE THEY CUT and nowhere else, which is the only
// way the A/B answers anything.
"use strict";
const fs = require("fs"), path = require("path");
const ASSETS = require("./assets.js");

function run(ctx) {
  const { map, brief, index, seed, slug } = ctx;
  const dur = ctx.length_s;
  const ROOT = path.resolve(__dirname, "..", "..");
  const p = ctx.intent || path.join(ROOT, "renders",
    slug + "." + (ctx.briefId || brief.id) + ".intent.json");
  if (!fs.existsSync(p)) {
    throw new Error("no intent file at " + p + " -- run:\n" +
      "  python3 readers/video/intent.py --slug " + slug +
      " --brief " + (brief.id || ""));
  }
  const intent = JSON.parse(fs.readFileSync(p, "utf8"));
  const cands = intent.candidates || [];
  const B = brief.budgets || {};
  const minS = B.min_shot_s || 0.5, maxS = B.max_shot_s || 8.0;
  const beats = map.beats || [];

  function snap(t, hard) {
    let best = t, bd = hard ? Infinity : 0.12;
    for (const b of beats) {
      const d = Math.abs(t - b);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  // Cuts the model asked for snap only if a beat is close. Cuts forced by a cap
  // snap unconditionally -- they were chosen for nothing, so there is nothing
  // for the grid to pull them away from.
  const snapHard = function (t) { return snap(t, true); };

  // The model chose indices; the times come from the candidate list, which was
  // measured. Nothing here reads a number the model typed.
  const chosen = [];
  for (const i of intent.cut_indices || []) {
    const c = cands[i];
    if (!c) continue;
    const t = snap(c.t);
    if (t > minS && t < dur - minS &&
        !chosen.some(function (x) { return Math.abs(x.t - t) < minS; })) {
      chosen.push({ t: t, kind: c.kind, ref: c.ref, strength: c.strength, i: i });
    }
  }
  chosen.sort(function (a, b) { return a.t - b.t; });

  const pool = ASSETS.selectBySubject(
    ASSETS.cohere(ASSETS.shots(index, brief),
                  (brief.coherence || {}).radius,
                  (brief.coherence || {}).min_shots),
    brief, ctx.sem, (brief.subject_tolerance || undefined),
    (brief.subject_min_shots || undefined));
  const footageCap = Math.max(1.0, ASSETS.longest(pool) - 0.05);
  const cap = Math.min(maxS, footageCap);
  const capBoundBy = maxS <= footageCap ? "brief-max-shot" : "footage-limit";
  // The model's holds, as intervals, before the timeline exists. Inside one,
  // only the footage limit applies -- the brief's max_shot_s is a default about
  // ordinary shots and a hold is an explicit instruction to override it.
  const protect = (intent.holds || []).map(function (h) {
    const a = h.from_index == null ? 0 : (cands[h.from_index] || {}).t;
    const b = h.to_index == null ? dur : (cands[h.to_index] || {}).t;
    return (a === undefined || b === undefined || !(b > a)) ? null : [a, b];
  }).filter(Boolean);
  function capAt(t) {
    for (const [a, b] of protect) if (t >= a - 1e-6 && t < b - 1e-6) return footageCap;
    return cap;
  }
  let edges = [0].concat(chosen.map(function (c) { return c.t; }));
  edges.push(dur);
  const capped = ASSETS.capSlots(edges, capAt, [], snapHard);
  edges = capped.edges;
  const forced = new Set(capped.forced.map(function (t) { return t.toFixed(3); }));

  // The model's holds, translated from indices to times. Kept even where the
  // footage cap later put a cut inside one -- a hold that could not be honoured
  // is worth recording as such, not worth deleting.
  const holds = (intent.holds || []).map(function (h) {
    const a = h.from_index === null || h.from_index === undefined
      ? 0 : (cands[h.from_index] ? cands[h.from_index].t : null);
    const b = h.to_index === null || h.to_index === undefined
      ? dur : (cands[h.to_index] ? cands[h.to_index].t : null);
    if (a === null || b === null || !(b > a)) return null;
    const cutsInside = edges.filter(function (t) { return t > a + 1e-6 && t < b - 1e-6; });
    return {
      start: +a.toFixed(3), end: +b.toFixed(3),
      reason: String(h.reason || "").slice(0, 400),
      honoured: cutsInside.length === 0,
      broken_by: cutsInside.length ? cutsInside.length + " cut(s): no clip is "
        + "long enough to hold " + (b - a).toFixed(1) + "s (longest is "
        + footageCap.toFixed(1) + "s)" : null,
      evidence: ["intent.holds", "llm"]
    };
  }).filter(Boolean);

  const used = new Map();
  const timeline = [];
  let prev = null, prevKin = null;
  // Where the picture is ALLOWED to change world: a named section beginning.
  // Everywhere else the chooser holds the world it is in, so a run of shots
  // reads as one place. This is the map earning its keep for video -- chapters
  // were already there and the first version of this ignored them.
  const chapterAt = (map.chapters || []).map(function (c) { return c.at; });
  function isBoundary(t) {
    return chapterAt.some(function (c) { return Math.abs(c - t) < 0.75; });
  }
  for (let i = 0; i < edges.length - 1; i++) {
    const start = edges[i], end = edges[i + 1];
    const want = end - start;
    if (want < 0.15) continue;
    const c = chosen.find(function (x) { return Math.abs(x.t - start) < 1e-6; });
    const s = ASSETS.choose(pool, want, used, prev, brief, seed,
                            prevKin, isBoundary(start));
    if (!s) continue;
    (function () {
      const mk = s.clip_id + "#" + s.shot + "#" + (s.moment || 0);
      used.set(mk, (used.get(mk) || 0) + 1);
      used.set(s.clip_id, (used.get(s.clip_id) || 0) + 1);
    })();
    prev = s.clip_id + "#" + s.shot;
    prevKin = s.source_category;
    timeline.push({
      start: +start.toFixed(3), end: +end.toFixed(3),
      clip_id: s.clip_id, shot: s.shot,
      in_s: ASSETS.inPoint(s, want),
      because: forced.has(Number(start).toFixed(3))
        ? { rule: capBoundBy, salience: null,
            not_a_musical_cut: "forced by a cap; neither the music nor the " +
              "model asked for this cut",
            evidence: ["brief.budgets.max_shot_s=" + maxS] }
        : { rule: c ? "llm:" + c.kind : "start",
            salience: c ? c.strength : null,
            salience_is: "kind+salience(uncorroborated)",
            evidence: c ? [c.ref, "intent.cut_indices[" + c.i + "]"] : ["timeline start"] }
    });
  }

  return {
    timeline: timeline, holds: holds,
    budget: {
      allowed: intent.budget_allowed,
      spent: Math.max(0, timeline.length - 1),
      chosen_by_model: (intent.cut_indices || []).length,
      forced_without_musical_reason: capped.forced.length,
      forced_by: capBoundBy,
      strategy: intent.strategy,
      why_underspent: null
    }
  };
}
module.exports = { run: run, id: "llm", label: "LLM-authored creative intent" };
