"use strict";
const H = require("./helpers");

module.exports = function cut(params, ctx) {
  const forBeats = params.for_beats || 1;
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = fpb * forBeats;

  const frames = [];
  for (let i = 0; i < total; i++) frames.push(H.emptyFrame());

  return {
    frames,
    loop_beats: forBeats,
    per_fixture: H.ALL_FIXTURES.slice(),
  };
};
