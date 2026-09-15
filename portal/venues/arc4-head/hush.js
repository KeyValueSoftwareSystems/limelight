"use strict";
const H = require("./helpers");

/* hush — levels fall GESTURE. The pars settle from a mid level down toward
   depth, the head dims and its tilt drifts down. Eased settle, then held at the
   floor for the rest of the span. */
module.exports = function hush(params, ctx) {
  const depth = params.depth != null ? params.depth : 0.4;
  const forBeats = params.for_beats || 4;
  const colour = H.parseColour(params.colour, [1, 0.85, 0.6]);
  const start = 0.6;                       // a nominal "current" to fall from
  const end = start * depth;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const e = H.easeSettle(i / N);
    const level = start + (end - start) * e;
    const f = H.emptyFrame();
    for (const par of H.PARS) H.setPar(f, par, colour, level);
    H.setHead(f, H.HEADS[0], {
      level: level * 0.6, colour,
      pan: 0.60,
      tilt: 0.498 + (0.40 - 0.498) * e,     // tilt drifts down as it settles
    });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: 0,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
