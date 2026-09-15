"use strict";
const H = require("./helpers");

module.exports = function impact(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const extent = params.extent || "all";
  const forBeats = params.for_beats || 1;
  const pars = H.parsForExtent(extent);
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = fpb * forBeats;

  const frames = [];
  for (let i = 0; i < total; i++) {
    const t = i / total;
    const env = H.hitEnv(t);
    const frame = H.emptyFrame();
    for (const p of pars) H.setPar(frame, p, colour, env);
    for (const h of H.HEADS) H.setHead(frame, h, { level: env, colour });
    frames.push(frame);
  }

  return {
    frames,
    loop_beats: forBeats,
    per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS),
  };
};
