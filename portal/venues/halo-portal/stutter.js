"use strict";
const H = require("./helpers");
module.exports = function stutter(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const pars = H.parsForExtent(params.extent || "all");
  const per = params.per_beat != null ? params.per_beat : 4;
  const level = params.level != null ? params.level : 0.9;
  const beats = params.for_beats || 2;
  const fpb = H.framesPerBeat(ctx.bpm);
  const N = Math.max(2, fpb * beats);
  const slot = Math.max(1, Math.round(fpb / per));
  const frames = [];
  for (let i = 0; i < N; i++) {
    const on = (i % slot) < Math.max(1, Math.round(slot * 0.5));
    const decay = 1 - 0.4 * (i / N);
    const f = H.emptyFrame();
    for (const p of pars) H.setPar(f, p, colour, on ? level * decay : 0);
    H.setHeadsAll(f, { level: on ? level * decay : 0, colour, pan: 0.55, tilt: 0.44 });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
