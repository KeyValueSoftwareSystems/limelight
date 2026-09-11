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

  const pool = ASSETS.shots(index, brief);
  // Catalogue order. No fit, no continuity, no climax -- there is nothing to be
  // climactic about without a map.
  const ordered = pool.slice().sort(function (a, b) {
    return a.clip_id === b.clip_id ? a.shot - b.shot
                                   : (a.clip_id < b.clip_id ? -1 : 1);
  });

  const timeline = [];
  for (let i = 0; i < shots; i++) {
    const start = win.from + i * every;
    const end = i === shots - 1 ? win.to : win.from + (i + 1) * every;
    const s = ordered[i % ordered.length];
    if (!s) continue;
    const want = end - start;
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
