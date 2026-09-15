"use strict";
const H = require("./helpers");

/* trade — left<->right handoff GESTURE. First half: the left pars carry
   colour[0] while the right sit dim; second half they swap. The head pans across
   to follow whoever is loud. Call and response. */
module.exports = function trade(params, ctx) {
  const cols = H.parseColours(params.colours, [[0.2, 0.4, 1], [1, 0.55, 0.2]]);
  const c0 = cols[0], c1 = cols[1];
  const forBeats = params.for_beats || 4;
  const dim = 0.15, hot = 0.9;
  const N = Math.max(2, H.framesPerBeat(ctx.bpm) * forBeats);

  const frames = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const toRight = H.easeInOut(H.clamp((t - 0.35) / 0.3, 0, 1)); // 0 first half -> 1 second
    const f = H.emptyFrame();
    for (const par of H.LEFT)  H.setPar(f, par, c0, hot - (hot - dim) * toRight);
    for (const par of H.RIGHT) H.setPar(f, par, c1, dim + (hot - dim) * toRight);
    H.setHead(f, H.HEADS[0], {
      level: 0.5,
      colour: toRight < 0.5 ? c0 : c1,
      pan: 0.42 + (0.80 - 0.42) * toRight,     // pan left -> right with the handoff
      tilt: 0.36,
    });
    frames.push(f);
  }

  return {
    frames,
    loop_beats: 0,
    per_fixture: H.PAR_IDS.concat(H.HEAD_IDS),
  };
};
