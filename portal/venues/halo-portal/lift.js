"use strict";
const H = require("./helpers");

/* lift — sustained rise GESTURE. Pars brighten by `by` on a settle curve and
   HOLD at the new level (the last frame is the arrival, not a return). The head
   tilts up and its level rises with them. Fires on a register shift — the music
   went up and stayed up. */
module.exports = function lift(params, ctx) {
  const by = params.by != null ? params.by : 0.35;
  const overBeats = params.over_beats || 8;
  const tiltTo = params.tilt != null ? params.tilt : 0.6;
  const colour = H.parseColour(params.colour, [1, 0.8, 0.5]);
  const start = 0.3;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * overBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const e = H.easeSettle(i / (N - 1));
    const level = start + by * e;
    const f = H.emptyFrame();
    for (const par of H.PARS) H.setPar(f, par, colour, level);
    H.setHead(f, H.HEADS[0], {
      level: level * 0.7, colour,
      pan: 0.60,
      tilt: 0.498 + (tiltTo - 0.498) * e,     // tilt lifts up and stays
    });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: 0,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
