"use strict";
const H = require("./helpers");
module.exports = function fade(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 0.75, 0.35]);
  const pars = H.parsForExtent(params.extent || "all");
  const from = params.from != null ? params.from : 0.7;
  const to = params.to != null ? params.to : 0.05;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * (params.over_beats || 8));
  const frames = [];
  for (let i = 0; i < N; i++) {
    const k = from + (to - from) * H.easeSettle(i / (N - 1 || 1));
    const f = H.emptyFrame();
    for (const p of pars) H.setPar(f, p, colour, k);
    H.setHeadsMirror(f, { level: k * 0.85, colour, pan: 0.55, tilt: 0.46 });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
