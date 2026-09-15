"use strict";
const H = require("./helpers");

module.exports = function stab(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 0.75, 0.35]);
  const extent = params.extent || "inner";
  const forBeats = params.for_beats || 1;
  const pars = H.parsForExtent(extent);
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = fpb * forBeats;

  const frames = [];
  for (let i = 0; i < total; i++) {
    const t = i / total;
    const env = H.hitEnv(t);
    const frame = H.emptyFrame();
    for (const p of pars) H.setPar(frame, p, colour, env * 0.9);
    frames.push(frame);
  }

  return {
    frames,
    loop_beats: forBeats,
    per_fixture: pars.map(p => p.id),
  };
};
