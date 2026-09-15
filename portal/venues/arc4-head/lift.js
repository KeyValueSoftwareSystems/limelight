"use strict";
const H = require("./helpers");

module.exports = function lift(params, ctx) {
  const by = params.by != null ? params.by : 0.35;
  const overBeats = params.over_beats || 4;
  const tilt = params.tilt != null ? params.tilt : 0.3;
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = fpb * overBeats;

  const frames = [];
  for (let i = 0; i < total; i++) {
    const t = i / (total - 1 || 1);
    const env = H.easeSettle(t);
    const level = env * by;
    const frame = H.emptyFrame();
    for (const p of H.PARS) H.setPar(frame, p, [1, 0.9, 0.7], 0.3 + level);
    for (const h of H.HEADS) {
      H.setHead(frame, h, {
        level: 0.4 + level,
        colour: [1, 0.9, 0.7],
        tilt: 0.5 - tilt * env * 0.3,
      });
    }
    frames.push(frame);
  }

  return {
    frames,
    loop_beats: overBeats,
    per_fixture: H.ALL_FIXTURES.slice(),
  };
};
