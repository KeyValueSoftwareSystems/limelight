"use strict";
const H = require("./helpers");

/* blackout — everything to zero GESTURE. The strongest gesture there is. Pars
   dark, head master 0, but pan/tilt held at park so the beam doesn't lurch when
   the light comes back. */
module.exports = function blackout(params, ctx) {
  const forBeats = params.for_beats || 1;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const f = H.emptyFrame();
    H.setHead(f, H.HEADS[0], { level: 0 });   // master 0, pan/tilt -> HEAD_PARK
    frames.push(f);                            // pars left at 0 = dark
  }

  return {
    frames,
    loop_beats: 0,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
