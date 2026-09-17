"use strict";
const H = require("./helpers");

module.exports = function blackout(params, ctx) {
  const forBeats = params.for_beats || 1;
  const fpb = H.framesPerBeat(ctx.bpm);
  const total = fpb * forBeats;

  const frame = H.emptyFrame();
  const frames = [];
  for (let i = 0; i < total; i++) frames.push(frame.slice());

  return {
    frames,
    loop_beats: forBeats,
    per_fixture: H.ALL_FIXTURES.slice(),
  };
};
