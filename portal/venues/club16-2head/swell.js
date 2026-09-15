"use strict";
const H = require("./helpers");

module.exports = function swell(params, ctx) {
  const colour = H.parseColour(params.colour, [0.2, 0.4, 1]);
  const forBeats = params.for_beats || 4;
  const rise = params.rise != null ? params.rise : 0.5;
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = fpb * forBeats;

  const frames = [];
  for (let i = 0; i < total; i++) {
    const t = i / (total - 1 || 1);
    const env = H.swellEnv(t, rise);
    const level = env * 0.75;
    const frame = H.emptyFrame();
    for (const p of H.PARS) H.setPar(frame, p, colour, level);
    for (const h of H.HEADS) H.setHead(frame, h, { level: level * 0.6, colour });
    frames.push(frame);
  }

  return {
    frames,
    loop_beats: forBeats,
    per_fixture: H.ALL_FIXTURES.slice(),
  };
};
