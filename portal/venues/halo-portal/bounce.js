"use strict";
const H = require("./helpers");
module.exports = function bounce(params, ctx) {
  const cols = H.parseColours(params.colours, [[1, 0.35, 0.15], [0.2, 0.5, 1]]);
  const pars = H.parsForExtent(params.extent || "all");
  const level = params.level != null ? params.level : 0.7;
  const per = params.per_beat != null ? params.per_beat : 1;
  const loop = Math.max(1, Math.round(params.for_beats || 4));
  const fpb = H.framesPerBeat(ctx.bpm);
  const N = Math.max(2, fpb * loop);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const step = Math.floor((i / fpb) * per);
    const c = cols[step % 2];
    const into = ((i / fpb) * per) % 1;
    const k = level * (0.75 + 0.25 * (1 - into));
    const f = H.emptyFrame();
    for (const p of pars) H.setPar(f, p, c, k);
    H.setHeadsAll(f, { level: k * 0.8, colour: c, pan: 0.662, tilt: 0.45 });
    frames.push(f);
  }
  return { frames, loop_beats: loop, per_fixture: pars.map(p => p.id).concat(H.HEAD_IDS) };
};
