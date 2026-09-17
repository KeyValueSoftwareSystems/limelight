"use strict";
const H = require("./helpers");
module.exports = function bump(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const pars = H.parsForExtent(params.extent || "all");
  const N = Math.max(2, Math.round(H.framesPerBeat(ctx.bpm) * (params.for_beats || 0.5)));
  const frames = [];
  for (let i = 0; i < N; i++) {
    const env = i < Math.max(1, Math.round(N * 0.25)) ? 1 : 0;
    const f = H.emptyFrame();
    for (const p of pars) H.setPar(f, p, colour, env);
    H.setHeadsMirror(f, { level: env, colour, pan: 0.55, tilt: 0.46 });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
