"use strict";
const H = require("./helpers");

module.exports = function hush(params, ctx) {
  const depth = params.depth != null ? params.depth : 0.3;
  const forBeats = params.for_beats || 4;
  const keep = params.keep || [];
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = fpb * forBeats;
  const keepSet = new Set(keep);

  const frames = [];
  for (let i = 0; i < total; i++) {
    const t = i / total;
    const env = H.easeSettle(t);
    const level = 1 - (1 - depth) * env;
    const frame = H.emptyFrame();
    for (const p of H.PARS) {
      if (keepSet.has(p.id)) {
        H.setPar(frame, p, [0.5, 0.5, 0.5], 0.15);
      } else {
        H.setPar(frame, p, [0.5, 0.5, 0.5], level * 0.15);
      }
    }
    for (const h of H.HEADS) {
      H.setHead(frame, h, {
        level: level * 0.1,
        pan: 0.5 + (1 - level) * 0.15,
        tilt: 0.3 + (1 - level) * 0.2,
      });
    }
    frames.push(frame);
  }

  return {
    frames,
    loop_beats: forBeats,
    per_fixture: H.ALL_FIXTURES.slice(),
  };
};
