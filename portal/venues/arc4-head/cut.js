"use strict";
const H = require("./helpers");

/* cut — momentary silence GESTURE. Every par to zero and the head master to
   zero, but pan/tilt held at park so the beam doesn't lurch when light returns.
   Short and total. */
module.exports = function cut(params, ctx) {
  const forBeats = params.for_beats || 1;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const f = H.emptyFrame();
    H.setHead(f, H.HEADS[0], { level: 0 });   // master 0, pan/tilt -> HEAD_PARK
    frames.push(f);                            // pars left dark
  }

  return {
    frames,
    loop_beats: 0,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
