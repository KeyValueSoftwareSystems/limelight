"use strict";
const H = require("./helpers");

module.exports = function ramp(params, ctx) {
  const to = params.to != null ? params.to : 0.85;
  const curve = params.curve || "ease";
  const forBeats = params.for_beats || 16;
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = fpb * forBeats;
  const easeFn = H.easeCurve(curve);
  const fromLevel = 0.08;

  const frames = [];
  for (let i = 0; i < total; i++) {
    const t = i / (total - 1 || 1);
    const level = fromLevel + (to - fromLevel) * easeFn(t);
    const frame = H.emptyFrame();
    const warm = [1, 0.8 + 0.2 * t, 0.4 + 0.6 * t];
    for (const p of H.PARS) H.setPar(frame, p, warm, level);
    for (const h of H.HEADS) H.setHead(frame, h, { level: level * 0.7, colour: warm });
    frames.push(frame);
  }

  return {
    frames,
    loop_beats: forBeats,
    per_fixture: H.ALL_FIXTURES.slice(),
  };
};
