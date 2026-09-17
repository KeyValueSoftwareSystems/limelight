"use strict";
const H = require("./helpers");
module.exports = function converge(params, ctx) {
  const colour = H.parseColour(params.colour, [1, 1, 1]);
  const level = params.level != null ? params.level : 0.9;
  const keep = params.rest != null ? params.rest : 0.28;
  const pan = params.pan != null ? params.pan : 0.662;
  const tilt = params.tilt != null ? params.tilt : 0.30;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * (params.for_beats || 4));
  const frames = [];
  for (let i = 0; i < N; i++) {
    const k = H.easeInOut(i / (N - 1 || 1));
    const f = H.emptyFrame();
    for (const p of H.PARS) H.setPar(f, p, colour, keep);
    H.setHeadsMirror(f, {
      level: level * (0.35 + 0.65 * k), colour,
      pan: 0.40 + (pan - 0.50) * k,
      tilt: 0.50 + (tilt - 0.50) * k,
      prism: k > 0.7 ? 100 : 0,
    });
    frames.push(f);
  }
  return { frames, loop_beats: 0, per_fixture: H.PAR_IDS.concat(H.HEAD_IDS) };
};
