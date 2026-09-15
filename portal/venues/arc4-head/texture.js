"use strict";
const H = require("./helpers");
module.exports = function texture(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const keep = params.rest != null ? params.rest : 0.12;
  const level = params.level != null ? params.level : 0.85;
  const gobo = params.gobo != null ? params.gobo : 40;
  const spin = params.spin !== false;
  const loop = Math.max(1, Math.round(params.for_beats || 8));
  const N = Math.max(4, H.framesPerBeat(ctx.bpm) * loop);
  const frames = [];
  for (let i = 0; i < N; i++) {
    const p = i / N;
    const f = H.emptyFrame();
    for (const par of H.PARS) H.setPar(f, par, colour, keep);
    H.setHead(f, H.HEADS[0], {
      level, colour, gobo,
      prism: spin && p > 0.25 ? 100 : 0,
      pan: 0.60 + 0.12 * Math.sin(2 * Math.PI * p),
      tilt: 0.38 + 0.08 * Math.sin(4 * Math.PI * p),
    });
    frames.push(f);
  }
  return { frames, loop_beats: loop, per_fixture: H.PAR_IDS.concat(H.HEAD_IDS) };
};
