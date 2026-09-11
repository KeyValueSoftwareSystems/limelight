// The control: what you get WITHOUT this project.
//
// No map. It is not given beats, downbeats, chapters, moments, spans, energy,
// accents or the pump envelope -- the whole point of the comparison is that
// this is what the same footage and the same song look like when nothing has
// measured the music. It cuts on a timer and picks clips in the order they came
// out of the catalogue.
//
// It is deliberately NOT a straw man. It gets:
//   - the same clips, the same window, the same output format
//   - the same NUMBER of cuts as the intelligent edit, so it is never losing
//     merely because it is slower or busier
//   - the same compiler and the same encoder
//
// What it does not get is any knowledge of where it is in the song. That
// difference, and nothing else, is what the A/B is measuring.
"use strict";
const ASSETS = require("./assets.js");

function run(ctx) {
  const { brief, index, seed } = ctx;
  const dur = ctx.length_s;
  const win = ctx.window || { from: 0, to: dur };
  const span = win.to - win.from;

  // Match the shot count of whatever it is being compared against, so pacing is
  // held constant and only placement differs.
  const shots = Math.max(2, parseInt(ctx.flatShots || "13", 10));
  const every = span / shots;

  // The SAME pool the intelligent policy gets, including the brief's subject
  // selection. Without this the control was drawing from assets/generated --
  // the synthetic answer-sheet clips of a disc moving over noise, which sort
  // first by clip_id -- and a comparison against test-harness footage measures
  // nothing at all.
  const pool = ASSETS.selectBySubject(
    ASSETS.shots(index, brief), brief, ctx.sem,
    undefined, brief.subject_min_shots || undefined);
  // The SAME chooser the intelligent policy uses.
  //
  // This was catalogue order -- alphabetical by clip_id, no fit, no continuity,
  // no variety -- and that was an unfair fight. Fit scoring, continuity and the
  // subject-variety penalty come from the BRIEF and the clip index; none of
  // them needs a map. Withholding them was handicapping the control with tools
  // it should have had, which proves nothing except that a crippled baseline
  // loses.
  //
  // The one thing it does not get is knowledge of WHERE IT IS IN THE SONG. It
  // cuts on a timer. That difference, and nothing else, is what the A/B is for.
  const timeline = [];
  const used = new Map();
  let prev = null, prevKin = null;
  for (let i = 0; i < shots; i++) {
    const start = win.from + i * every;
    const end = i === shots - 1 ? win.to : win.from + (i + 1) * every;
    const want = end - start;
    // impact 0 and no mood: both are musical judgements and it has none.
    const s = ASSETS.choose(pool, want, used, prev, brief, seed + i,
                            prevKin, false, 0, null, null, null);
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
      in_s: ASSETS.inPoint(s, Math.min(want, s.duration)),
      because: { rule: "timer", salience: null,
                 not_a_musical_cut: "cut every " + every.toFixed(2) + "s; the "
                   + "music was not consulted",
                 evidence: ["no map"] }
    });
  }
  return {
    timeline: timeline, holds: [],
    budget: { allowed: shots, spent: shots - 1, why_underspent: null,
              note: "fixed interval, no map" }
  };
}
module.exports = { run: run, id: "flat", label: "no map: cut on a timer" };
