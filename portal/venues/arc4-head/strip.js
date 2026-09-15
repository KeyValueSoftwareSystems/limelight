"use strict";
const H = require("./helpers");

module.exports = function strip(params, ctx) {
  const to = params.to != null ? params.to : 0.1;
  const overBeats = params.over_beats || 4;
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = fpb * overBeats;

  const frames = [];
  for (let i = 0; i < total; i++) {
    const t = i / (total - 1 || 1);
    const level = 1 - (1 - to) * H.easeSettle(t);
    const frame = H.emptyFrame();
    for (const p of H.PARS) H.setPar(frame, p, [0.5, 0.5, 0.5], level * 0.5);
    for (const h of H.HEADS) H.setHead(frame, h, { level: level * 0.3 });
    frames.push(frame);
  }

  return {
    frames,
    loop_beats: overBeats,
    per_fixture: H.ALL_FIXTURES.slice(),
  };
};
